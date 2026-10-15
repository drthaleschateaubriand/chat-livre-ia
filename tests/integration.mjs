// Testes de INTEGRAÇÃO contra as Edge Functions REAIS (produção). Node 20, sem dependências.
//   node tests/integration.mjs            (FN_URL, SUPABASE_URL e SUPABASE_ANON_KEY podem ser sobrescritos)
// Pré-requisito: limpar rate_limits antes (o limite de criação de contas é 5/hora/IP):  delete from public.rate_limits;
import { readFileSync, existsSync } from "node:fs";
import { BASE, ORIGIN, call, chat, check, register, cleanupTestUsers, summary } from "./lib.mjs";

const SUPA = process.env.SUPABASE_URL ?? BASE.replace("/functions/v1", "");
const ANON = process.env.SUPABASE_ANON_KEY ?? "sb_publishable_NhfOo15BXXABSMY5yfpARw_fKd-12wt";
const ADMIN_FILE = process.env.ADMIN_TOKEN_FILE ?? "/workspace/chat-livre-ia-private/admin_token.txt";
const ADMIN = process.env.ADMIN_TOKEN ?? (existsSync(ADMIN_FILE) ? readFileSync(ADMIN_FILE, "utf8").trim() : "");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const section = (t) => console.log(`\n▶ ${t}`);
const admin = (body, token = ADMIN) => call("admin-set-key", "x", body, undefined, { "x-admin-token": token });
const doneText = (c) => c.events.find((e) => e.event === "done")?.data.message;

// ---------- 1. Criação de conta ----------
section("App PRIVADO: cadastro público FECHADO; usuários de teste só via ADMIN");
check("token admin disponível (necessário para criar usuários de teste)", !!ADMIN);
const A = await register({ device_name: "Teste A (aparelho 1)" });
check("usuário de teste criado pelo caminho ADMIN e logado", A.status === 200, JSON.stringify(A.json));
check("código tem 19 dígitos numéricos", /^\d{19}$/.test(A.json.code ?? ""));
check("tokens opacos de 32 bytes (43 chars base64url)", A.json.access_token?.length === 43 && A.json.refresh_token?.length === 43);
const codeA = A.json.code;
const closed = [];
for (const [act, body] of [["register", { website: "" }], ["register", { pow_challenge: "x.y.z", pow_nonce: "1", website: "" }], ["challenge", {}], ["pow-challenge", {}], ["register", { persistent: true, device_name: "x" }], ["register", {}], ["challenge", {}]]) {
  const r = await call("auth", act, body);
  closed.push(r.status);
  if (r.status !== 403 || r.json.error !== "registration_closed") console.log("  inesperado:", act, r.status, JSON.stringify(r.json));
}
check("auth/register, auth/challenge e auth/pow-challenge recusam SEMPRE (403 registration_closed), sem virar 429", closed.every((x) => x === 403), closed.join(","));
check("admin-create-test-user sem token => 401 (não é cadastro público)", (await admin({ action: "admin-create-test-user" }, "")).status === 401);
const os = await admin({ action: "owner-status" });
check("dono real já existe (owner-status)", os.status === 200 && os.json.owner_exists === true, JSON.stringify(os.json));
const second = await admin({ action: "admin-create-owner" });
check("SEGUNDO dono é impossível (admin-create-owner => 409 owner_exists)", second.status === 409 && second.json.error === "owner_exists", JSON.stringify(second.json));
check("admin-create-owner sem token => 401", (await admin({ action: "admin-create-owner" }, "")).status === 401);
const r1 = await register();
const codeB0 = r1.json.code;

