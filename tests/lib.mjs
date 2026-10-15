// Utilitários para os testes de integração (Node 20, sem dependências).
export const BASE = process.env.FN_URL ?? "https://kvikbqjmtlthywbgxdii.supabase.co/functions/v1";
export const ANON = process.env.SUPABASE_ANON_KEY ?? "";
export const ORIGIN = "https://drthaleschateaubriand.github.io";

export async function call(fn, action, body = {}, token, extraHeaders = {}) {
  const r = await fetch(fn === "data" ? `${BASE}/data` : `${BASE}/${fn}/${action}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: ORIGIN, ...(token ? { Authorization: `Bearer ${token}` } : {}), ...extraHeaders },
    body: JSON.stringify(fn === "data" ? { action, ...body } : body),
  });
  let json = null;
  const text = await r.text();
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
  return { status: r.status, json, headers: r.headers };
}

import { readFileSync, existsSync } from "node:fs";
const ADMIN_FILE = process.env.ADMIN_TOKEN_FILE ?? "/workspace/chat-livre-ia-private/admin_token.txt";
export const ADMIN = process.env.ADMIN_TOKEN ?? (existsSync(ADMIN_FILE) ? readFileSync(ADMIN_FILE, "utf8").trim() : "");
export const OWNER_FILE = process.env.OWNER_CODE_FILE ?? "/workspace/chat-livre-ia-private/owner_code.txt";
export const admin = (body, token = ADMIN) => call("admin-set-key", "x", body, undefined, { "x-admin-token": token });

/**
 * APP PRIVADO: não existe cadastro público. Usuários de TESTE são criados pelo caminho ADMIN (exige ADMIN_TOKEN), marcados is_test,
 * e apagados no fim (admin-delete-test-users). O dono real nunca é tocado. Retorna no formato antigo do register (code + tokens de uma sessão).
 */
export async function register(extra = {}) {
  if (!ADMIN) throw new Error("ADMIN_TOKEN necessário para criar usuários de teste");
  const c = await admin({ action: "admin-create-test-user" });
  if (c.status !== 200) throw new Error("admin-create-test-user " + c.status + JSON.stringify(c.json));
  const l = await call("auth", "login", { code: c.json.code, ...extra });
  return { status: l.status, headers: l.headers, json: { ...l.json, code: c.json.code, user_id: c.json.user_id } };
}
export const cleanupTestUsers = () => admin({ action: "admin-delete-test-users" });

/** Envia mensagem e consome SSE. Retorna eventos. */
export async function chat(token, body) {
  const r = await fetch(`${BASE}/chat/send`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: ORIGIN, Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  if (!r.ok || !(r.headers.get("content-type") ?? "").includes("event-stream")) {
    return { status: r.status, events: [], json: await r.json().catch(() => null) };
  }
  const events = [];
  const dec = new TextDecoder();
  let buf = "";
  for await (const chunk of r.body) {
    buf += dec.decode(chunk, { stream: true });
    let i;
    while ((i = buf.indexOf("\n\n")) >= 0) {
      const block = buf.slice(0, i); buf = buf.slice(i + 2);
      let ev = "message", data = "";
      for (const l of block.split("\n")) { if (l.startsWith("event:")) ev = l.slice(6).trim(); else if (l.startsWith("data:")) data += l.slice(5).trim(); }
      if (data) events.push({ event: ev, data: JSON.parse(data) });
    }
  }
  return { status: r.status, events };
}

let passed = 0, failed = 0;
export function check(name, cond, detail = "") {
  if (cond) { passed++; console.log(`  ✔ ${name}`); } else { failed++; console.log(`  ✘ ${name} ${detail}`); }
}
export function summary() { console.log(`\n${passed} ok, ${failed} falhas`); if (failed) process.exitCode = 1; }
