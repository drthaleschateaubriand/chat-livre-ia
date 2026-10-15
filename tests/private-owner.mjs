// Testes REAIS (produção) do modelo PRIVADO: dono único, login do dono, reset do código (cifrado e local), histórico preservado.
//   node tests/private-owner.mjs        (limpe public.rate_limits antes)
// - O reset é testado em usuários de TESTE (is_test) e, no fim, no dono real com um registro temporário (apagado), regenerando owner_code.txt.
// - NÃO imprime nenhum código.
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ADMIN, OWNER_FILE, admin, call, check, cleanupTestUsers, register, summary } from "./lib.mjs";

const section = (t) => console.log(`\n▶ ${t}`);
const ROOT = new URL("..", import.meta.url).pathname;
const PUB = readFileSync(join(ROOT, "docs/reset-owner-pubkey.pem"), "utf8");
const PRIV = process.env.RESET_PRIVATE_KEY ?? "/workspace/chat-livre-ia-private/reset_private.pem";
const decrypt = (b64) => execFileSync("bash", ["-c", `openssl base64 -d -A | openssl pkeyutl -decrypt -inkey "${PRIV}" -pkeyopt rsa_padding_mode:oaep -pkeyopt rsa_oaep_md:sha256 -pkeyopt rsa_mgf1_md:sha256`], { input: b64 }).toString().trim();
const login = (code, extra = {}) => call("auth", "login", { code, ...extra });
const mode = (f) => (statSync(f).mode & 0o777).toString(8);

section("Pré-requisitos");
check("token admin disponível", !!ADMIN);
check("chave privada do dono (reset) existe fora do repositório, modo 600", existsSync(PRIV) && mode(PRIV) === "600" && !PRIV.startsWith(ROOT));
check("owner_code.txt existe, modo 600, fora do repositório", existsSync(OWNER_FILE) && mode(OWNER_FILE) === "600" && !OWNER_FILE.startsWith(ROOT), OWNER_FILE);

section("Dono real: login por código (leitura do arquivo; nenhum código impresso)");
let ownerCode = readFileSync(OWNER_FILE, "utf8").trim();
check("owner_code.txt tem 19 dígitos", /^\d{19}$/.test(ownerCode));
const ol = await login(ownerCode, { device_name: "teste-dono" });
check("o código do arquivo FAZ LOGIN REAL em produção", ol.status === 200 && ol.json.access_token?.length === 43, String(ol.status));
let ownerTok = ol.json.access_token;
const me = await call("auth", "me", {}, ownerTok);
const ownerId = me.json.user?.id;
check("sessão do dono válida (me)", me.status === 200 && !!ownerId);
const del = await call("data", "account.delete", { code: "1234567890123456789" }, ownerTok);
check("conta do dono NÃO pode ser excluída pela interface/API (403 owner_protected; testado com código errado, por segurança)", del.status === 403 && del.json.error === "owner_protected", `${del.status} ${JSON.stringify(del.json)}`);
check("o dono continua existindo", (await call("auth", "me", {}, ownerTok)).status === 200);
const vc = await call("auth", "verify-code", { code: ownerCode }, ownerTok);
check("dono: verify-code (QR em Ajustes) funciona", vc.status === 200);
const os = await admin({ action: "owner-status" });
check("owner-status: existe 1 dono", os.json.owner_exists === true);
check("segundo dono impossível (admin-create-owner => 409)", (await admin({ action: "admin-create-owner" })).status === 409);
check("reset com user_id do DONO é recusado (só contas de teste aceitam user_id)", (await admin({ action: "admin-reset-owner", user_id: ownerId })).status === 404);
check("reset de user_id inexistente => 404", (await admin({ action: "admin-reset-owner", user_id: "00000000-0000-4000-8000-000000000000" })).status === 404);
check("reset sem token => 401", (await admin({ action: "admin-reset-owner" }, "")).status === 401);
await call("auth", "logout", {}, ownerTok);

