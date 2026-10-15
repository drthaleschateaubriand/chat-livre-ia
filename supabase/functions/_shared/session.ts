import { db, requireSecret } from "./db.ts";
import { hmacHex, sha256Hex } from "./crypto.ts";
import { HttpError, clientIp } from "./http.ts";

export interface Auth {
  userId: string;
  sessionId: string;
}

/** Valida o token de acesso. O user_id SEMPRE vem daqui (nunca do corpo da requisição). */
export async function requireSession(req: Request): Promise<Auth> {
  const h = req.headers.get("authorization") ?? "";
  const m = /^Bearer\s+([A-Za-z0-9_\-]{20,100})$/.exec(h);
  if (!m) throw new HttpError(401, "unauthorized", "Sessão ausente.");
  const hash = await sha256Hex(m[1]);
  const { data, error } = await db().from("sessions")
    .select("id,user_id,access_expires_at,revoked_at,last_seen_at")
    .eq("access_hash", hash).maybeSingle();
  if (error) throw new Error("session_lookup_failed");
  if (!data || data.revoked_at) throw new HttpError(401, "unauthorized", "Sessão inválida ou encerrada.");
  if (new Date(data.access_expires_at).getTime() <= Date.now()) throw new HttpError(401, "token_expired", "Sessão expirada.");
  if (Date.now() - new Date(data.last_seen_at).getTime() > 5 * 60_000) {
    await db().from("sessions").update({ last_seen_at: new Date().toISOString() }).eq("id", data.id);
  }
  return { userId: data.user_id, sessionId: data.id };
}

export async function ipHash(req: Request): Promise<string> {
  return (await hmacHex(await requireSecret("PEPPER"), "ip:" + clientIp(req))).slice(0, 32);
}

export async function rateHit(scope: string, key: string, max: number, windowS: number, blockS: number, maxBlockS = 86400) {
  const { data, error } = await db().rpc("rl_hit", { p_scope: scope, p_key: key, p_max: max, p_window: windowS, p_block: blockS, p_max_block: maxBlockS });
  if (error) throw new Error("rate_limit_failed");
  const row = Array.isArray(data) ? data[0] : data;
  return { allowed: !!row?.allowed, retryAfter: Number(row?.retry_after ?? 0) };
}

export async function ratePeek(scope: string, key: string): Promise<number> {
  const { data, error } = await db().rpc("rl_peek", { p_scope: scope, p_key: key });
  if (error) throw new Error("rate_limit_failed");
  return Number(data ?? 0);
}

export function tooMany(retryAfter: number): HttpError {
  return new HttpError(429, "rate_limited", "Muitas tentativas. Aguarde antes de tentar novamente.", { retry_after: retryAfter }, { "Retry-After": String(retryAfter) });
}
