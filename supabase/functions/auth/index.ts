// Edge Function `auth`: criação de conta, login numérico, sessões, refresh com rotação, revogação.
import { db, requireSecret } from "../_shared/db.ts";
import { generateCode, validateCode } from "../_shared/code.ts";
import { hmacHex, randomToken, sha256Hex, timingSafeEqual } from "../_shared/crypto.ts";
import { HttpError, clientIp, json, readJson, serve, str, uuid } from "../_shared/http.ts";
import { ipHash, rateHit, ratePeek, requireSession, tooMany } from "../_shared/session.ts";

const ACCESS_TTL_S = 15 * 60; // acesso curto
const REFRESH_PERSISTENT_S = 30 * 24 * 3600; // "manter conectado": 30 dias
const REFRESH_SHORT_S = 12 * 3600; // sessão curta: 12 horas
const POW_BITS = 14;
const POW_TTL_MS = 10 * 60_000;
const GENERIC_LOGIN_ERROR = "Código inválido ou não encontrado.";

const iso = (ms: number) => new Date(ms).toISOString();

function deviceNameFrom(ua: string, custom?: unknown): string {
  if (typeof custom === "string" && custom.trim()) return custom.trim().replace(/[<>\u0000-\u001f]/g, "").slice(0, 60);
  const os = /iPhone/.test(ua) ? "iPhone" : /iPad/.test(ua) ? "iPad" : /Android/.test(ua) ? "Android" : /Windows/.test(ua) ? "Windows" : /Mac OS X|Macintosh/.test(ua) ? "Mac" : /Linux|X11/.test(ua) ? "Linux" : "Dispositivo";
  const br = /Edg\//.test(ua) ? "Edge" : /OPR\/|Opera/.test(ua) ? "Opera" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\/|CriOS/.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "";
  return br ? `${os} · ${br}` : os;
}

async function logAttempt(kind: string, ok: boolean, ip: string, reason?: string) {
  await db().from("auth_attempts").insert({ kind, ok, ip_hash: ip, reason: reason ?? null });
}

async function createSession(userId: string, persistent: boolean, req: Request, ip: string, custom?: unknown) {
  const access = randomToken(32);
  const refresh = randomToken(32);
  const now = Date.now();
  const ua = (req.headers.get("user-agent") ?? "").slice(0, 300);
  const { data, error } = await db().from("sessions").insert({
    user_id: userId,
    access_hash: await sha256Hex(access),
    access_expires_at: iso(now + ACCESS_TTL_S * 1000),
    refresh_hash: await sha256Hex(refresh),
    refresh_expires_at: iso(now + (persistent ? REFRESH_PERSISTENT_S : REFRESH_SHORT_S) * 1000),
    persistent,
    device_name: deviceNameFrom(ua, custom),
    user_agent: ua,
    ip_hash: ip,
  }).select("id").single();
  if (error) throw new Error("session_create_failed");
  return {
    session_id: data.id as string,
    access_token: access,
    access_expires_in: ACCESS_TTL_S,
    refresh_token: refresh,
    refresh_expires_in: persistent ? REFRESH_PERSISTENT_S : REFRESH_SHORT_S,
    persistent,
  };
}

// --- Proof-of-work simples para criação de conta ---
async function powChallenge(): Promise<string> {
  const pepper = await requireSecret("PEPPER");
  const body = `${Date.now() + POW_TTL_MS}.${randomToken(12)}`;
  return `${body}.${(await hmacHex(pepper, "pow:" + body)).slice(0, 32)}`;
}

function leadingZeroBits(hex: string): number {
  let bits = 0;
  for (const ch of hex) {
    const v = parseInt(ch, 16);
    if (v === 0) { bits += 4; continue; }
    bits += Math.clz32(v) - 28;
    break;
  }
  return bits;
}

async function verifyPow(challenge: unknown, nonce: unknown): Promise<boolean> {
  if (typeof challenge !== "string" || typeof nonce !== "string" || nonce.length > 40 || challenge.length > 120) return false;
  const parts = challenge.split(".");
  if (parts.length !== 3) return false;
  const [exp, rnd, sig] = parts;
  const pepper = await requireSecret("PEPPER");
  const expected = (await hmacHex(pepper, `pow:${exp}.${rnd}`)).slice(0, 32);
  if (!timingSafeEqual(expected, sig)) return false;
  if (Number(exp) < Date.now()) return false;
  if (leadingZeroBits(await sha256Hex(`${challenge}:${nonce}`)) < POW_BITS) return false;
  // uso único
  const used = await rateHit("pow_used", (await sha256Hex(challenge)).slice(0, 32), 1, 1200, 1200);
  return used.allowed;
}

