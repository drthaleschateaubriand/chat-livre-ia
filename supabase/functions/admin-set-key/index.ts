// Edge Function `admin-set-key`: o DONO cadastra/remove chaves de provedores sem expô-las no chat.
// Autenticação: cabeçalho `x-admin-token` comparado (hash SHA-256, tempo constante) com ADMIN_TOKEN_HASH em server_secrets.
// Corpo: { action: "set"|"delete"|"status"|"clear-cooldown"|"pause" (+ seconds), provider: "groq"|"gemini"|"openrouter"|"xai", key?: string, validate?: boolean }
import { db, invalidateSecret, requireSecret } from "../_shared/db.ts";
import { sha256Hex, timingSafeEqual } from "../_shared/crypto.ts";
import { HttpError, json, readJson, serve } from "../_shared/http.ts";
import { ipHash, rateHit, ratePeek, tooMany } from "../_shared/session.ts";
import { KEY_SECRET, PROVIDER_IDS } from "../_shared/providers/registry.ts";
import { createUser, encryptFor, rotateCode } from "../_shared/owner.ts";

const CHECKS: Record<string, (key: string) => Promise<boolean>> = {
  groq: async (k) => (await fetch("https://api.groq.com/openai/v1/models", { headers: { Authorization: `Bearer ${k}` }, signal: AbortSignal.timeout(10000) })).ok,
  gemini: async (k) => (await fetch("https://generativelanguage.googleapis.com/v1beta/openai/models", { headers: { Authorization: `Bearer ${k}` }, signal: AbortSignal.timeout(10000) })).ok,
  // xAI: GET /v1/models com a chave (não consome créditos); 200 = chave válida
  xai: async (k) => (await fetch("https://api.x.ai/v1/models", { headers: { Authorization: `Bearer ${k}` }, signal: AbortSignal.timeout(10000) })).ok,
  openrouter: async (k) => (await fetch("https://openrouter.ai/api/v1/auth/key", { headers: { Authorization: `Bearer ${k}` }, signal: AbortSignal.timeout(10000) })).ok,
};