section("Reset do código em usuário de TESTE (entrega CIFRADA, como no workflow do GitHub)");
const T = await register({ device_name: "T aparelho 1" });
const codeOld = T.json.code, tokOld = T.json.access_token, refOld = T.json.refresh_token;
const l2 = await login(codeOld, { device_name: "T aparelho 2" });
const conv = await call("data", "conv.create", { title: "Histórico que deve sobreviver" }, tokOld);
const convId = conv.json.conversation?.id ?? conv.json.id;
const mem = await call("data", "mem.create", { content: "memória que deve sobreviver" }, tokOld);
check("preparo: conversa e memória criadas; 2 dispositivos logados", !!convId && [200, 201].includes(mem.status) && l2.status === 200, JSON.stringify(conv.json).slice(0, 150));
const rs = await admin({ action: "admin-reset-owner", user_id: T.json.user_id, encrypt_to: PUB });
check("reset cifrado: resposta SEM código em claro, só encrypted_code", rs.status === 200 && !("code" in rs.json) && typeof rs.json.encrypted_code === "string" && rs.json.alg === "RSA-OAEP-SHA256", JSON.stringify(Object.keys(rs.json)));
check("o texto cifrado não contém o código novo nem o antigo", !JSON.stringify(rs.json).includes(codeOld));
const codeNew = decrypt(rs.json.encrypted_code);
check("a chave privada do dono decifra um código de 19 dígitos novo e diferente", /^\d{19}$/.test(codeNew) && codeNew !== codeOld);
check("código ANTIGO não funciona mais (401)", (await login(codeOld)).status === 401);
check("token de acesso antigo revogado (401)", (await call("auth", "me", {}, tokOld)).status === 401);
check("token do 2º dispositivo revogado (401)", (await call("auth", "me", {}, l2.json.access_token)).status === 401);
check("refresh antigo revogado (401)", (await call("auth", "refresh", { refresh_token: refOld })).status === 401);
const nl = await login(codeNew, { device_name: "T novo" });
check("código NOVO faz login", nl.status === 200);
const me2 = await call("auth", "me", {}, nl.json.access_token);
check("é o MESMO usuário (mesmo id)", me2.json.user?.id === T.json.user_id);
const list = await call("data", "conv.list", {}, nl.json.access_token);
const convs = list.json.conversations ?? [];
check("histórico PRESERVADO: conversa continua lá, mesmo id", convs.some((c) => c.id === convId && c.title === "Histórico que deve sobreviver"), JSON.stringify(convs).slice(0, 200));
const mems = await call("data", "mem.list", {}, nl.json.access_token);
check("memória PRESERVADA", (mems.json.memories ?? []).some((m) => m.content === "memória que deve sobreviver"));
const devs = await call("auth", "sessions", {}, nl.json.access_token);
check("só existe a sessão nova (todas as antigas revogadas)", devs.json.sessions?.length === 1);

section("Reset pelos SCRIPTS (exatamente os do workflow e do box)");
const dir = mkdtempSync(join(tmpdir(), "reset-"));
const enc = join(dir, "reset-owner.enc");
const env = { ...process.env, ADMIN_TOKEN: ADMIN, TARGET_USER_ID: T.json.user_id, OUT: enc, OWNER_CODE_FILE: join(dir, "owner_code.txt"), RESET_PRIVATE_KEY: PRIV };
const r1 = spawnSync("bash", [join(ROOT, "scripts/reset-owner-encrypted.sh")], { env, cwd: ROOT, encoding: "utf8" });
check("scripts/reset-owner-encrypted.sh (usado no workflow) conclui sem imprimir segredos", r1.status === 0 && /CIFRADO/.test(r1.stdout), r1.stderr + r1.stdout);
check("... sua saída não contém dígitos de código", !/\d{18,}/.test(r1.stdout + r1.stderr));
const r2 = spawnSync("bash", [join(ROOT, "scripts/receive-reset.sh"), enc], { env, cwd: ROOT, encoding: "utf8" });
check("scripts/receive-reset.sh decifra com a chave privada e grava o arquivo (modo 600)", r2.status === 0 && mode(env.OWNER_CODE_FILE) === "600", r2.stderr + r2.stdout);
check("... sem imprimir o código", !/\d{18,}/.test(r2.stdout + r2.stderr));
const code3 = readFileSync(env.OWNER_CODE_FILE, "utf8").trim();
check("o código recebido via script cifrado faz login (e o anterior não)", (await login(code3)).status === 200 && (await login(codeNew)).status === 401);
const wf = readFileSync(join(ROOT, "docs/reset-owner-workflow.yml"), "utf8");
check("workflow só usa o script cifrado (não imprime código; sem 'echo' do segredo/código)", /reset-owner-encrypted\.sh/.test(wf) && !/cat .*owner|echo .*code|set -x/i.test(wf) && /workflow_dispatch/.test(wf) && /secrets\.ADMIN_TOKEN/.test(wf));

