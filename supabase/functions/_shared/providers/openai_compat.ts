import { ChatMessage, ErrorKind, ModelInfo, Provider, ProviderError, StreamOptions, StreamPart } from "./types.ts";

export interface CompatConfig {
  id: string;
  name: string;
  keyUrl: string | null;
  anonymous: boolean;
  note: string;
  /** provedor que pode gerar cobrança (créditos) */
  paid?: boolean;
  /** classifica um erro HTTP específico do provedor (devolve null para usar a regra padrão) */
  classify?: (status: number, body: string) => ErrorKind | null;
  /** nome do campo de limite de tokens (padrão: max_tokens) */
  maxTokensField?: string;
  /** URL completa do endpoint de chat completions */
  chatUrl: string;
  /** URL de listagem de modelos (opcional) */
  modelsUrl?: string;
  /** cabeçalhos de autenticação da listagem de modelos (padrão: Authorization: Bearer <chave>) */
  modelsHeaders?: (key: string) => Record<string, string>;
  staticModels: ModelInfo[];
  /** transforma a listagem ao vivo (ids) em modelos elegíveis */
  fromLive?: (liveIds: string[], staticModels: ModelInfo[]) => ModelInfo[];
  liveNeedsKey?: boolean;
  extraHeaders?: Record<string, string>;
  fetchImpl?: typeof fetch;
  /** extrai ids da resposta de listagem */
  parseModels?: (json: unknown) => string[];
}

const LIVE_TTL = 30 * 60_000;

export function parseRetryAfter(h: Headers): number | null {
  const ra = h.get("retry-after");
  if (ra) {
    const n = Number(ra);
    if (Number.isFinite(n)) return Math.ceil(n);
    const d = Date.parse(ra);
    if (!Number.isNaN(d)) return Math.max(1, Math.ceil((d - Date.now()) / 1000));
  }
  const reset = h.get("x-ratelimit-reset");
  if (reset) {
    const n = Number(reset);
    if (Number.isFinite(n)) {
      // OpenRouter: epoch em ms
      if (n > 1e12) return Math.max(1, Math.ceil((n - Date.now()) / 1000));
      if (n > 1e9) return Math.max(1, Math.ceil(n - Date.now() / 1000));
    }
  }
  const d = parseDuration(h.get("x-ratelimit-reset-requests")) ?? parseDuration(h.get("x-ratelimit-reset-tokens"));
  return d;
}

/** "6h12m3.5s" | "7.66s" | "2m59.56s" -> segundos */
export function parseDuration(s: string | null): number | null {
  if (!s) return null;
  const re = /(\d+(?:\.\d+)?)(ms|h|m|s)/g;
  let total = 0;
  let found = false;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    found = true;
    const v = Number(m[1]);
    total += m[2] === "h" ? v * 3600 : m[2] === "m" ? v * 60 : m[2] === "ms" ? v / 1000 : v;
  }
  return found ? Math.ceil(total) : null;
}

function rateHeaders(h: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  h.forEach((v, k) => {
    if (k.startsWith("x-ratelimit") || k === "retry-after") out[k] = v;
  });
  return out;
}

function kindForStatus(status: number): ErrorKind {
  if (status === 429) return "rate_limit";
  if (status === 401 || status === 403) return "auth";
  if (status === 402) return "quota";
  if (status === 413) return "too_large";
  if (status === 400 || status === 404 || status === 422) return "bad_model";
  return "server";
}

export class OpenAICompatProvider implements Provider {
  id: string;
  name: string;
  keyUrl: string | null;
  anonymous: boolean;
  note: string;
  paid: boolean;
  private live: { at: number; models: ModelInfo[] } | null = null;
  constructor(private cfg: CompatConfig) {
    this.id = cfg.id;
    this.name = cfg.name;
    this.keyUrl = cfg.keyUrl;
    this.anonymous = cfg.anonymous;
    this.note = cfg.note;
    this.paid = !!cfg.paid;
  }

  configured(key: string | null): boolean {
    return this.anonymous || !!key;
  }

  private f(): typeof fetch {
    return this.cfg.fetchImpl ?? fetch;
  }

  async listModels(key: string | null): Promise<ModelInfo[]> {
    const c = this.cfg;
    if (!c.modelsUrl || !c.fromLive || (c.liveNeedsKey && !key)) return c.staticModels;
    if (this.live && Date.now() - this.live.at < LIVE_TTL) return this.live.models;
    try {
      const headers: Record<string, string> = { ...(c.extraHeaders ?? {}) };
      if (key) Object.assign(headers, c.modelsHeaders ? c.modelsHeaders(key) : { Authorization: `Bearer ${key}` });
      const r = await this.f()(c.modelsUrl, { headers, signal: AbortSignal.timeout(8000) });
      if (!r.ok) throw new Error(String(r.status));
      const j = await r.json();
      const ids = (c.parseModels ?? defaultParse)(j);
      const models = c.fromLive(ids, c.staticModels);
      const out = models.length ? models : c.staticModels;
      this.live = { at: Date.now(), models: out };
      return out;
    } catch {
      return c.staticModels;
    }
  }