serve(async (req) => {
  const ip = await ipHash(req);
  const rl = await rateHit("admin_ip", ip, 60, 600, 120);
  if (!rl.allowed) throw tooMany(rl.retryAfter);
  const blocked = await ratePeek("admin_fail_ip", ip);
  if (blocked > 0) throw tooMany(blocked);
  const token = req.headers.get("x-admin-token") ?? "";
  const expected = await requireSecret("ADMIN_TOKEN_HASH");
  const okAuth = token.length > 0 && token.length < 200 && timingSafeEqual(await sha256Hex(token), expected);
  if (!okAuth) {
    await rateHit("admin_fail_ip", ip, 5, 900, 600, 86400);
    throw new HttpError(401, "unauthorized", "Não autorizado.");
  }
  const body = await readJson(req, 20_000);
  const action = String(body.action ?? "");
  const provider = String(body.provider ?? "");

  // ---- Conta única do dono (app privado) ----
  // Devolve o código UMA vez (ou, com encrypt_to = chave pública RSA PEM, apenas o texto cifrado: usado pelo fluxo via GitHub Actions).
  const deliver = async (code: string, extra: Record<string, unknown>) => {
    const pub = typeof body.encrypt_to === "string" ? body.encrypt_to : "";
    if (pub) return json(req, { ...extra, encrypted_code: await encryptFor(pub, code), alg: "RSA-OAEP-SHA256", note: "decifre com a chave privada do dono" });
    return json(req, { ...extra, code });
  };
  if (action === "owner-status") {
    const { data } = await db().from("users").select("id,created_at,last_login_at").eq("is_owner", true).maybeSingle();
    return json(req, { owner_exists: !!data, created_at: data?.created_at ?? null, last_login_at: data?.last_login_at ?? null });
  }
  if (action === "admin-create-owner") {
    const { data: ex } = await db().from("users").select("id").eq("is_owner", true).maybeSingle();
    if (ex) throw new HttpError(409, "owner_exists", "Já existe um dono. Para trocar o código use admin-reset-owner.");
    const u = await createUser({ owner: true });
    await db().from("auth_attempts").insert({ kind: "owner_create", ok: true, ip_hash: ip, reason: null });
    return await deliver(u.code, { ok: true, created: true });
  }
  if (action === "admin-reset-owner") {
    // sem user_id: reseta o DONO. Com user_id: só aceita contas de TESTE (nunca outro usuário real).
    let q = db().from("users").select("id,is_owner,is_test");
    if (typeof body.user_id === "string") q = q.eq("id", body.user_id).eq("is_test", true);
    else q = q.eq("is_owner", true);
    const { data: target } = await q.maybeSingle();
    if (!target) throw new HttpError(404, "not_found", typeof body.user_id === "string" ? "Conta de teste não encontrada." : "Não existe dono ainda. Use admin-create-owner.");
    const code = await rotateCode(target.id as string);
    await db().from("auth_attempts").insert({ kind: "owner_reset", ok: true, ip_hash: ip, reason: target.is_owner ? "owner" : "test" });
    return await deliver(code, { ok: true, reset: true, sessions_revoked: true, data_preserved: true });
  }
  // Contas de TESTE (só para as suítes de teste; exigem ADMIN_TOKEN; marcadas is_test e apagadas em massa). Não reabrem cadastro público.
  if (action === "admin-create-test-user") {
    const u = await createUser({ test: true });
    return json(req, { ok: true, user_id: u.userId, code: u.code });
  }
  if (action === "admin-delete-test-users") {
    const { data, error } = await db().from("users").delete().eq("is_test", true).eq("is_owner", false).select("id");
    if (error) throw new Error("delete_test_users_failed");
    return json(req, { ok: true, deleted: data?.length ?? 0 });
  }

  if (action === "status") {
    const out: Record<string, boolean> = {};
    for (const [p, secret] of Object.entries(KEY_SECRET)) {
      const { data } = await db().from("server_secrets").select("name").eq("name", secret).maybeSingle();
      out[p] = !!data;
    }
    return json(req, { configured: out, pollinations: "anônimo (sem chave)" });
  }

  if (action === "pause" || action === "clear-cooldown") {
    if (!(PROVIDER_IDS as readonly string[]).includes(provider)) throw new HttpError(400, "bad_request", "Provedor inválido.");
    if (action === "clear-cooldown") {
      await db().from("provider_state").delete().eq("provider", provider);
      return json(req, { ok: true });
    }
    const secs = Math.min(Math.max(Number(body.seconds) || 60, 1), 86400);
    await db().from("provider_state").upsert({
      provider, model: "*", cooldown_until: new Date(Date.now() + secs * 1000).toISOString(), last_error: "pausado manualmente (admin)",
      consecutive_failures: 0, updated_at: new Date().toISOString(),
    });
    return json(req, { ok: true, paused_seconds: secs });
  }

  if (!KEY_SECRET[provider]) throw new HttpError(400, "bad_request", "Provedor inválido. Use groq, gemini, openrouter ou xai.");
  const secret = KEY_SECRET[provider];

  if (action === "set") {
    const key = typeof body.key === "string" ? body.key.trim() : "";
    if (key.length < 8 || key.length > 400 || /\s/.test(key)) throw new HttpError(400, "bad_request", "Chave inválida.");
    if (body.validate !== false) {
      let valid = false;
      try { valid = await CHECKS[provider](key); } catch { valid = false; }
      if (!valid) throw new HttpError(422, "key_rejected", "O provedor recusou esta chave (ou não respondeu). Nada foi gravado. Use validate:false para gravar mesmo assim.");
    }
    const { error } = await db().from("server_secrets").upsert({ name: secret, value: key, updated_at: new Date().toISOString() });
    if (error) throw new Error("secret_write_failed");
    invalidateSecret(secret);
    // limpa cooldowns antigos (ex.: 401 de uma chave anterior)
    await db().from("provider_state").delete().eq("provider", provider);
    return json(req, { ok: true, provider, validated: body.validate !== false });
  }
  if (action === "delete") {
    await db().from("server_secrets").delete().eq("name", secret);
    invalidateSecret(secret);
    return json(req, { ok: true, provider, removed: true });
  }
  throw new HttpError(400, "bad_request", "Ação inválida.");
});
