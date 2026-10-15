// Integração REAL (produção): provedor xAI desligado/pago + verify-code (QR em Ajustes). Sem chave xAI real.
//   node tests/xai-qr.mjs     (limpe public.rate_limits antes)
import { readFileSync, existsSync } from "node:fs";
import { call, chat, check, register, cleanupTestUsers, summary } from "./lib.mjs";
const ADMIN_FILE = process.env.ADMIN_TOKEN_FILE ?? "/workspace/chat-livre-ia-private/admin_token.txt";
const ADMIN = process.env.ADMIN_TOKEN ?? (existsSync(ADMIN_FILE) ? readFileSync(ADMIN_FILE, "utf8").trim() : "");
const section = (t) => console.log(`\n▶ ${t}`);
const admin = (body) => call("admin-set-key", "x", body, undefined, { "x-admin-token": ADMIN });
const doneMsg = (c) => c.events.find((e) => e.event === "done")?.data.message;
const attempts = (c) => c.events.filter((e) => e.event === "attempt").map((e) => e.data.provider);

const A = await register({ device_name: "xai-qr A" });
const B = await register({ device_name: "xai-qr B" });
check("duas contas de teste criadas (via ADMIN)", A.status === 200 && B.status === 200, `${A.status}/${B.status}`);
const tA = A.json.access_token, tB = B.json.access_token, codeA = A.json.code, codeB = B.json.code;

section("xAI: desligado por padrão, marcado como pago");
const ml = await call("data", "models.list", {}, tA);
const cat = ml.json.catalog ?? [];
const xai = cat.find((c) => c.provider === "xai");
check("xai aparece no catálogo", !!xai);
check("xai: configured=false (sem chave => 'não configurado')", xai?.configured === false, JSON.stringify(xai)?.slice(0, 200));
check("xai: paid=true e keyUrl = console.x.ai", xai?.paid === true && xai?.keyUrl === "https://console.x.ai");
check("xai: modelos de catálogo estático marcados como não verificados", xai?.models?.length > 0 && xai.models.every((m) => m.unverified === true), xai?.models?.map((m) => m.id).join(","));
check("xai: nome dos modelos vem da doc oficial (grok-4.x)", xai?.models?.every((m) => /^grok-4\./.test(m.id)));
check("provedores gratuitos NÃO são pagos", cat.filter((c) => c.provider !== "xai").every((c) => !c.paid));
check("Pollinations segue configurado", cat.find((c) => c.provider === "pollinations")?.configured === true);

section("Preferência 'permitir provedores com possível custo no Automático'");
const p0 = await call("data", "prefs.get", {}, tA);
check("padrão: allow_paid_auto = false", p0.json.preferences?.allow_paid_auto === false, JSON.stringify(p0.json));
const p1 = await call("data", "prefs.update", { allow_paid_auto: true }, tA);
check("pode ser ligada pelo próprio usuário", p1.json.preferences?.allow_paid_auto === true);
const pB = await call("data", "prefs.get", {}, tB);
check("não afeta outro usuário", pB.json.preferences?.allow_paid_auto === false);
const p2 = await call("data", "prefs.update", { allow_paid_auto: "yes" }, tA);
check("valor não-booleano é tratado como desligado", p2.json.preferences?.allow_paid_auto === false);
const exp = await call("data", "export.all", {}, tA);
check("exportação JSON inclui a preferência", exp.json.preferences && "allow_paid_auto" in exp.json.preferences);

section("Sem chave: Grok é pulado ('não configurado'), mesmo escolhido manualmente");
const c1 = await chat(tA, { content: "Responda apenas: ok.", model: "auto" });
check("Automático: não tenta xai", !attempts(c1).includes("xai") && !!doneMsg(c1), attempts(c1).join(","));
await call("data", "prefs.update", { allow_paid_auto: true }, tA);
const c2 = await chat(tA, { content: "Responda apenas: ok.", model: "auto" });
check("Automático com 'permitir pagos' ligado e SEM chave: ainda não tenta xai", !attempts(c2).includes("xai") && !!doneMsg(c2));
const c3 = await chat(tA, { content: "Responda apenas: ok.", model: "xai|grok-4.3" });
const m3 = doneMsg(c3);
check("Escolha manual de Grok sem chave: pulado, responde por outro provedor", !attempts(c3).includes("xai") && !!m3 && m3.provider !== "xai" && m3.fallback_used === true, JSON.stringify(m3)?.slice(0, 200));
await call("data", "prefs.update", { allow_paid_auto: false }, tA);

