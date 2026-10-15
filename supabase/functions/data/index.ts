// Edge Function `data`: conversas, mensagens, memórias, preferências, modelos, exportação e exclusão de conta.
// Toda consulta filtra por user_id vindo da SESSÃO (nunca do corpo).
import { db, requireSecret } from "../_shared/db.ts";
import { hmacHex, timingSafeEqual } from "../_shared/crypto.ts";
import { validateCode } from "../_shared/code.ts";
import { HttpError, json, readJson, serve, str, uuid } from "../_shared/http.ts";
import { ipHash, rateHit, ratePeek, requireSession, tooMany } from "../_shared/session.ts";
import { manager } from "../_shared/providers/index.ts";
import { AGENT_LIMITS, AgentValidationError, validateAgentInput } from "../_shared/agents.ts";

const THEMES = ["system", "light", "dark"];
const FONTS = ["sm", "md", "lg"];
const LANGS = ["pt-BR", "en-US", "es-ES"];
const MODEL_RE = /^(auto|[a-z]{3,20}\|[A-Za-z0-9._:\/\-]{1,100})$/;
const CONV_FIELDS = "id,title,pinned,agent_id,created_at,updated_at";
const AGENT_FIELDS = "id,name,description,instructions,emoji,preferred_model,created_at,updated_at";
const MSG_FIELDS = "id,seq,conversation_id,role,content,provider,model,fallback_used,created_at";

async function ownConv(userId: string, id: unknown) {
  const cid = uuid(id);
  const { data } = await db().from("conversations").select(CONV_FIELDS).eq("id", cid).eq("user_id", userId).maybeSingle();
  if (!data) throw new HttpError(404, "not_found", "Conversa não encontrada.");
  return data;
}

async function ownAgent(userId: string, id: unknown) {
  const { data } = await db().from("agents").select(AGENT_FIELDS).eq("id", uuid(id)).eq("user_id", userId).maybeSingle();
  if (!data) throw new HttpError(404, "not_found", "Agente não encontrado.");
  return data;
}
function agentInput(body: Record<string, unknown>) {
  try { return validateAgentInput(body); } catch (e) {
    if (e instanceof AgentValidationError) throw new HttpError(400, "bad_request", e.message);
    throw e;
  }
}

function escLike(q: string): string {
  return q.replace(/[\\%_]/g, (c) => "\\" + c);
}

