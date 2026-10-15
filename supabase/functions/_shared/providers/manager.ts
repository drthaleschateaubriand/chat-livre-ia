// Gerenciador de provedores: seleção, fallback automático, circuit breaker e registro de uso.
// Módulo puro (sem Deno/Supabase): dependências injetadas, testável com mocks.
import { ChatMessage, ErrorKind, ModelInfo, Provider, ProviderError } from "./types.ts";

export interface FailureInfo {
  status: number | null;
  kind: ErrorKind;
  message: string;
  /** cooldown base em ms; `explicit` = veio de Retry-After/reset do provedor */
  cooldownMs: number;
  explicit: boolean;
  scope: "model" | "provider";
}

export interface StateStore {
  /** chave "provider|model" ou "provider|*" -> epoch ms em que o cooldown termina */
  cooldowns(): Promise<Record<string, number>>;
  success(provider: string, model: string, info: { tin: number; tout: number; limitInfo?: Record<string, string>; cooldownUntil?: number }): Promise<void>;
  failure(provider: string, model: string, info: FailureInfo): Promise<void>;
}

export interface ManagerDeps {
  providers: Provider[];
  getKey: (providerId: string) => Promise<string | null>;
  store: StateStore;
  now?: () => number;
  firstByteTimeoutMs?: number;
  idleTimeoutMs?: number;
  maxAttempts?: number;
}

/** Opções por requisição para provedores que podem gerar cobrança (paid). */
export interface RunOptions {
  /** permite provedores pagos no Automático (preferência do usuário; padrão: false) */
  allowPaid?: boolean;
  /** limite de segurança chamado antes de cada tentativa paga; false = pular */
  paidGate?: (providerId: string) => Promise<boolean>;
}

export type ManagerEvent =
  | { type: "attempt"; provider: string; model: string }
  | { type: "reset" } // descartar texto parcial exibido (troca de provedor no meio da resposta)
  | { type: "fallback"; provider: string; model: string; kind: ErrorKind; status: number | null }
  | { type: "delta"; text: string }
  | { type: "done"; provider: string; model: string; fallbackUsed: boolean; tin: number; tout: number }
  | { type: "exhausted"; retryAfterS: number; tried: { provider: string; model: string; kind: ErrorKind; status: number | null }[]; unconfigured: string[] }
  | { type: "aborted" };

export const HOUR = 3_600_000;

export function cooldownFor(e: ProviderError): { ms: number; explicit: boolean; scope: "model" | "provider" } {
  const ra = e.retryAfterS ? e.retryAfterS * 1000 : 0;
  switch (e.kind) {
    case "rate_limit":
      return ra ? { ms: Math.min(Math.max(ra, 15_000), 24 * HOUR), explicit: true, scope: "model" } : { ms: 60_000, explicit: false, scope: "model" };
    case "auth":
      return { ms: HOUR, explicit: true, scope: "provider" };
    case "quota": // créditos/cota esgotados (ex.: 402/403 da xAI): cooldown longo; o dono precisa recarregar (ou limpar com admin clear-cooldown)
      return { ms: 6 * HOUR, explicit: true, scope: "provider" };
    case "bad_model":
      return { ms: 6 * HOUR, explicit: true, scope: "model" };
    case "too_large":
      return { ms: 30_000, explicit: true, scope: "model" };
    default: // server | empty | timeout | network: cooldown curto que escala com falhas consecutivas (ver store)
      return { ms: 10_000, explicit: false, scope: "model" };
  }
}

export function parseModelPref(pref: string | null | undefined): { provider: string; model: string } | null {
  if (!pref || pref === "auto") return null;
  const i = pref.indexOf("|");
  if (i <= 0) return null;
  return { provider: pref.slice(0, i), model: pref.slice(i + 1) };
}

export interface CatalogEntry {
  provider: string;
  name: string;
  keyUrl: string | null;
  anonymous: boolean;
  note: string;
  /** pode gerar cobrança na conta do dono da chave */
  paid: boolean;
  configured: boolean;
  models: (ModelInfo & { cooldownUntil: number | null; available: boolean })[];
}

export class ProviderManager {
  private now: () => number;
  constructor(private d: ManagerDeps) {
    this.now = d.now ?? (() => Date.now());
  }