// ---------- 2. Login ----------
section("Login numérico");
const fmt = codeA.replace(/(\d{4})(?=\d)/g, "$1 ");
const dashed = codeA.replace(/(\d{4})(?=\d)/g, "$1-");
const l1 = await call("auth", "login", { code: fmt, device_name: "Teste A (aparelho 2)" });
check("login com espaços funciona", l1.status === 200);
const l2 = await call("auth", "login", { code: dashed, persistent: false });
check("login com hífens funciona (sessão curta)", l2.status === 200 && l2.json.persistent === false);
check("sessão persistente = refresh de 30 dias", l1.json.refresh_expires_in === 30 * 24 * 3600);
check("sessão curta = refresh de 12h", l2.json.refresh_expires_in === 12 * 3600);
const wrong = "4827193650728413659" === codeA ? "4827193650728413658" : "4827193650728413659";
const w1 = await call("auth", "login", { code: wrong });
check("código errado => 401 genérico", w1.status === 401 && w1.json.error === "invalid_credentials", JSON.stringify(w1));
const w2 = await call("auth", "login", { code: "1111 1111 1111 1111 111" });
check("sequência repetida => rejeitada (401 genérico)", w2.status === 401);
const w3 = await call("auth", "login", { code: "123" });
check("código curto => rejeitado (401 genérico, mesma mensagem)", w3.status === 401 && w3.json.message === w1.json.message);

// ---------- 3. Sessões ----------
section("Sessões: me, refresh com rotação, revogação, dispositivos");
const tA = A.json.access_token;
const me = await call("auth", "me", {}, tA);
check("me com access token válido", me.status === 200 && !!me.json.user?.id);
check("sem token => 401", (await call("auth", "me", {})).status === 401);
check("token inventado => 401", (await call("auth", "me", {}, "x".repeat(43))).status === 401);
const rf = await call("auth", "refresh", { refresh_token: A.json.refresh_token });
check("refresh gera novos tokens", rf.status === 200 && rf.json.access_token !== tA && rf.json.refresh_token !== A.json.refresh_token);
check("access token antigo deixa de valer após rotação", (await call("auth", "me", {}, tA)).status === 401);
const reuse = await call("auth", "refresh", { refresh_token: A.json.refresh_token });
check("reuso imediato do refresh antigo => 409 (corrida entre abas), sem revogar", reuse.status === 409, String(reuse.status));
const stillOk = await call("auth", "me", {}, rf.json.access_token);
check("sessão continua válida após a corrida", stillOk.status === 200);
const devs = await call("auth", "sessions", {}, rf.json.access_token);
check("lista de dispositivos tem 3 sessões do mesmo código (A1, A2 e sessão curta)", devs.json.sessions?.length === 3, JSON.stringify(devs.json).slice(0, 300));
check("dispositivo atual marcado", devs.json.sessions?.filter((s) => s.current).length === 1);
check("nomes de dispositivo gravados", devs.json.sessions?.some((s) => s.device_name === "Teste A (aparelho 2)"));
let tA1 = rf.json.access_token;
const dev2 = l1.json;
const rev = await call("auth", "revoke-session", { id: dev2.session_id }, tA1);
check("revogar dispositivo individual", rev.status === 200);
check("token do dispositivo revogado => 401", (await call("auth", "me", {}, dev2.access_token)).status === 401);
check("refresh do dispositivo revogado => 401", (await call("auth", "refresh", { refresh_token: dev2.refresh_token })).status === 401);
const revNotMine = await call("auth", "revoke-session", { id: "00000000-0000-4000-8000-000000000000" }, tA1);
check("revogar sessão inexistente/alheia => 404", revNotMine.status === 404);

