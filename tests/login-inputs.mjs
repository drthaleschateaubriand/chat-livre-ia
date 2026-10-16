// Matriz de ENTRADA do código na tela de login do site PUBLICADO: como um usuário de celular realmente digita/cola/autopreenche.
// Perfis Chromium emulando Pixel 7 (Android), iPhone 13 (viewport/UA/touch; NÃO é o WebKit real) e desktop.
// Usa um usuário de TESTE criado pelo admin (apagado no fim). Com OWNER=1 também confere o código do DONO (owner_code.txt, nunca impresso),
// somente leitura: faz login e logout, não troca nada.
//   node tests/login-inputs.mjs [URL]        (OWNER=1 para incluir o dono)
import { chromium, devices } from "playwright";
import { readFileSync } from "node:fs";
import { OWNER_FILE, call, check, cleanupTestUsers, register, summary } from "./lib.mjs";

const URL = process.argv[2] ?? process.env.APP_URL ?? "https://drthaleschateaubriand.github.io/chat-livre-ia/";
const section = (t) => console.log(`\n▶ ${t}`);
const browser = await chromium.launch();
const PROFILES = {
  iphone: { ...devices["iPhone 13"], viewport: { width: 390, height: 844 }, locale: "pt-BR" },
  pixel: { ...devices["Pixel 7"], locale: "pt-BR" },
  desktop: { viewport: { width: 1280, height: 800 }, locale: "pt-BR" },
};
const group4 = (c, sep = " ") => c.replace(/(\d{4})(?=\d)/g, `$1${sep}`);
const SEL = '[data-testid="code-input"]';

/** cada caso recebe (page, code) e deixa o texto no campo; o runner clica em Entrar (ou Enter) e espera o chat. */
const CASES = {
  "autofill/colagem programática sem espaços (fill)": async (p, c) => { await p.fill(SEL, c); },
  "digitando tecla a tecla sem espaços (teclado numérico)": async (p, c) => { await p.locator(SEL).pressSequentially(c, { delay: 15 }); },
  "digitando com espaços de 4 em 4": async (p, c) => { await p.locator(SEL).pressSequentially(group4(c), { delay: 15 }); },
  "digitando com hífens": async (p, c) => { await p.locator(SEL).pressSequentially(group4(c, "-"), { delay: 15 }); },
  "colando (Ctrl+V) o código puro": async (p, c) => { await paste(p, c); },
  "colando com quebra de linha e espaços no fim": async (p, c) => { await paste(p, `  ${group4(c)} \n\n`); },
  "colando com espaços não separáveis (NBSP)": async (p, c) => { await paste(p, group4(c, "\u00a0")); },
  "colando com caracteres invisíveis (largura zero/BOM/direção)": async (p, c) => { await paste(p, `\ufeff${c.slice(0, 4)}\u200b${c.slice(4, 9)}\u200e ${c.slice(9)}\u200f `); },
  "colando texto com palavras ('Meu código: … (guarde)')": async (p, c) => { await paste(p, `Meu código de acesso: ${group4(c)} (guarde bem!)`); },
  "colando mensagem longa (> 30 caracteres)": async (p, c) => { await paste(p, `Seu código de acesso privado é ${group4(c, "  ")}. Não compartilhe.`); },
  "dígitos de largura total (teclado CJK) via fill": async (p, c) => { await p.fill(SEL, [...c].map((d) => String.fromCharCode(d.charCodeAt(0) + 0xfee0)).join("")); },
  "digita, apaga 3 dígitos com Backspace e redigita": async (p, c) => {
    const i = p.locator(SEL);
    await i.pressSequentially(c, { delay: 10 });
    for (let k = 0; k < 3; k++) await p.keyboard.press("Backspace");
    await i.pressSequentially(c.slice(-3), { delay: 10 });
  },
  "enviando com a tecla Enter (sem tocar no botão)": async (p, c) => { await p.fill(SEL, group4(c)); }, // o runner envia por Enter quando o nome contém "Enter"
};
async function paste(p, text) {
  await p.evaluate((t) => navigator.clipboard.writeText(t), text);
  await p.locator(SEL).click();
  await p.keyboard.press("ControlOrMeta+V");
}

