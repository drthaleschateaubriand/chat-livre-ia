// Utilitários para os testes de integração (Node 20, sem dependências).
import { createHash } from "node:crypto";
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

export function solvePow(challenge, bits = 14) {
  for (let n = 0; ; n++) {
    const h = createHash("sha256").update(`${challenge}:${n}`).digest();
    let z = 0;
    for (const b of h) { if (b === 0) { z += 8; continue; } z += Math.clz32(b) - 24; break; }
    if (z >= bits) return String(n);
  }
}

export async function register(extra = {}) {
  const ch = await call("auth", "challenge");
  if (ch.status !== 200) throw new Error("challenge " + ch.status + JSON.stringify(ch.json));
  const nonce = solvePow(ch.json.challenge, ch.json.bits);
  return call("auth", "register", { pow_challenge: ch.json.challenge, pow_nonce: nonce, website: "", ...extra });
}

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