// ---------- 4. Usuário B e isolamento ----------
section("Isolamento entre usuários (B não acessa dados de A)");
const B = { json: r1.json };
const tB = B.json.access_token;
const secret = "SEGREDO-DE-A-" + Math.random().toString(36).slice(2, 8);
const c1 = await chat(tA1, { content: `Guarde este texto na conversa: ${secret}. Responda apenas "ok".`, model: "auto" });
const msgA = doneText(c1);
check("A: IA REAL respondeu (SSE com done)", !!msgA && msgA.content.length > 0, JSON.stringify(c1.events.slice(-2)));
check("A: resposta traz provedor/modelo gravados", !!msgA?.provider && !!msgA?.model, JSON.stringify(msgA));
const convA = c1.events.find((e) => e.event === "meta").data.conversation_id;
const bList = await call("data", "conv.list", {}, tB);
check("B não vê conversas de A na lista", bList.json.conversations?.length === 0);
for (const [act, body] of [["conv.messages", { id: convA }], ["conv.rename", { id: convA, title: "hack" }], ["conv.pin", { id: convA, pinned: true }], ["conv.delete", { id: convA }]]) {
  const r = await call("data", act, body, tB);
  check(`B ${act} na conversa de A => 404`, r.status === 404, String(r.status));
}
const bChat = await chat(tB, { conversation_id: convA, content: "oi", model: "auto" });
check("B enviar mensagem na conversa de A => 404", bChat.status === 404, String(bChat.status));
const spoof = await call("data", "conv.list", { user_id: me.json.user.id }, tB);
check("user_id no corpo é ignorado (B continua vendo só o seu)", spoof.json.conversations?.length === 0);
const bSearch = await call("data", "conv.search", { q: secret }, tB);
check("pesquisa de B não encontra texto de A", bSearch.json.results?.length === 0);
const aSearch = await call("data", "conv.search", { q: secret }, tA1);
check("pesquisa de A encontra o próprio texto", aSearch.json.results?.length === 1);
const memA = await call("data", "mem.create", { content: "memória privada de A" }, tA1);
check("A cria memória", memA.status === 201);
check("B não edita memória de A (404)", (await call("data", "mem.update", { id: memA.json.memory.id, content: "x" }, tB)).status === 404);
check("B não exclui memória de A (404)", (await call("data", "mem.delete", { id: memA.json.memory.id }, tB)).status === 404);
check("B não lista memórias de A", (await call("data", "mem.list", {}, tB)).json.memories.length === 0);

// ---------- 5. Acesso direto às tabelas ----------
section("Acesso direto às tabelas com a chave anon/publishable (deve falhar)");
for (const t of ["users", "sessions", "conversations", "messages", "memories", "preferences", "server_secrets", "provider_usage", "provider_state", "rate_limits", "auth_attempts"]) {
  const r = await fetch(`${SUPA}/rest/v1/${t}?select=*`, { headers: { apikey: ANON, Authorization: `Bearer ${ANON}` } });
  const txt = await r.text();
  let rows = null; try { rows = JSON.parse(txt); } catch { /* */ }
  check(`REST GET ${t}: sem dados (HTTP ${r.status})`, !(r.status === 200 && Array.isArray(rows) && rows.length > 0) && !txt.includes(codeA));
}
const ins = await fetch(`${SUPA}/rest/v1/conversations`, { method: "POST", headers: { apikey: ANON, Authorization: `Bearer ${ANON}`, "Content-Type": "application/json" }, body: JSON.stringify({ user_id: me.json.user.id, title: "invasão" }) });
check(`REST INSERT em conversations negado (HTTP ${ins.status})`, ins.status >= 400);
const rpc = await fetch(`${SUPA}/rest/v1/rpc/rl_hit`, { method: "POST", headers: { apikey: ANON, Authorization: `Bearer ${ANON}`, "Content-Type": "application/json" }, body: JSON.stringify({ p_scope: "x", p_key: "y", p_max: 1, p_window: 1, p_block: 1 }) });
check(`RPC rl_hit negado para anon (HTTP ${rpc.status})`, rpc.status >= 400);

// ---------- 6. CORS ----------
section("CORS restrito");
const pre = await fetch(`${BASE}/auth/login`, { method: "OPTIONS", headers: { Origin: ORIGIN, "Access-Control-Request-Method": "POST" } });
check("preflight da origem do Pages permitido", pre.headers.get("access-control-allow-origin") === ORIGIN, pre.headers.get("access-control-allow-origin") ?? "(nenhum)");
const preBad = await fetch(`${BASE}/auth/login`, { method: "OPTIONS", headers: { Origin: "https://evil.example", "Access-Control-Request-Method": "POST" } });
check("preflight de origem estranha negado (403, sem ACAO)", preBad.status === 403 && !preBad.headers.get("access-control-allow-origin"));
const badPost = await fetch(`${BASE}/auth/me`, { method: "POST", headers: { Origin: "https://evil.example", Authorization: `Bearer ${tA1}` }, body: "{}" });
check("POST de origem estranha negado", badPost.status === 403 && !badPost.headers.get("access-control-allow-origin") );
const loc = await fetch(`${BASE}/auth/challenge`, { method: "OPTIONS", headers: { Origin: "http://localhost:5173", "Access-Control-Request-Method": "POST" } });
check("localhost:5173 permitido", loc.headers.get("access-control-allow-origin") === "http://localhost:5173");
check("nunca '*'", ![pre, preBad, loc].some((r) => r.headers.get("access-control-allow-origin") === "*"));