async function attempt(profile, name, code) {
  const ctx = await browser.newContext({ ...PROFILES[profile], permissions: ["clipboard-read", "clipboard-write"] });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  try {
    await page.goto(URL, { waitUntil: "networkidle" });
    await CASES[name](page, code);
    const digits = (await page.inputValue(SEL)).replace(/\D/g, "");
    if (!(await page.isEnabled('[data-testid="login-btn"]'))) return { ok: false, why: `botão Entrar desabilitado (campo ficou com ${digits.length} dígitos: ${digits === code ? "completo" : "incompleto/diferente"})` };
    if (/Enter/.test(name)) await page.locator(SEL).press("Enter"); else await page.click('[data-testid="login-btn"]');
    const win = await Promise.race([
      page.waitForSelector('[data-testid="composer"]', { timeout: 30000 }).then(() => "ok"),
      page.waitForSelector('[role="alert"]', { timeout: 30000 }).then(async () => "erro: " + (await page.textContent('[role="alert"]'))),
    ]);
    if (win !== "ok") return { ok: false, why: `campo=${digits.length} dígitos (${digits === code ? "igual" : "DIFERENTE"}); ${win}` };
    const sess = JSON.parse(await page.evaluate(() => localStorage.getItem("cli.session") ?? sessionStorage.getItem("cli.session")));
    await call("auth", "logout", {}, sess.access); // não deixa sessão pendurada
    return { ok: errors.length === 0, why: errors.join("|") };
  } catch (e) {
    return { ok: false, why: String(e).split("\n")[0] };
  } finally { await ctx.close(); }
}

try {
  const T = await register();
  const code = T.json.code;
  const owner = process.env.OWNER === "1" ? readFileSync(OWNER_FILE, "utf8").trim() : null;

  section(`Matriz de digitação/colagem no iPhone 13 (390x844) — ${URL}`);
  for (const name of Object.keys(CASES)) { const r = await attempt("iphone", name, code); check(name, r.ok, r.why); }
  for (const prof of ["pixel", "desktop"]) {
    section(`Subconjunto no perfil ${prof}`);
    for (const name of ["autofill/colagem programática sem espaços (fill)", "digitando tecla a tecla sem espaços (teclado numérico)", "digitando com espaços de 4 em 4", "colando (Ctrl+V) o código puro", "colando mensagem longa (> 30 caracteres)", "enviando com a tecla Enter (sem tocar no botão)"]) {
      const r = await attempt(prof, name, code); check(`[${prof}] ${name}`, r.ok, r.why);
    }
  }

  section("Mensagens de erro na tela (motivo real)");
  const ctx = await browser.newContext({ ...PROFILES.iphone });
  const page = await ctx.newPage();
  await page.goto(URL, { waitUntil: "networkidle" });
  const origin = new globalThis.URL(URL).origin;
  const tryLogin = async () => { await page.fill(SEL, "4829 1750 3648 1927 301"); await page.click('[data-testid="login-btn"]'); await page.waitForSelector('[role="alert"]', { timeout: 15000 }); return (await page.textContent('[role="alert"]'))?.trim(); };
  const cors = { "access-control-allow-origin": origin, "content-type": "application/json" };
  const modes = {
    "código inexistente (resposta REAL 401 do servidor)": null,
    "429 limite de tentativas": (r) => r.fulfill({ status: 429, headers: cors, body: JSON.stringify({ error: "rate_limited", message: "Muitas tentativas.", retry_after: 600 }) }),
    "503 servidor": (r) => r.fulfill({ status: 503, headers: { ...cors, "content-type": "text/html" }, body: "<html>Service Unavailable</html>" }),
    "rede/CORS (requisição abortada)": (r) => r.abort("failed"),
  };
  const seen = {};
  for (const [label, handler] of Object.entries(modes)) {
    await page.unroute("**/functions/v1/auth/login").catch(() => {});
    if (handler) await page.route("**/functions/v1/auth/login", handler);
    seen[label] = await tryLogin();
    console.log(`  [${label}] → ${JSON.stringify(seen[label])}`);
  }
  const vals = Object.values(seen);
  check("as 4 situações mostram mensagens DIFERENTES entre si", new Set(vals).size === 4, JSON.stringify(vals));
  check("429 fala em limite/aguardar; rede fala em conexão; servidor fala em servidor; 401 fala em código", /aguarde|Muitas tentativas/i.test(seen["429 limite de tentativas"]) && /conex|servidor|rede/i.test(seen["rede/CORS (requisição abortada)"]) && /servidor/i.test(seen["503 servidor"]) && /código/i.test(seen["código inexistente (resposta REAL 401 do servidor)"]));
  await page.unroute("**/functions/v1/auth/login").catch(() => {});
  await page.fill(SEL, "4829 1750");
  const hint = await page.textContent('[data-testid="digit-count"]').catch(() => null);
  console.log(`  contador de dígitos: ${JSON.stringify(hint)}`);
  check("campo incompleto mostra quantos dígitos faltam (o botão desabilitado não fica mudo)", /8 de 19|faltam 11/.test(hint ?? ""), String(hint));
  await ctx.close();

  if (owner) {
    section("Código do DONO (owner_code.txt) pelo site publicado — somente login/logout");
    for (const [prof, name] of [["iphone", "digitando tecla a tecla sem espaços (teclado numérico)"], ["pixel", "colando (Ctrl+V) o código puro"], ["iphone", "digitando com espaços de 4 em 4"]]) {
      const r = await attempt(prof, name, owner); check(`[dono/${prof}] ${name}`, r.ok, r.why);
    }
  }
} finally {
  await browser.close();
  const cl = await cleanupTestUsers();
  check("usuários de teste apagados", cl.status === 200);
  summary();
}