if (ADMIN) {
  section("admin-set-key: xai");
  const st = await admin({ action: "status" });
  check("status lista xai (não configurado)", st.status === 200 && st.json.configured?.xai === false, JSON.stringify(st.json));
  const short = await admin({ action: "set", provider: "xai", key: "abc" });
  check("chave curta recusada (400)", short.status === 400);
  const bad = await admin({ action: "set", provider: "xai", key: "xai-chave-invalida-de-teste-0000000000" });
  check("chave inválida recusada pela VALIDAÇÃO REAL na API da xAI (422) e não gravada", bad.status === 422, JSON.stringify(bad.json));
  check("provedor inválido recusado", (await admin({ action: "set", provider: "foo", key: "x".repeat(20) })).status === 400);

  section("Com chave INVÁLIDA gravada (validate:false): chamada REAL à API da xAI falha e cai para o próximo");
  const set = await admin({ action: "set", provider: "xai", key: "xai-chave-invalida-de-teste-0000000000", validate: false });
  check("grava chave de teste sem validar", set.status === 200);
  const ml2 = await call("data", "models.list", {}, tA);
  check("agora xai aparece configurado (ainda pago)", ml2.json.catalog.find((c) => c.provider === "xai")?.configured === true);
  const d1 = await chat(tA, { content: "Responda apenas: ok.", model: "auto" });
  check("Automático (permitir pagos DESLIGADO): xai NUNCA é chamado, mesmo com chave", !attempts(d1).includes("xai") && !!doneMsg(d1), attempts(d1).join(","));
  await call("data", "prefs.update", { allow_paid_auto: true }, tA);
  const d2 = await chat(tA, { content: "Responda apenas: ok.", model: "auto" });
  check("Automático (permitir pagos LIGADO): gratuitos primeiro; xai só seria usado depois", !attempts(d2).includes("xai") && !!doneMsg(d2), attempts(d2).join(","));
  await call("data", "prefs.update", { allow_paid_auto: false }, tA);
  const d3 = await chat(tA, { content: "Responda apenas: ok.", model: "xai|grok-4.3" });
  const m = doneMsg(d3);
  const fb = d3.events.find((e) => e.event === "fallback" && e.data.provider === "xai");
  console.log("  (resposta REAL da API xAI à chave inválida: status", fb?.data.status, "kind", fb?.data.kind + ")");
  check("Escolha manual: tentou xai (chamada real), falhou e emitiu fallback", attempts(d3)[0] === "xai" && !!fb, JSON.stringify(d3.events.slice(0, 4)));
  check("falha de chave da xAI classificada como auth (401/400/403)", fb?.data.kind === "auth", JSON.stringify(fb?.data));
  check("resposta final veio de outro provedor com fallback_used=true", !!m && m.provider !== "xai" && m.fallback_used === true, JSON.stringify(m)?.slice(0, 200));
  const d4 = await chat(tA, { content: "Responda apenas: ok.", model: "xai|grok-4.3" });
  check("circuit breaker: provedor em cooldown não é chamado de novo", !attempts(d4).includes("xai") && !!doneMsg(d4), attempts(d4).join(","));
  const ml3 = await call("data", "models.list", {}, tA);
  check("catálogo mostra cooldown nos modelos Grok", ml3.json.catalog.find((c) => c.provider === "xai").models.every((m) => m.cooldownUntil > Date.now()));
  const del = await admin({ action: "delete", provider: "xai" });
  await admin({ action: "clear-cooldown", provider: "xai" });
  check("remove a chave de teste", del.status === 200);
  const st2 = await admin({ action: "status" });
  check("xai volta a 'não configurado'", st2.json.configured?.xai === false);
} else console.log("  (token admin não encontrado: testes de admin pulados)");

section("verify-code (Ajustes → QR de acesso)");
check("sem sessão => 401", (await call("auth", "verify-code", { code: codeA })).status === 401);
const v1 = await call("auth", "verify-code", { code: codeA }, tA);
check("código correto da própria conta => 200", v1.status === 200 && v1.json.ok === true, JSON.stringify(v1.json));
const v1b = await call("auth", "verify-code", { code: codeA.replace(/(\d{4})(\d{4})(\d{4})(\d{4})(\d{3})/, "$1 $2-$3 $4 $5") }, tA);
check("aceita espaços/hífens", v1b.status === 200);
const v2 = await call("auth", "verify-code", { code: codeB }, tA);
check("código de OUTRA conta => 401 genérico", v2.status === 401 && v2.json.error === "invalid_credentials", JSON.stringify(v2.json));
const v3 = await call("auth", "verify-code", { code: "1234567890123456789" }, tA);
check("código inexistente => 401 genérico (mesma mensagem)", v3.status === 401 && v3.json.message === v2.json.message);
const me = await call("auth", "me", {}, tA);
check("falha no verify-code NÃO derruba a sessão", me.status === 200);
const devs = await call("auth", "sessions", {}, tA);
check("verify-code não cria sessão/dispositivo novo", devs.json.sessions?.length === 1, String(devs.json.sessions?.length));

// limpeza
await cleanupTestUsers();
summary();