// ---------- 7. Histórico, memória, segundo dispositivo ----------
section("Histórico gravado, 'recarregar', segundo dispositivo, memórias na IA");
const msgs = await call("data", "conv.messages", { id: convA }, tA1);
check("histórico recuperado (usuário + IA) depois de 'recarregar'", msgs.json.messages?.length === 2 && msgs.json.messages[0].content.includes(secret) && msgs.json.messages[1].role === "assistant");
const dev3 = await call("auth", "login", { code: codeA, device_name: "Teste A (aparelho 3)" });
const msgs3 = await call("data", "conv.messages", { id: convA }, dev3.json.access_token);
check("segundo dispositivo (mesmo código) vê o mesmo histórico", msgs3.json.messages?.length === 2 && msgs3.json.messages[0].id === msgs.json.messages[0].id);
const list3 = await call("data", "conv.list", {}, dev3.json.access_token);
check("segundo dispositivo vê a mesma lista de conversas", list3.json.conversations?.length === 1 && list3.json.conversations[0].id === convA);
// regenerar e continuar
const reg = await chat(tA1, { conversation_id: convA, mode: "regenerate" });
const regMsg = doneText(reg);
const after = await call("data", "conv.messages", { id: convA }, tA1);
check("regenerar substitui a última resposta (continua 2 mensagens)", !!regMsg && after.json.messages.length === 2 && after.json.messages[1].id === regMsg.id);
const cont = await chat(tA1, { conversation_id: convA, mode: "continue" });
const contMsg = doneText(cont);
check("continuar estende a mesma mensagem", !!contMsg && contMsg.id === regMsg.id && contMsg.content.length > regMsg.content.length);
// memórias
await call("data", "mem.create", { content: "O nome do usuário é Zeferino Quintanilha." }, tA1);
const mq = await chat(tA1, { content: "Qual é o meu nome completo? Responda só com o nome.", model: "auto" });
const mAns = doneText(mq)?.content ?? "";
check("IA usa a memória explícita quando ativada", /Zeferino/i.test(mAns), mAns.slice(0, 150));
await call("data", "prefs.update", { memory_enabled: false }, tA1);
const mq2 = await chat(tA1, { content: "Qual é o meu nome completo? Se você não sabe, diga exatamente: NAO SEI.", model: "auto" });
const mAns2 = doneText(mq2)?.content ?? "";
check("com memória DESATIVADA a IA não recebe o nome", !/Zeferino/i.test(mAns2), mAns2.slice(0, 150));
await call("data", "prefs.update", { memory_enabled: true }, tA1);
const ml = await call("data", "mem.list", {}, tA1);
const m1 = ml.json.memories.find((m) => m.content.includes("Zeferino"));
const upd = await call("data", "mem.update", { id: m1.id, content: "O nome do usuário é Zé." }, tA1);
check("memória editável", upd.status === 200 && upd.json.memory.content.includes("Zé"));
check("memória excluível", (await call("data", "mem.delete", { id: m1.id }, tA1)).status === 200);

// renomear / fixar / excluir (A)
const ren = await call("data", "conv.rename", { id: convA, title: "Renomeada ✔" }, tA1);
const pin = await call("data", "conv.pin", { id: convA, pinned: true }, tA1);
check("renomear e fixar", ren.json.conversation?.title === "Renomeada ✔" && pin.json.conversation?.pinned === true);

