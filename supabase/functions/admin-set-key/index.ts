// Edge Function `admin-set-key`: o DONO cadastra/remove chaves de provedores sem expô-las no chat.
// Autenticação: cabeçalho `x-admin-token` comparado (hash SHA-256, tempo constante) com ADMIN_TOKEN_HASH em server_secrets.
// Corpo: { action: "set"|"delete"|"status"|"clear-cooldown"|"pause" (+ seconds), provider: "groq"|"gemini"|"openrouter"|"xai", key?: string, validate?: boolean }
import { db, invalidateSecret, requireSecret } from "../_shared/db.ts";
import { sha256Hex, timingSafeEqual } from "../_shared/crypto.ts";
import { HttpError, json, readJson, serve } from "../_shared/http.ts";
import { ipHash, rateHit, ratePeek, tooMany } from "../_shared/session.ts";
import { KEY_SECRET, PROVIDER_IDS } from "../_shared/providers/registry.ts";

const CHECKS: Record<string, (key: string) => Promise<boolean>> = {
  groq: async (k) => (await fetch("https://api.groq.com/openai/v1/models", { headers: { Authorization: `Bearer ${k}` }, signal: AbortSignal.timeout(10000) })).ok,
  gemini: async (k) => (await fetch("https://generativelanguage.googleapis.com/v1beta/openai/models", { headers: { Authorization: `Bearer ${k}` }, signal: AbortSignal.timeout(10000) })).ok,
  // xAI: GET /v1/models com a chave (não consome créditos); 200 = chave válida
  xai: async (k) => (await fetch("https://api.x.ai/v1/models", { headers: { Authorization: `Bearer ${k}` }, signal: AbortSignal.timeout(10000) })).ok,
  openrouter: async (k) => (await fetch("https://openrouter.ai/api/v1/auth/key", { headers: { Authorization: `Bearer ${k}` }, signal: AbortSignal.timeout(10000) })).ok,
};

serve(async (req) => {
  const ip = await ipHash(req);
  const rl = await rateHit("admin_ip", ip, 20, 600, 120);
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