  private coolUntil(cd: Record<string, number>, provider: string, model: string): number | null {
    const t = Math.max(cd[`${provider}|${model}`] ?? 0, cd[`${provider}|*`] ?? 0);
    return t > this.now() ? t : null;
  }

  async catalog(): Promise<CatalogEntry[]> {
    const cd = await this.d.store.cooldowns();
    const out: CatalogEntry[] = [];
    for (const p of this.d.providers) {
      const key = await this.d.getKey(p.id);
      const configured = p.configured(key);
      const models = await p.listModels(key);
      out.push({
        provider: p.id, name: p.name, keyUrl: p.keyUrl, anonymous: p.anonymous, note: p.note, paid: !!p.paid, configured,
        models: models.map((x) => {
          const c = this.coolUntil(cd, p.id, x.id);
          return { ...x, cooldownUntil: c, available: configured && !c };
        }),
      });
    }
    return out;
  }

  /** Ordem de tentativa: preferência manual primeiro (se elegível), depois por rank. Pula não configurados e em cooldown. */
  async plan(pref: string | null | undefined, opts: RunOptions = {}): Promise<{ candidates: { p: Provider; m: ModelInfo; key: string | null }[]; unconfigured: string[]; minCooldownS: number }> {
    const cd = await this.d.store.cooldowns();
    const all: { p: Provider; m: ModelInfo; key: string | null }[] = [];
    const unconfigured: string[] = [];
    let minCool = Infinity;
    const want0 = parseModelPref(pref);
    for (const p of this.d.providers) {
      const key = await this.d.getKey(p.id);
      if (!p.configured(key)) { unconfigured.push(p.id); continue; }
      // provedor pago: só se o usuário escolheu um modelo dele manualmente OU permitiu pagos no Automático
      if (p.paid && !opts.allowPaid && want0?.provider !== p.id) continue;
      for (const m of await p.listModels(key)) {
        const c = this.coolUntil(cd, p.id, m.id);
        if (c) { minCool = Math.min(minCool, c); continue; }
        all.push({ p, m, key });
      }
    }
    all.sort((a, b) => a.m.rank - b.m.rank);
    const want = parseModelPref(pref);
    if (want) {
      const i = all.findIndex((x) => x.p.id === want.provider && x.m.id === want.model);
      if (i > 0) all.unshift(...all.splice(i, 1));
    }
    return { candidates: all, unconfigured, minCooldownS: Number.isFinite(minCool) ? Math.max(1, Math.ceil((minCool - this.now()) / 1000)) : 0 };
  }