// ---------- 8. Exportação ----------
section("Exportar dados / excluir conta");
const exp = await call("data", "export.all", {}, tA1);
check("export JSON completo", exp.status === 200 && exp.json.conversations.length >= 1 && exp.json.messages.length >= 2 && Array.isArray(exp.json.memories) && !JSON.stringify(exp.json).includes("code_"));

// ---------- 9. Provedores: fallback real, pausa/cotas esgotadas, admin ----------
section("Admin: proteção do endpoint e gravação de chaves");
check("admin sem token => 401", (await admin({ action: "status" }, "")).status === 401);
check("admin com token errado => 401", (await admin({ action: "status" }, "a".repeat(64))).status === 401);
if (ADMIN) {
  const st = await admin({ action: "status" });
  check("admin status com token correto", st.status === 200 && "groq" in (st.json.configured ?? {}), JSON.stringify(st.json));
  // Gemini (chave real, plano grátis) fica pausado daqui em diante: preserva a cota grátis e mantém os cenários de fallback/cota determinísticos.
  await admin({ action: "pause", provider: "gemini", seconds: 1800 });
  const bad = await admin({ action: "set", provider: "openrouter", key: "chave-invalida-de-teste-123" });
  check("chave inválida é recusada pela validação (422) e não é gravada", bad.status === 422, JSON.stringify(bad.json));
  section("Fallback REAL: OpenRouter com chave inválida (401) => cai para Pollinations");
  const setk = await admin({ action: "set", provider: "openrouter", key: "chave-invalida-de-teste-123", validate: false });
  check("grava chave de teste sem validar", setk.status === 200);
  const fb = await chat(tA1, { content: "Diga apenas: teste de fallback.", model: "auto" });
  const evs = fb.events.map((e) => e.event);
  const fbMsg = doneText(fb);
  check("tentou OpenRouter primeiro (attempt)", fb.events.some((e) => e.event === "attempt" && e.data.provider === "openrouter"), evs.slice(0, 6).join(","));
  check("evento fallback (auth/401) emitido", fb.events.some((e) => e.event === "fallback" && e.data.provider === "openrouter" && e.data.status === 401));
  check("resposta final veio da Pollinations com fallback_used=true", fbMsg?.provider === "pollinations" && fbMsg?.fallback_used === true, JSON.stringify(fbMsg));
  const fb2 = await chat(tA1, { content: "Diga apenas: segundo teste.", model: "auto" });
  check("provedor em cooldown NÃO é chamado de novo (circuit breaker)", !fb2.events.some((e) => e.event === "attempt" && e.data.provider === "openrouter") && !!doneText(fb2));
  const del = await admin({ action: "delete", provider: "openrouter" });
  await admin({ action: "clear-cooldown", provider: "openrouter" });
  check("remove a chave de teste", del.status === 200);

  section("Cotas esgotadas: todos os provedores pausados");
  const p = await admin({ action: "pause", provider: "pollinations", seconds: 120 });
  check("pausa de Pollinations (admin)", p.status === 200);
  const ex = await chat(tA1, { conversation_id: convA, content: "Esta mensagem não deve receber resposta.", model: "auto" });
  const err = ex.events.find((e) => e.event === "error");
  check("erro claro all_exhausted com retry_after", err?.data.code === "all_exhausted" && err.data.retry_after > 60 && err.data.retry_after <= 120 && /Tente novamente/.test(err.data.message), JSON.stringify(err?.data).slice(0, 300));
  const exMsgs = await call("data", "conv.messages", { id: convA }, tA1);
  check("a mensagem do usuário foi gravada mesmo sem resposta", exMsgs.json.messages.some((m) => m.content.includes("não deve receber resposta")));
  await admin({ action: "clear-cooldown", provider: "pollinations" });
  const back = await chat(tA1, { conversation_id: convA, mode: "regenerate", model: "auto" });
  check("após liberar a pausa, 'tentar novamente' funciona", !!doneText(back));
} else {
  console.log("  (token admin não encontrado: testes de admin/fallback pulados)");
}

