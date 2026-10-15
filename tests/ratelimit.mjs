// Testes de rate limit (bloqueio progressivo de login e limite de criação de contas) contra as Edge Functions REAIS.
// Rode DEPOIS de limpar a tabela:  delete from public.rate_limits;   (o teste bloqueia o IP de quem roda por alguns minutos)
import { call, check, register, summary } from "./lib.mjs";
const section = (t) => console.log(`\n▶ ${t}`);
// ---------- 13. Rate limiting (por último: bloqueia o IP do teste) ----------
section("Rate limit de login (bloqueio progressivo)");
const C = await register();
const codeC = C.json.code;
const statuses = [];
for (let i = 0; i < 8; i++) statuses.push((await call("auth", "login", { code: "9" + String(Math.floor(Math.random() * 1e18)).padStart(18, "3") })).status);
console.log("  sequência de status:", statuses.join(" "));
check("primeiras tentativas erradas => 401", statuses.slice(0, 5).every((s) => s === 401));
check("depois de N=5 falhas => 429 (bloqueio)", statuses.slice(5).every((s) => s === 429));
const blocked = await call("auth", "login", { code: codeC });
check("mesmo com o código CORRETO, o IP bloqueado recebe 429 + Retry-After", blocked.status === 429 && Number(blocked.headers.get("retry-after")) > 0, String(blocked.status));
const regs = [];
for (let i = 0; i < 6; i++) { const r = await register(); regs.push(r.status); }
console.log("  criação de contas em sequência:", regs.join(" "));
check("limite de criação de contas por IP/hora => 429", regs.includes(429));

summary();