  async *stream(model: string, messages: ChatMessage[], key: string | null, opts: StreamOptions): AsyncGenerator<StreamPart> {
    const c = this.cfg;
    const ctrl = new AbortController();
    const onAbort = () => ctrl.abort();
    opts.signal?.addEventListener("abort", onAbort);
    let timedOut = false;
    let timer = setTimeout(() => { timedOut = true; ctrl.abort(); }, opts.firstByteTimeoutMs);
    const rearm = (ms: number) => {
      clearTimeout(timer);
      timer = setTimeout(() => { timedOut = true; ctrl.abort(); }, ms);
    };
    try {
      const headers: Record<string, string> = { "Content-Type": "application/json", Accept: "text/event-stream", ...(c.extraHeaders ?? {}) };
      if (key) headers["Authorization"] = `Bearer ${key}`;
      const body: Record<string, unknown> = { model, messages, stream: true, stream_options: { include_usage: true } };
      if (opts.maxTokens) body[c.maxTokensField ?? "max_tokens"] = opts.maxTokens;
      let res: Response;
      try {
        res = await this.f()(c.chatUrl, { method: "POST", headers, body: JSON.stringify(body), signal: ctrl.signal });
      } catch (e) {
        if (opts.signal?.aborted) throw new ProviderError("aborted", "cancelado");
        if (timedOut) throw new ProviderError("timeout", "tempo esgotado aguardando o provedor");
        throw new ProviderError("network", `falha de rede: ${(e as Error).message}`);
      }
      const hdrs = rateHeaders(res.headers);
      if (Object.keys(hdrs).length) yield { type: "headers", info: hdrs };
      if (!res.ok) {
        let detail = "";
        try { detail = (await res.text()).slice(0, 300); } catch { /* ignora */ }
        throw new ProviderError(c.classify?.(res.status, detail) ?? kindForStatus(res.status), `HTTP ${res.status} ${detail}`.trim(), res.status, parseRetryAfter(res.headers), hdrs);
      }
      if (!res.body) throw new ProviderError("server", "resposta sem corpo", res.status);
      yield { type: "activity" };
      rearm(opts.firstByteTimeoutMs);
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      let sawContent = false;
      let finished = false;
      while (!finished) {
        let chunk: ReadableStreamReadResult<Uint8Array>;
        try {
          chunk = await reader.read();
        } catch (e) {
          if (opts.signal?.aborted) throw new ProviderError("aborted", "cancelado");
          if (timedOut) throw new ProviderError("timeout", "provedor parou de responder");
          throw new ProviderError("network", `stream interrompido: ${(e as Error).message}`);
        }
        if (chunk.done) break;
        rearm(opts.idleTimeoutMs);
        buf += dec.decode(chunk.value, { stream: true });
        let idx: number;
        while ((idx = buf.search(/\r?\n\r?\n/)) >= 0) {
          const block = buf.slice(0, idx);
          buf = buf.slice(idx).replace(/^\r?\n\r?\n/, "");
          for (const line of block.split(/\r?\n/)) {
            if (!line.startsWith("data:")) continue;
            const data = line.slice(5).trim();
            if (!data) continue;
            if (data === "[DONE]") { finished = true; continue; }
            let j: any;
            try { j = JSON.parse(data); } catch { continue; }
            if (j.error) {
              const st = Number(j.error.code ?? j.error.status ?? 0) || null;
              throw new ProviderError(st ? kindForStatus(st) : "server", `erro no stream: ${String(j.error.message ?? "").slice(0, 200)}`, st);
            }
            if (j.usage && (j.usage.prompt_tokens != null || j.usage.completion_tokens != null)) {
              yield { type: "usage", tin: j.usage.prompt_tokens, tout: j.usage.completion_tokens };
            }
            const d = j.choices?.[0]?.delta ?? j.choices?.[0]?.message;
            const text = typeof d?.content === "string" ? d.content : typeof j.choices?.[0]?.text === "string" ? j.choices[0].text : "";
            if (text) {
              sawContent = true;
              yield { type: "delta", text };
            } else if (d && (d.reasoning || d.reasoning_content)) {
              yield { type: "activity" };
            }
          }
        }
      }
      await reader.cancel().catch(() => {});
      if (!sawContent) throw new ProviderError("empty", "resposta vazia do provedor", res.status);
    } finally {
      clearTimeout(timer);
      opts.signal?.removeEventListener("abort", onAbort);
    }
  }
}

function defaultParse(j: unknown): string[] {
  const arr = (j as { data?: { id?: string }[]; models?: { name?: string }[] });
  if (Array.isArray(arr.data)) return arr.data.map((m) => String(m.id)).filter(Boolean);
  if (Array.isArray(arr.models)) return arr.models.map((m) => String(m.name)).filter(Boolean);
  return [];
}