serve(async (req, action) => {
  const body = await readJson(req);
  const ip = await ipHash(req);

  switch (action) {
    case "challenge": {
      const r = await rateHit("challenge_ip", ip, 30, 600, 60);
      if (!r.allowed) throw tooMany(r.retryAfter);
      return json(req, { challenge: await powChallenge(), bits: POW_BITS });
    }

    case "register": {
      const generic = new HttpError(400, "register_failed", "Não foi possível criar a conta agora. Tente novamente mais tarde.");
      // honeypot: campo que humanos não veem
      if (typeof body.website === "string" && body.website.length > 0) { await logAttempt("register", false, ip, "honeypot"); throw generic; }
      const a = await rateHit("register_ip_hour", ip, 5, 3600, 600);
      if (!a.allowed) { await logAttempt("register", false, ip, "ip_limit"); throw tooMany(a.retryAfter); }
      const g = await rateHit("register_global_hour", "all", 200, 3600, 60, 3600);
      if (!g.allowed) { await logAttempt("register", false, ip, "global_limit"); throw tooMany(g.retryAfter); }
      if (!(await verifyPow(body.pow_challenge, body.pow_nonce))) { await logAttempt("register", false, ip, "pow"); throw new HttpError(400, "pow_failed", "Verificação anti-automação falhou. Recarregue a página e tente de novo."); }

      const pepper = await requireSecret("PEPPER");
      let userId: string | null = null;
      let code = "";
      for (let i = 0; i < 5 && !userId; i++) {
        code = generateCode();
        const { data, error } = await db().from("users").insert({
          code_lookup: await hmacHex(pepper, "lookup:" + code),
          code_verify: await hmacHex(pepper, "verify:" + code),
        }).select("id").single();
        if (!error) userId = data.id as string;
        else if (error.code !== "23505") throw new Error("user_create_failed");
      }
      if (!userId) throw new Error("user_create_failed");
      await db().from("preferences").insert({ user_id: userId });
      const persistent = body.persistent !== false;
      const session = await createSession(userId, persistent, req, ip, body.device_name);
      await logAttempt("register", true, ip);
      // O código só existe em texto puro nesta resposta. Não é guardado em lugar nenhum.
      return json(req, { code, ...session });
    }

    case "login": {
      const g = await rateHit("login_global", "all", 600, 600, 30, 600);
      if (!g.allowed) throw tooMany(g.retryAfter);
      const a = await rateHit("login_ip", ip, 30, 600, 60);
      if (!a.allowed) throw tooMany(a.retryAfter);
      const blocked = await ratePeek("login_fail_ip", ip);
      if (blocked > 0) throw tooMany(blocked);

      const chk = validateCode(typeof body.code === "string" ? body.code : "");
      const fail = async (reason: string) => {
        await logAttempt("login", false, ip, reason);
        const f = await rateHit("login_fail_ip", ip, 5, 900, 300);
        if (!f.allowed) throw tooMany(f.retryAfter);
        throw new HttpError(401, "invalid_credentials", GENERIC_LOGIN_ERROR);
      };
      if (!chk.ok) return await fail("format_" + chk.reason);

      const pepper = await requireSecret("PEPPER");
      const lookup = await hmacHex(pepper, "lookup:" + chk.code);
      const verify = await hmacHex(pepper, "verify:" + chk.code);
      const { data: user, error } = await db().from("users").select("id,code_verify").eq("code_lookup", lookup).maybeSingle();
      if (error) throw new Error("user_lookup_failed");
      const stored = user?.code_verify ?? "0".repeat(64);
      const okCmp = timingSafeEqual(stored, verify);
      if (!user || !okCmp) return await fail("not_found");

      const persistent = body.persistent !== false;
      const session = await createSession(user.id, persistent, req, ip, body.device_name);
      await db().from("users").update({ last_login_at: iso(Date.now()) }).eq("id", user.id);
      await logAttempt("login", true, ip);
      if (Math.random() < 0.02) await db().rpc("housekeeping");
      return json(req, { ...session });
    }

    // Confirma que o código digitado pertence a ESTA sessão (usado em Ajustes antes de gerar o QR de acesso).
    // Mesmos limites e contadores de falha do login normal; não cria sessão nova; o código nunca é guardado.
    case "verify-code": {
      const a = await requireSession(req);
      const ra = await rateHit("login_ip", ip, 30, 600, 60);
      if (!ra.allowed) throw tooMany(ra.retryAfter);
      const blocked = await ratePeek("login_fail_ip", ip);
      if (blocked > 0) throw tooMany(blocked);
      const chk = validateCode(typeof body.code === "string" ? body.code : "");
      const fail = async (reason: string) => {
        await logAttempt("verify", false, ip, reason);
        const f = await rateHit("login_fail_ip", ip, 5, 900, 300);
        if (!f.allowed) throw tooMany(f.retryAfter);
        throw new HttpError(401, "invalid_credentials", GENERIC_LOGIN_ERROR);
      };
      if (!chk.ok) return await fail("format_" + chk.reason);
      const pepper = await requireSecret("PEPPER");
      const lookup = await hmacHex(pepper, "lookup:" + chk.code);
      const verify = await hmacHex(pepper, "verify:" + chk.code);
      const { data: user } = await db().from("users").select("id,code_verify").eq("id", a.userId).eq("code_lookup", lookup).maybeSingle();
      const okCmp = timingSafeEqual(user?.code_verify ?? "0".repeat(64), verify);
      if (!user || !okCmp) return await fail("not_found");
      await logAttempt("verify", true, ip);
      return json(req, { ok: true });
    }

    case "refresh": {
      const r = await rateHit("refresh_ip", ip, 120, 600, 60);
      if (!r.allowed) throw tooMany(r.retryAfter);
      const token = str(body.refresh_token, 100);
      const hash = await sha256Hex(token);
      const { data: s, error } = await db().from("sessions")
        .select("id,user_id,persistent,created_at,refresh_expires_at,revoked_at,rotated_at").eq("refresh_hash", hash).maybeSingle();
      if (error) throw new Error("refresh_lookup_failed");
      if (!s) {
        // reuso de um refresh antigo após rotação => possível roubo: revoga a sessão (exceto corrida legítima de abas)
        const { data: old } = await db().from("sessions").select("id,rotated_at,revoked_at").eq("prev_refresh_hash", hash).maybeSingle();
        if (old && !old.revoked_at) {
          if (old.rotated_at && Date.now() - new Date(old.rotated_at).getTime() < 20_000) {
            throw new HttpError(409, "refresh_race", "Sessão já renovada por outra aba. Tente de novo.");
          }
          await db().from("sessions").update({ revoked_at: iso(Date.now()) }).eq("id", old.id);
        }
        throw new HttpError(401, "unauthorized", "Sessão inválida.");
      }
      if (s.revoked_at || new Date(s.refresh_expires_at).getTime() <= Date.now()) throw new HttpError(401, "unauthorized", "Sessão encerrada ou expirada.");
      const access = randomToken(32);
      const refresh = randomToken(32);
      const now = Date.now();
      const refreshExp = s.persistent ? now + REFRESH_PERSISTENT_S * 1000 : Math.min(new Date(s.refresh_expires_at).getTime(), new Date(s.created_at).getTime() + REFRESH_SHORT_S * 1000);
      // update condicional: só rotaciona se o refresh ainda for o mesmo (evita duas rotações concorrentes)
      const { data: upd, error: ue } = await db().from("sessions").update({
        access_hash: await sha256Hex(access), access_expires_at: iso(now + ACCESS_TTL_S * 1000),
        refresh_hash: await sha256Hex(refresh), prev_refresh_hash: hash, refresh_expires_at: iso(refreshExp),
        rotated_at: iso(now), last_seen_at: iso(now),
      }).eq("id", s.id).eq("refresh_hash", hash).select("id");
      if (ue) throw new Error("refresh_failed");
      if (!upd || upd.length === 0) throw new HttpError(409, "refresh_race", "Sessão já renovada por outra aba. Tente de novo.");
      return json(req, {
        session_id: s.id, access_token: access, access_expires_in: ACCESS_TTL_S, refresh_token: refresh,
        refresh_expires_in: Math.floor((refreshExp - now) / 1000), persistent: s.persistent,
      });
    }

    case "me": {
      const a = await requireSession(req);
      const { data } = await db().from("users").select("id,created_at").eq("id", a.userId).single();
      return json(req, { user: { id: data?.id, created_at: data?.created_at }, session_id: a.sessionId });
    }

    case "logout": {
      const a = await requireSession(req);
      await db().from("sessions").update({ revoked_at: iso(Date.now()) }).eq("id", a.sessionId).eq("user_id", a.userId);
      return json(req, { ok: true });
    }

    case "logout-all": {
      const a = await requireSession(req);
      await db().from("sessions").update({ revoked_at: iso(Date.now()) }).eq("user_id", a.userId).is("revoked_at", null);
      return json(req, { ok: true });
    }

    case "sessions": {
      const a = await requireSession(req);
      const { data, error } = await db().from("sessions")
        .select("id,device_name,created_at,last_seen_at,persistent,refresh_expires_at")
        .eq("user_id", a.userId).is("revoked_at", null).gt("refresh_expires_at", iso(Date.now()))
        .order("last_seen_at", { ascending: false });
      if (error) throw new Error("sessions_failed");
      return json(req, { sessions: (data ?? []).map((s) => ({ ...s, current: s.id === a.sessionId })) });
    }

    case "revoke-session": {
      const a = await requireSession(req);
      const id = uuid(body.id);
      // a propriedade é verificada pelo filtro user_id da SESSÃO autenticada
      const { data } = await db().from("sessions").update({ revoked_at: iso(Date.now()) }).eq("id", id).eq("user_id", a.userId).is("revoked_at", null).select("id");
      if (!data || data.length === 0) throw new HttpError(404, "not_found", "Dispositivo não encontrado.");
      return json(req, { ok: true, was_current: id === a.sessionId });
    }

    default:
      throw new HttpError(404, "not_found", "Rota inexistente.");
  }
});

// evita aviso de import não usado em algumas versões do Deno
void clientIp;