serve(async (req) => {
  const a = await requireSession(req);
  const uid = a.userId;
  const body = await readJson(req);
  const action = String(body.action ?? "");
  const rl = await rateHit("data_user_min", uid, 240, 60, 20, 300);
  if (!rl.allowed) throw tooMany(rl.retryAfter);

  switch (action) {
    case "bootstrap": {
      const [p, c, ag] = await Promise.all([
        db().from("preferences").select("theme,font_size,language,memory_enabled,default_model,auto_speak,allow_paid_auto").eq("user_id", uid).maybeSingle(),
        db().from("conversations").select(CONV_FIELDS).eq("user_id", uid).order("updated_at", { ascending: false }).limit(500),
        db().from("agents").select(AGENT_FIELDS).eq("user_id", uid).order("created_at").limit(AGENT_LIMITS.perUser),
      ]);
      return json(req, { preferences: p.data, conversations: c.data ?? [], agents: ag.data ?? [] });
    }

    case "conv.list": {
      const { data } = await db().from("conversations").select(CONV_FIELDS).eq("user_id", uid).order("updated_at", { ascending: false }).limit(500);
      return json(req, { conversations: data ?? [] });
    }

    case "conv.create": {
      const title = typeof body.title === "string" && body.title.trim() ? body.title.trim().slice(0, 120) : "Nova conversa";
      let agent_id: string | null = null;
      if (body.agent_id !== undefined && body.agent_id !== null) agent_id = (await ownAgent(uid, body.agent_id)).id;
      const { data, error } = await db().from("conversations").insert({ user_id: uid, title, agent_id }).select(CONV_FIELDS).single();
      if (error) throw new Error("conv_create_failed");
      return json(req, { conversation: data }, 201);
    }

    case "conv.set_agent": {
      // troca ou remove (agent_id: null) o agente de uma conversa; ambos precisam ser do usuário da sessão
      await ownConv(uid, body.id);
      const agent_id = body.agent_id === null || body.agent_id === undefined ? null : (await ownAgent(uid, body.agent_id)).id;
      const { data } = await db().from("conversations").update({ agent_id }).eq("id", uuid(body.id)).eq("user_id", uid).select(CONV_FIELDS).single();
      return json(req, { conversation: data });
    }

    case "agent.list": {
      const { data } = await db().from("agents").select(AGENT_FIELDS).eq("user_id", uid).order("created_at").limit(AGENT_LIMITS.perUser);
      return json(req, { agents: data ?? [] });
    }
    case "agent.create":
    case "agent.duplicate": {
      const { count } = await db().from("agents").select("id", { count: "exact", head: true }).eq("user_id", uid);
      if ((count ?? 0) >= AGENT_LIMITS.perUser) throw new HttpError(400, "limit", `Limite de ${AGENT_LIMITS.perUser} agentes atingido.`);
      let input;
      if (action === "agent.duplicate") {
        const src = await ownAgent(uid, body.id);
        const name = `${src.name} (cópia)`.slice(0, AGENT_LIMITS.name);
        input = { name, description: src.description, instructions: src.instructions, emoji: src.emoji, preferred_model: src.preferred_model };
      } else input = agentInput(body);
      const { data, error } = await db().from("agents").insert({ user_id: uid, ...input }).select(AGENT_FIELDS).single();
      if (error) throw new Error("agent_create_failed");
      return json(req, { agent: data }, 201);
    }
    case "agent.update": {
      await ownAgent(uid, body.id);
      const input = agentInput(body);
      const { data, error } = await db().from("agents").update({ ...input, updated_at: new Date().toISOString() }).eq("id", uuid(body.id)).eq("user_id", uid).select(AGENT_FIELDS).single();
      if (error) throw new Error("agent_update_failed");
      return json(req, { agent: data });
    }
    case "agent.delete": {
      await ownAgent(uid, body.id);
      await db().from("agents").delete().eq("id", uuid(body.id)).eq("user_id", uid); // conversas ficam (agent_id vira null)
      return json(req, { ok: true });
    }

    case "conv.rename": {
      await ownConv(uid, body.id);
      const title = str(body.title, 200).trim().slice(0, 120);
      if (!title) throw new HttpError(400, "bad_request", "Título vazio.");
      const { data } = await db().from("conversations").update({ title }).eq("id", uuid(body.id)).eq("user_id", uid).select(CONV_FIELDS).single();
      return json(req, { conversation: data });
    }

    case "conv.pin": {
      await ownConv(uid, body.id);
      const { data } = await db().from("conversations").update({ pinned: body.pinned === true }).eq("id", uuid(body.id)).eq("user_id", uid).select(CONV_FIELDS).single();
      return json(req, { conversation: data });
    }

    case "conv.delete": {
      await ownConv(uid, body.id);
      await db().from("conversations").delete().eq("id", uuid(body.id)).eq("user_id", uid);
      return json(req, { ok: true });
    }

    case "conv.messages": {
      const conv = await ownConv(uid, body.id);
      const { data } = await db().from("messages").select(MSG_FIELDS).eq("conversation_id", conv.id).eq("user_id", uid).order("seq").limit(2000);
      return json(req, { conversation: conv, messages: data ?? [] });
    }

    case "conv.search": {
      const q = str(body.q, 100).trim();
      if (q.length < 2) return json(req, { results: [] });
      const like = `%${escLike(q)}%`;
      const [t, m] = await Promise.all([
        db().from("conversations").select(CONV_FIELDS).eq("user_id", uid).ilike("title", like).limit(30),
        db().from("messages").select("conversation_id,content,created_at").eq("user_id", uid).ilike("content", like).order("created_at", { ascending: false }).limit(60),
      ]);
      const ids = new Set<string>();
      const results: { conversation_id: string; title: string; snippet: string; updated_at: string; pinned: boolean }[] = [];
      for (const c of t.data ?? []) { ids.add(c.id); results.push({ conversation_id: c.id, title: c.title, snippet: "", updated_at: c.updated_at, pinned: c.pinned }); }
      const need = [...new Set((m.data ?? []).map((x) => x.conversation_id))].filter((i) => !ids.has(i));
      const convs = need.length ? (await db().from("conversations").select(CONV_FIELDS).eq("user_id", uid).in("id", need)).data ?? [] : [];
      const byId = new Map(convs.map((c) => [c.id, c]));
      for (const msg of m.data ?? []) {
        const c = byId.get(msg.conversation_id);
        if (!c || ids.has(c.id)) continue;
        ids.add(c.id);
        const i = msg.content.toLowerCase().indexOf(q.toLowerCase());
        const snippet = msg.content.slice(Math.max(0, i - 40), i + q.length + 80).replace(/\s+/g, " ");
        results.push({ conversation_id: c.id, title: c.title, snippet, updated_at: c.updated_at, pinned: c.pinned });
      }
      return json(req, { results });
    }

    case "mem.list": {
      const { data } = await db().from("memories").select("id,content,created_at,updated_at").eq("user_id", uid).order("created_at", { ascending: false }).limit(200);
      return json(req, { memories: data ?? [] });
    }
    case "mem.create": {
      const content = str(body.content, 1000).trim().slice(0, 500);
      if (!content) throw new HttpError(400, "bad_request", "Memória vazia.");
      const { count } = await db().from("memories").select("id", { count: "exact", head: true }).eq("user_id", uid);
      if ((count ?? 0) >= 100) throw new HttpError(400, "limit", "Limite de 100 memórias atingido.");
      const { data, error } = await db().from("memories").insert({ user_id: uid, content }).select("id,content,created_at,updated_at").single();
      if (error) throw new Error("mem_create_failed");
      return json(req, { memory: data }, 201);
    }
    case "mem.update": {
      const content = str(body.content, 1000).trim().slice(0, 500);
      if (!content) throw new HttpError(400, "bad_request", "Memória vazia.");
      const { data } = await db().from("memories").update({ content, updated_at: new Date().toISOString() }).eq("id", uuid(body.id)).eq("user_id", uid).select("id,content,created_at,updated_at");
      if (!data || !data.length) throw new HttpError(404, "not_found", "Memória não encontrada.");
      return json(req, { memory: data[0] });
    }
    case "mem.delete": {
      const { data } = await db().from("memories").delete().eq("id", uuid(body.id)).eq("user_id", uid).select("id");
      if (!data || !data.length) throw new HttpError(404, "not_found", "Memória não encontrada.");
      return json(req, { ok: true });
    }

    case "prefs.get": {
      const { data } = await db().from("preferences").select("theme,font_size,language,memory_enabled,default_model,auto_speak,allow_paid_auto").eq("user_id", uid).maybeSingle();
      return json(req, { preferences: data });
    }
    case "prefs.update": {
      const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (body.theme !== undefined) { if (!THEMES.includes(String(body.theme))) throw new HttpError(400, "bad_request", "Tema inválido."); patch.theme = body.theme; }
      if (body.font_size !== undefined) { if (!FONTS.includes(String(body.font_size))) throw new HttpError(400, "bad_request", "Tamanho inválido."); patch.font_size = body.font_size; }
      if (body.language !== undefined) { if (!LANGS.includes(String(body.language))) throw new HttpError(400, "bad_request", "Idioma inválido."); patch.language = body.language; }
      if (body.memory_enabled !== undefined) patch.memory_enabled = body.memory_enabled === true;
      if (body.auto_speak !== undefined) patch.auto_speak = body.auto_speak === true;
      if (body.allow_paid_auto !== undefined) patch.allow_paid_auto = body.allow_paid_auto === true;
      if (body.default_model !== undefined) { if (!MODEL_RE.test(String(body.default_model))) throw new HttpError(400, "bad_request", "Modelo inválido."); patch.default_model = body.default_model; }
      const { data } = await db().from("preferences").update(patch).eq("user_id", uid).select("theme,font_size,language,memory_enabled,default_model,auto_speak,allow_paid_auto").single();
      return json(req, { preferences: data });
    }

    case "models.list": {
      const catalog = await manager().catalog();
      const today = new Date().toISOString().slice(0, 10);
      const { data: usage } = await db().from("provider_usage").select("provider,model,requests,tokens_in,tokens_out,errors,rate_limited,limit_info").eq("day", today);
      return json(req, { catalog, usage: usage ?? [], day: today });
    }

    case "export.all": {
      const [p, c, m, mem, s, ag] = await Promise.all([
        db().from("preferences").select("theme,font_size,language,memory_enabled,default_model,auto_speak,allow_paid_auto").eq("user_id", uid).maybeSingle(),
        db().from("conversations").select("id,title,pinned,agent_id,summary,created_at,updated_at").eq("user_id", uid).order("created_at"),
        db().from("messages").select("id,conversation_id,role,content,provider,model,fallback_used,tokens_in,tokens_out,created_at").eq("user_id", uid).order("seq"),
        db().from("memories").select("id,content,created_at,updated_at").eq("user_id", uid).order("created_at"),
        db().from("sessions").select("id,device_name,created_at,last_seen_at,persistent,revoked_at").eq("user_id", uid),
        db().from("agents").select(AGENT_FIELDS).eq("user_id", uid).order("created_at"),
      ]);
      return json(req, { exported_at: new Date().toISOString(), app: "CHAT LIVRE IA", preferences: p.data, conversations: c.data ?? [], messages: m.data ?? [], memories: mem.data ?? [], agents: ag.data ?? [], devices: s.data ?? [] });
    }

    case "account.delete": {
      {
        // app privado: a conta do dono não pode ser excluída pela interface (não há como recriá-la sem o ADMIN_TOKEN)
        const { data: me } = await db().from("users").select("is_owner").eq("id", uid).single();
        if (me?.is_owner) throw new HttpError(403, "owner_protected", "A conta do dono não pode ser excluída pelo app. Você pode apagar conversas e exportar seus dados.");
      }
      // exige reentrada do código (proteção contra sessão roubada) + mesmo limitador de falhas do login
      const ip = await ipHash(req);
      const blocked = await ratePeek("login_fail_ip", ip);
      if (blocked > 0) throw tooMany(blocked);
      const chk = validateCode(typeof body.code === "string" ? body.code : "");
      const pepper = await requireSecret("PEPPER");
      let ok = false;
      if (chk.ok) {
        const { data } = await db().from("users").select("code_verify").eq("id", uid).single();
        ok = !!data && timingSafeEqual(data.code_verify, await hmacHex(pepper, "verify:" + chk.code));
      }
      if (!ok) {
        const f = await rateHit("login_fail_ip", ip, 5, 900, 300);
        if (!f.allowed) throw tooMany(f.retryAfter);
        throw new HttpError(401, "invalid_credentials", "Código incorreto. A conta não foi excluída.");
      }
      const { error } = await db().from("users").delete().eq("id", uid); // cascade apaga tudo
      if (error) throw new Error("account_delete_failed");
      return json(req, { ok: true });
    }

    default:
      throw new HttpError(404, "not_found", "Ação inexistente.");
  }
});