  async *run(messages: ChatMessage[], pref: string | null | undefined, signal?: AbortSignal, maxTokens?: number, opts: RunOptions = {}): AsyncGenerator<ManagerEvent> {
    const { candidates, unconfigured, minCooldownS } = await this.plan(pref, opts);
    const want = parseModelPref(pref);
    const max = this.d.maxAttempts ?? 6;
    const tried: { provider: string; model: string; kind: ErrorKind; status: number | null }[] = [];
    let emitted = false;
    let n = 0;
    const inChars = messages.reduce((a, m) => a + m.content.length, 0);
    const failedProviders = new Set<string>();
    const emptyRetried = new Set<string>();
    for (let ci = 0; ci < candidates.length; ci++) {
      const c = candidates[ci];
      if (n >= max) break;
      // sem martelar um provedor que acabou de falhar (limite/5xx/timeout): pula seus outros modelos nesta requisição
      if (failedProviders.has(c.p.id)) continue;
      if (c.p.paid && opts.paidGate && !(await opts.paidGate(c.p.id))) {
        // teto de segurança de consumo pago atingido: não chama o provedor, segue para o próximo
        failedProviders.add(c.p.id);
        tried.push({ provider: c.p.id, model: c.m.id, kind: "quota", status: null });
        yield { type: "fallback", provider: c.p.id, model: c.m.id, kind: "quota", status: null };
        continue;
      }
      n++;
      yield { type: "attempt", provider: c.p.id, model: c.m.id };
      let text = 0;
      let tin = 0;
      let tout = 0;
      let limitInfo: Record<string, string> | undefined;
      try {
        for await (const part of c.p.stream(c.m.id, messages, c.key, {
          signal, firstByteTimeoutMs: this.d.firstByteTimeoutMs ?? 25_000, idleTimeoutMs: this.d.idleTimeoutMs ?? 30_000, maxTokens,
        })) {
          if (part.type === "delta") { text += part.text.length; emitted = true; yield { type: "delta", text: part.text }; }
          else if (part.type === "usage") { tin = part.tin ?? tin; tout = part.tout ?? tout; }
          else if (part.type === "headers") limitInfo = part.info;
        }
        if (!tin) tin = Math.ceil(inChars / 4);
        if (!tout) tout = Math.ceil(text / 4);
        let cooldownUntil: number | undefined;
        const rem = limitInfo?.["x-ratelimit-remaining-requests"];
        if (rem !== undefined && Number(rem) === 0) {
          const s = limitInfo?.["x-ratelimit-reset-requests"];
          const secs = s ? (/^\d+(\.\d+)?$/.test(s) ? Number(s) : parseDur(s)) : null;
          if (secs) cooldownUntil = this.now() + secs * 1000;
        }
        await this.d.store.success(c.p.id, c.m.id, { tin, tout, limitInfo, cooldownUntil });
        yield { type: "done", provider: c.p.id, model: c.m.id, fallbackUsed: !!want ? !(want.provider === c.p.id && want.model === c.m.id) : n > 1, tin, tout };
        return;
      } catch (err) {
        const e = err instanceof ProviderError ? err : new ProviderError("network", (err as Error)?.message ?? "erro");
        if (e.kind === "aborted") { yield { type: "aborted" }; return; }
        if (e.kind === "empty" && text === 0 && !emptyRetried.has(c.p.id)) {
          // resposta vazia costuma ser transitória: UMA nova tentativa no mesmo modelo, sem registrar cooldown
          emptyRetried.add(c.p.id);
          n--; ci--;
          continue;
        }
        const cf = cooldownFor(e);
        await this.d.store.failure(c.p.id, c.m.id, { status: e.status, kind: e.kind, message: e.message.slice(0, 300), cooldownMs: cf.ms, explicit: cf.explicit, scope: cf.scope });
        tried.push({ provider: c.p.id, model: c.m.id, kind: e.kind, status: e.status });
        if (e.kind !== "bad_model" && e.kind !== "too_large") failedProviders.add(c.p.id);
        if (text > 0) { yield { type: "reset" }; emitted = false; }
        yield { type: "fallback", provider: c.p.id, model: c.m.id, kind: e.kind, status: e.status };
      }
    }
    void emitted;
    // quando tentar de novo: menor cooldown entre os modelos configurados (lido de novo, pois acabamos de registrar falhas)
    const cd2 = await this.d.store.cooldowns();
    const times = Object.values(cd2).filter((t) => t > this.now());
    const soonest = times.length ? Math.min(...times) : 0;
    const retryAfterS = soonest ? Math.max(1, Math.ceil((soonest - this.now()) / 1000)) : Math.max(minCooldownS, 60);
    yield { type: "exhausted", retryAfterS, tried, unconfigured };
  }

  /** Resposta completa (não-stream) com o mesmo fallback — usada para resumos. */
  async complete(messages: ChatMessage[], pref?: string, maxTokens?: number, opts: RunOptions = {}): Promise<{ text: string; provider: string; model: string } | null> {
    let text = "";
    for await (const ev of this.run(messages, pref, undefined, maxTokens, opts)) {
      if (ev.type === "delta") text += ev.text;
      else if (ev.type === "reset") text = "";
      else if (ev.type === "done") return { text, provider: ev.provider, model: ev.model };
      else if (ev.type === "exhausted") return null;
    }
    return null;
  }
}

function parseDur(s: string): number | null {
  const re = /(\d+(?:\.\d+)?)(ms|h|m|s)/g;
  let t = 0; let f = false; let m: RegExpExecArray | null;
  while ((m = re.exec(s))) { f = true; const v = Number(m[1]); t += m[2] === "h" ? v * 3600 : m[2] === "m" ? v * 60 : m[2] === "ms" ? v / 1000 : v; }
  return f ? Math.ceil(t) : null;
}
