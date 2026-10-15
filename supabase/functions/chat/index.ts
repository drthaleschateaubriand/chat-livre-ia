// Edge Function `chat`: envia mensagem, faz streaming SSE, fallback entre provedores e grava o histórico.
import { db } from "../_shared/db.ts";
import { HttpError, json, readJson, serve, str, uuid } from "../_shared/http.ts";
import { corsHeaders } from "../_shared/cors.ts";
import { rateHit, requireSession, tooMany } from "../_shared/session.ts";
import { manager } from "../_shared/providers/index.ts";
import { ChatMessage } from "../_shared/providers/types.ts";
import { buildProviders } from "../_shared/providers/registry.ts";
import { buildSystemPrompt, resolveModelPref } from "../_shared/prompt.ts";

const PAID_IDS = new Set(buildProviders().filter((p) => p.paid).map((p) => p.id));

const MAX_USER_CHARS = 8000;
const CTX_BUDGET_CHARS = 20_000; // ~5k tokens: cabe nos limites por minuto dos planos grátis
const SUMMARY_TRIGGER_CHARS = 14_000;
const KEEP_RECENT = 6;
const MODEL_RE = /^(auto|[a-z]{3,20}\|[A-Za-z0-9._:\/\-]{1,100})$/;

interface Msg { id: string; seq: number; role: "user" | "assistant" | "system"; content: string; provider: string | null; model: string | null; fallback_used: boolean; created_at: string }

// Teto de segurança para o provedor PAGO (xAI): protege os créditos do dono contra abuso/loop. Valores fixos e conservadores.
const PAID_USER_DAY = 30;
const PAID_GLOBAL_DAY = 300;
function paidGateFor(userId: string) {
  return async (_providerId: string): Promise<boolean> => {
    try {
      const u = await rateHit("paid_user_day", userId, PAID_USER_DAY, 86400, 3600, 86400);
      if (!u.allowed) return false;
      const g = await rateHit("paid_global_day", "all", PAID_GLOBAL_DAY, 86400, 3600, 86400);
      return g.allowed;
    } catch { return false; } // na dúvida, NÃO gasta
  };
}

async function summarize(convId: string, userId: string, summary: string | null, summaryUpto: number, allowPaid = false) {
  try {
    const { data } = await db().from("messages").select("seq,role,content").eq("conversation_id", convId).eq("user_id", userId).gt("seq", summaryUpto).order("seq");
    const msgs = data ?? [];
    const total = msgs.reduce((a, m) => a + m.content.length, 0);
    if (total <= SUMMARY_TRIGGER_CHARS || msgs.length <= KEEP_RECENT + 1) return;
    const older = msgs.slice(0, msgs.length - KEEP_RECENT);
    let text = older.map((m) => `${m.role === "user" ? "Usuário" : "Assistente"}: ${m.content.slice(0, 2500)}`).join("\n\n");
    if (text.length > 14_000) text = text.slice(-14_000);
    const prompt: ChatMessage[] = [
      { role: "system", content: "Você resume conversas de forma fiel e compacta, em português, preservando fatos, decisões, nomes, números e pedidos pendentes. Responda só com o resumo (máx. 250 palavras)." },
      { role: "user", content: `${summary ? `Resumo anterior:\n${summary}\n\n` : ""}Novas mensagens a incorporar:\n${text}` },
    ];
    const r = await manager().complete(prompt, "auto", 600, { allowPaid, paidGate: paidGateFor(userId) });
    if (!r || !r.text.trim()) return;
    await db().from("conversations").update({ summary: r.text.trim().slice(0, 4000), summary_upto: older[older.length - 1].seq })
      .eq("id", convId).eq("user_id", userId);
  } catch (e) {
    console.error("falha ao resumir:", (e as Error).message);
  }
}