// ---------- 10. Conversa longa => resumo ----------
section("Conversa longa (resumo automático do contexto antigo)");
const long = "palavra ".repeat(520); // ~4 KB
let convL = null;
for (let i = 0; i < 4; i++) {
  const r = await chat(tA1, { conversation_id: convL ?? undefined, content: `Mensagem ${i + 1}. ${long}\nResponda apenas: ok.`, model: "auto" });
  convL = convL ?? r.events.find((e) => e.event === "meta")?.data.conversation_id;
  if (!doneText(r)) { check(`mensagem longa ${i + 1} respondida`, false, JSON.stringify(r.events.slice(-1))); break; }
}
let cL = null;
for (let k = 0; k < 14 && !cL?.summary; k++) {
  await sleep(5000); // o resumo roda em segundo plano (EdgeRuntime.waitUntil) e leva alguns segundos
  const expL = await call("data", "export.all", {}, tA1);
  cL = expL.json.conversations.find((c) => c.id === convL);
}
check("resumo automático gerado e gravado na conversa longa", !!cL?.summary && cL.summary.length > 20, JSON.stringify(cL?.summary ?? null).slice(0, 200));
const ctxAns = await chat(tA1, { conversation_id: convL, content: "Qual foi o número da PRIMEIRA mensagem que eu enviei nesta conversa? Responda só o número.", model: "auto" });
console.log("  resposta usando contexto resumido:", (doneText(ctxAns)?.content ?? "").slice(0, 120).replace(/\n/g, " "));

// ---------- 11. Excluir conversa ----------
const delc = await call("data", "conv.delete", { id: convA }, tA1);
const afterDel = await call("data", "conv.messages", { id: convA }, tA1);
check("excluir conversa e depois ela some (404)", delc.status === 200 && afterDel.status === 404);

// ---------- 12. Logout / logout-all ----------
section("Logout, 'sair de todos' e exclusão de conta");
const lo = await call("auth", "logout", {}, dev3.json.access_token);
check("logout revoga este dispositivo", lo.status === 200 && (await call("auth", "me", {}, dev3.json.access_token)).status === 401);
const la = await call("auth", "login", { code: codeA });
const lb = await call("auth", "login", { code: codeA });
const all = await call("auth", "logout-all", {}, la.json.access_token);
check("logout-all revoga todos", all.status === 200 && (await call("auth", "me", {}, lb.json.access_token)).status === 401 && (await call("auth", "me", {}, tA1)).status === 401);

// refresh com sessão após 20s: reuso de refresh antigo revoga a sessão
section("Detecção de roubo de refresh (reuso após a janela de 20 s)");
const s1 = await call("auth", "login", { code: codeA });
const s2 = await call("auth", "refresh", { refresh_token: s1.json.refresh_token });
await sleep(21000);
const s3 = await call("auth", "refresh", { refresh_token: s1.json.refresh_token });
check("reuso do refresh antigo após 20 s => 401", s3.status === 401, String(s3.status));
check("... e a sessão inteira foi revogada (refresh novo também falha)", (await call("auth", "refresh", { refresh_token: s2.json.refresh_token })).status === 401);

// exclusão de conta
const s4 = await call("auth", "login", { code: codeA });
const wrongDel = await call("data", "account.delete", { code: wrong }, s4.json.access_token);
check("excluir conta com código errado => 401", wrongDel.status === 401);
const okDel = await call("data", "account.delete", { code: codeA }, s4.json.access_token);
check("excluir conta com o código correto", okDel.status === 200);
// conta apagada: login falha (cuidado: conta como falha para o rate limit)
const gone = await call("auth", "login", { code: codeA });
check("login com a conta excluída falha", gone.status === 401);
// B: apaga também
const bLogin = await call("auth", "login", { code: codeB0 });
await call("data", "account.delete", { code: codeB0 }, bLogin.json.access_token);

await admin({ action: "clear-cooldown", provider: "gemini" }); // devolve o Gemini ao Automático
const cl = await cleanupTestUsers();
check("usuários de teste restantes foram apagados (dono preservado)", cl.status === 200);
summary();