section("Reset LOCAL em texto puro (scripts/reset-owner.sh) no DONO REAL, com histórico preservado");
// registro temporário na conta real (será apagado)
const before = readFileSync(OWNER_FILE, "utf8").trim();
const ol2 = await login(before, { device_name: "teste-reset" });
const oldTok = ol2.json.access_token, oldRef = ol2.json.refresh_token;
const oc = await call("data", "conv.create", { title: "TESTE-RESET-TEMPORARIA" }, oldTok);
const ocId = oc.json.conversation?.id ?? oc.json.id;
const convBefore = (await call("data", "conv.list", {}, oldTok)).json.conversations.length;
const noYes = spawnSync("bash", [join(ROOT, "scripts/reset-owner.sh")], { encoding: "utf8" });
check("reset-owner.sh sem --yes não faz nada (exit 2)", noYes.status === 2 && (await login(before)).status === 200);
const rr = spawnSync("bash", [join(ROOT, "scripts/reset-owner.sh"), "--yes"], { encoding: "utf8" });
check("reset-owner.sh --yes conclui e não imprime o código", rr.status === 0 && !/\d{18,}/.test(rr.stdout + rr.stderr), rr.stderr + rr.stdout);
const after = readFileSync(OWNER_FILE, "utf8").trim();
check("owner_code.txt atualizado (novo, 19 dígitos, modo 600)", /^\d{19}$/.test(after) && after !== before && mode(OWNER_FILE) === "600");
check("código ANTIGO do dono não funciona mais", (await login(before)).status === 401);
check("sessão antiga do dono revogada (access e refresh)", (await call("auth", "me", {}, oldTok)).status === 401 && (await call("auth", "refresh", { refresh_token: oldRef })).status === 401);
const nl2 = await login(after, { device_name: "teste-dono-novo" });
check("código NOVO do dono faz login real", nl2.status === 200);
const me3 = await call("auth", "me", {}, nl2.json.access_token);
check("mesmo usuário do dono (id igual)", me3.json.user?.id === ownerId);
const lst = (await call("data", "conv.list", {}, nl2.json.access_token)).json.conversations;
check("histórico do dono preservado após o reset (conversa temporária ainda existe; mesma contagem)", lst.some((c) => c.id === ocId) && lst.length === convBefore);
await call("data", "conv.delete", { id: ocId }, nl2.json.access_token);
check("conversa temporária apagada (dono volta ao estado anterior)", !(await call("data", "conv.list", {}, nl2.json.access_token)).json.conversations.some((c) => c.id === ocId));
await call("auth", "logout", {}, nl2.json.access_token);
check("dono continua sendo o único (owner-status)", (await admin({ action: "owner-status" })).json.owner_exists === true);

await cleanupTestUsers();
const cleanup = await admin({ action: "owner-status" });
check("limpeza de contas de teste não removeu o dono", cleanup.json.owner_exists === true);
summary();