serve(async (req, action) => {
  if (action !== "send") throw new HttpError(404, "not_found", "Rota inexistente.");
  const auth = await requireSession(req);
  const body = await readJson(req, 60_000);
  const userId = auth.userId;

  const rl = await rateHit("chat_user_min", userId, 20, 60, 30, 600);
  if (!rl.allowed) throw tooMany(rl.retryAfter);

  const mode = body.mode === "regenerate" || body.mode === "continue" ? (body.mode as string) : "send";
  const modelPref = typeof body.model === "string" ? body.model : null;
  if (modelPref !== null && !MODEL_RE.test(modelPref)) throw new HttpError(400, "bad_request", "Modelo inválido.");

  // 1. conversa (propriedade verificada pelo user_id da sessão)
  let convId: string;
  let title = "";
  let agentId: string | null = null; // agente da conversa (opcional)
  if (body.conversation_id) {
    convId = uuid(body.conversation_id);
    const { data } = await db().from("conversations").select("id,title,agent_id").eq("id", convId).eq("user_id", userId).maybeSingle();
    if (!data) throw new HttpError(404, "not_found", "Conversa não encontrada.");
    title = data.title;
    agentId = data.agent_id ?? null;
  } else {
    if (mode !== "send") throw new HttpError(400, "bad_request", "Conversa obrigatória.");
    convId = "";
  }

  let userMsg: Msg | null = null;
  if (mode === "send") {
    const content = str(body.content, MAX_USER_CHARS).trim();
    if (!content) throw new HttpError(400, "bad_request", "Mensagem vazia.");
    if (!convId) {
      title = content.replace(/\s+/g, " ").slice(0, 60);
      if (body.agent_id !== undefined && body.agent_id !== null) {
        // o agente precisa ser do próprio usuário (404 para o de outra pessoa, sem revelar que existe)
        const aid = uuid(body.agent_id);
        const { data: ag } = await db().from("agents").select("id").eq("id", aid).eq("user_id", userId).maybeSingle();
        if (!ag) throw new HttpError(404, "not_found", "Agente não encontrado.");
        agentId = ag.id;
      }
      const { data, error } = await db().from("conversations").insert({ user_id: userId, title, agent_id: agentId }).select("id").single();
      if (error) throw new Error("conv_create_failed");
      convId = data.id;
    }
    const { data, error } = await db().from("messages").insert({ conversation_id: convId, user_id: userId, role: "user", content }).select("id,seq,role,content,provider,model,fallback_used,created_at").single();
    if (error) throw new Error("msg_insert_failed");
    userMsg = data as Msg;
  }

  // 2. carrega histórico
  const { data: convRow } = await db().from("conversations").select("summary,summary_upto").eq("id", convId).eq("user_id", userId).single();
  let { data: hist } = await db().from("messages").select("id,seq,role,content,provider,model,fallback_used,created_at").eq("conversation_id", convId).eq("user_id", userId).order("seq");
  let history = (hist ?? []) as Msg[];
  let prevAssistant: Msg | null = null;
  if (mode === "regenerate") {
    if (history.length && history[history.length - 1].role === "assistant") {
      const last = history[history.length - 1];
      await db().from("messages").delete().eq("id", last.id).eq("user_id", userId);
      history = history.slice(0, -1);
    }
    if (!history.length || history[history.length - 1].role !== "user") throw new HttpError(400, "bad_request", "Nada para regenerar.");
  } else if (mode === "continue") {
    const last = history[history.length - 1];
    if (!last || last.role !== "assistant") throw new HttpError(400, "bad_request", "Nada para continuar.");
    prevAssistant = last;
  }

  // 3. prompt: sistema (+memórias +resumo) + janela recente dentro do orçamento
  const { data: prefs } = await db().from("preferences").select("language,memory_enabled,default_model,allow_paid_auto").eq("user_id", userId).maybeSingle();
  let memories: string[] = [];
  if (prefs?.memory_enabled) {
    const { data } = await db().from("memories").select("content").eq("user_id", userId).order("created_at").limit(50);
    memories = (data ?? []).map((m) => m.content);
  }
  const upto = Number(convRow?.summary_upto ?? 0);
  let agent: { name: string; instructions: string; preferred_model: string } | null = null;
  if (agentId) {
    const { data } = await db().from("agents").select("name,instructions,preferred_model").eq("id", agentId).eq("user_id", userId).maybeSingle();
    agent = data ?? null;
  }
  const sys = buildSystemPrompt(prefs?.language ?? "pt-BR", memories, upto > 0 ? convRow?.summary ?? null : null, agent);
  const live = history.filter((m) => m.seq > upto && m.role !== "system");
  const picked: ChatMessage[] = [];
  let budget = CTX_BUDGET_CHARS - sys.length;
  for (let i = live.length - 1; i >= 0; i--) {
    const m = live[i];
    const cost = m.content.length;
    if (picked.length > 0 && cost > budget) break;
    picked.unshift({ role: m.role as "user" | "assistant", content: picked.length === 0 && cost > budget ? m.content.slice(-Math.max(budget, 2000)) : m.content });
    budget -= cost;
  }
  const messages: ChatMessage[] = [{ role: "system", content: sys }, ...picked];
  if (mode === "continue") messages.push({ role: "user", content: "Continue exatamente de onde você parou, sem repetir o que já foi escrito." });
  // modelo preferido do agente só vale com a conversa em Automático; provedor pago continua exigindo a permissão do usuário
  const pref = resolveModelPref(modelPref ?? prefs?.default_model ?? "auto", agent?.preferred_model, (id) => PAID_IDS.has(id), prefs?.allow_paid_auto === true);

  // 4. stream SSE
  const enc = new TextEncoder();
  let ping: number | undefined;
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        try { controller.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)); } catch { /* cliente saiu */ }
      };
      ping = setInterval(() => { try { controller.enqueue(enc.encode(": ping\n\n")); } catch { /* ignore */ } }, 8000) as unknown as number;
      send("meta", { conversation_id: convId, title, user_message: userMsg, mode, agent_id: agentId });
      let text = "";
      let finished = false;
      let provider: string | null = null;
      let model: string | null = null;
      let fallbackUsed = false;
      let tin = 0, tout = 0;
      try {
        for await (const ev of manager().run(messages, pref, req.signal, undefined, { allowPaid: prefs?.allow_paid_auto === true, paidGate: paidGateFor(userId) })) {
          switch (ev.type) {
            case "attempt": provider = ev.provider; model = ev.model; send("attempt", { provider: ev.provider, model: ev.model }); break;
            case "delta": text += ev.text; send("delta", { t: ev.text }); break;
            case "reset": text = ""; send("reset", {}); break;
            case "fallback": send("fallback", { provider: ev.provider, model: ev.model, kind: ev.kind, status: ev.status }); break;
            case "done": provider = ev.provider; model = ev.model; fallbackUsed = ev.fallbackUsed; tin = ev.tin; tout = ev.tout; finished = true; break;
            case "exhausted": {
              const mins = Math.max(1, Math.ceil(ev.retryAfterS / 60));
              send("error", {
                code: "all_exhausted",
                message: `Todos os modelos disponíveis atingiram o limite ou estão indisponíveis agora. Tente novamente em cerca de ${mins} minuto${mins > 1 ? "s" : ""}.`,
                retry_after: ev.retryAfterS, tried: ev.tried, unconfigured: ev.unconfigured,
              });
              break;
            }
            case "aborted": break;
          }
        }
        if ((finished || (req.signal.aborted && text.trim())) && text.trim()) {
          const finalText = prevAssistant ? prevAssistant.content + text : text;
          let saved: Msg;
          if (prevAssistant) {
            const { data, error } = await db().from("messages").update({ content: finalText, provider, model, fallback_used: fallbackUsed }).eq("id", prevAssistant.id).eq("user_id", userId)
              .select("id,seq,role,content,provider,model,fallback_used,created_at").single();
            if (error) throw new Error("msg_update_failed");
            saved = data as Msg;
          } else {
            const { data, error } = await db().from("messages").insert({ conversation_id: convId, user_id: userId, role: "assistant", content: text, provider, model, fallback_used: fallbackUsed, tokens_in: tin, tokens_out: tout })
              .select("id,seq,role,content,provider,model,fallback_used,created_at").single();
            if (error) throw new Error("msg_insert_failed");
            saved = data as Msg;
          }
          await db().from("conversations").update({ updated_at: new Date().toISOString() }).eq("id", convId).eq("user_id", userId);
          send("done", { message: saved });
          // resumo automático de conversas longas, fora do caminho crítico
          const job = summarize(convId, userId, convRow?.summary ?? null, upto, prefs?.allow_paid_auto === true);
          // deno-lint-ignore no-explicit-any
          const rt = (globalThis as any).EdgeRuntime;
          if (rt?.waitUntil) rt.waitUntil(job); else await job;
        }
      } catch (e) {
        console.error("erro no chat:", (e as Error).message);
        send("error", { code: "internal", message: "Erro ao gerar a resposta. Tente novamente." });
      } finally {
        clearInterval(ping);
        try { controller.close(); } catch { /* já fechado */ }
      }
    },
    cancel() { clearInterval(ping); },
  });
  return new Response(stream, {
    headers: { ...corsHeaders(req), "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-store, no-transform", "X-Accel-Buffering": "no" },
  });
});

void json;
