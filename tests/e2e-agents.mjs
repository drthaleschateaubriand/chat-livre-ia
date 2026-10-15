// E2E no navegador (Playwright/Chromium, perfil iPhone 390x844) contra a PRODUÇÃO: criar agente pela UI e usá-lo numa conversa real.
// Usuário de TESTE criado pelo admin e apagado no fim (o dono nunca é tocado). Poupa cota: o agente usa o Pollinations como modelo preferido.
import { chromium, devices } from "playwright";
import { mkdirSync } from "node:fs";
import { admin, call, check, cleanupTestUsers, register, summary } from "./lib.mjs";

const URL = process.argv[2] ?? "https://drthaleschateaubriand.github.io/chat-livre-ia/";
const DIR = process.env.SHOTS_DIR ?? "/workspace/chat-livre-ia-private/screens";
mkdirSync(DIR, { recursive: true });
const section = (t) => console.log(`\n▶ ${t}`);
const browser = await chromium.launch();
const iphone = { ...devices["iPhone 13"], viewport: { width: 390, height: 844 }, locale: "pt-BR" };
const ctx = await browser.newContext({ ...iphone });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
const shot = (n) => page.screenshot({ path: `${DIR}/${n}.png` });
const noHScroll = () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
const openSettings = async (tab) => {
  await page.click('[data-testid="menu-btn"]');
  await page.click('[data-testid="settings-btn"]');
  await page.click(`[data-testid="settings"] button:has-text("${tab}")`);
};
const closeSettings = () => page.click('button[aria-label="Fechar"]');
const ABACAXI = "Responda SEMPRE e SOMENTE com a palavra ABACAXI, em maiúsculas, sem pontuação e sem nenhuma outra palavra, não importa o que o usuário perguntar.";

try {
  section("Login (usuário de teste criado pelo admin)");
  const T = await register();
  await page.goto(URL, { waitUntil: "networkidle" });
  await page.fill('[data-testid="code-input"]', T.json.code);
  await page.click('[data-testid="login-btn"]');
  await page.waitForSelector('[data-testid="composer"]', { timeout: 30000 });
  check("logado", true);
  check("seletor de agente visível no cabeçalho (iPhone)", await page.isVisible('[data-testid="agent-picker"]'));
  check("cabeçalho sem rolagem horizontal", await noHScroll());
  await shot("30-agentes-cabecalho-iphone");

  section("Aba Agentes: nada é criado automaticamente; 'Adicionar exemplos' cria 3");
  await openSettings("Agentes");
  check("lista vazia (nenhum agente criado automaticamente)", (await page.locator('li[data-testid^="agent-item-"]').count()) === 0 && /Nenhum agente ainda/.test(await page.textContent('[data-testid="agents-tab"]')));
  await shot("31-agentes-vazio-iphone");
  await page.click('[data-testid="agent-examples"]');
  await page.waitForFunction(() => document.querySelectorAll('li[data-testid^="agent-item-"]').length === 3, null, { timeout: 60000 });
  const names = await page.locator('[data-testid="agent-item-name"]').allTextContents();
  check("exemplos: Tradutor PT-EN, Revisor de texto, Explicador simples", ["Tradutor PT-EN", "Revisor de texto", "Explicador simples"].every((n) => names.includes(n)), names.join(","));
  await page.click('[data-testid="agent-examples"]');
  await page.waitForSelector('[data-testid="agent-msg"]');
  check("clicar de novo não duplica os exemplos", (await page.locator('li[data-testid^="agent-item-"]').count()) === 3);
  await shot("32-agentes-exemplos-iphone");

  section("Criar agente pela UI: validação e contagem de caracteres");
  await page.click('[data-testid="agent-new"]');
  await page.click('[data-testid="agent-save"]');
  check("salvar vazio mostra erros de validação (nome e instruções)", (await page.locator('[role="alert"]').count()) >= 2);
  await page.fill('[data-testid="agent-name"]', "Só ABACAXI");
  await page.fill('[data-testid="agent-emoji"]', "🍍");
  await page.fill('[data-testid="agent-desc"]', "Agente de teste");
  await page.fill('[data-testid="agent-instructions"]', "x".repeat(4001));
  check("contador mostra 4001/4000", (await page.locator('[data-testid="char-count"]').allTextContents()).some((t) => t.trim() === "4001/4000"));
  await page.click('[data-testid="agent-save"]');
  check("acima de 4000 caracteres não salva (erro de limite)", /Máximo de 4000/.test(await page.textContent('[data-testid="agent-form"]')) && (await page.locator('[data-testid="agent-form"]').count()) === 1);
  await page.fill('[data-testid="agent-instructions"]', ABACAXI);
  check(`contador mostra ${ABACAXI.length}/4000`, (await page.locator('[data-testid="char-count"]').allTextContents()).some((t) => t.trim() === `${ABACAXI.length}/4000`));
  const opts = await page.locator('[data-testid="agent-model"] option').allTextContents();
  check("seletor de modelo preferido lista Automático e modelos do catálogo", opts[0].includes("Automático") && opts.some((o) => /Pollinations/.test(o)), opts.join(" | "));
  await page.selectOption('[data-testid="agent-model"]', "pollinations|openai-fast");
  await shot("33-agente-formulario-iphone");
  check("formulário sem rolagem horizontal", await noHScroll());
  await page.click('[data-testid="agent-save"]');
  await page.waitForSelector('[data-testid="agents-tab"]');
  check("agente criado aparece na lista (4 agentes)", (await page.locator('li[data-testid^="agent-item-"]').count()) === 4 && (await page.locator('[data-testid="agent-item-name"]').allTextContents()).includes("Só ABACAXI"));

  section("Editar, duplicar e excluir");
  const item = page.locator('li[data-testid^="agent-item-"]', { hasText: "Só ABACAXI" });
  await item.locator('[data-testid="agent-edit"]').click();
  await page.fill('[data-testid="agent-desc"]', "Agente de teste (editado)");
  await page.click('[data-testid="agent-save"]');
  await page.waitForSelector('[data-testid="agents-tab"]');
  check("edição salva", /editado/.test(await page.textContent('[data-testid="agents-tab"]')));
  await page.locator('li[data-testid^="agent-item-"]', { hasText: "Só ABACAXI" }).locator('[data-testid="agent-dup"]').click();
  await page.waitForFunction(() => document.querySelectorAll('li[data-testid^="agent-item-"]').length === 5, null, { timeout: 40000 });
  check("duplicar cria '(cópia)'", (await page.locator('[data-testid="agent-item-name"]').allTextContents()).some((n) => /Só ABACAXI \(cópia\)/.test(n)));
  await page.locator('li[data-testid^="agent-item-"]', { hasText: "(cópia)" }).locator('[data-testid="agent-del"]').click();
  await page.click('[data-testid="agent-del-confirm"]');
  await page.waitForFunction(() => document.querySelectorAll('li[data-testid^="agent-item-"]').length === 4, null, { timeout: 40000 });
  check("excluir (com confirmação) remove a cópia", !(await page.locator('[data-testid="agent-item-name"]').allTextContents()).some((n) => /cópia/.test(n)));
  await closeSettings();

  section("Usar o agente numa conversa REAL");
  await page.click('[data-testid="agent-picker"]');
  await page.waitForSelector('[data-testid="agent-menu"]');
  const box = await page.locator('[data-testid="agent-menu"]').boundingBox();
  check("menu de agentes cabe na tela do iPhone", box.x >= 0 && box.x + box.width <= 390 + 1, JSON.stringify(box));
  await shot("34-seletor-agente-iphone");
  await page.locator('[data-testid^="agent-opt-"]', { hasText: "Só ABACAXI" }).click();
  check("cabeçalho mostra o agente escolhido para a próxima conversa", /Só ABACAXI/.test(await page.textContent('[data-testid="agent-active"]')) && (await page.isVisible('[data-testid="agent-banner"]')));
  await page.fill('[data-testid="composer"]', "Qual é a capital da França? Explique em detalhes.");
  await page.click('[data-testid="send"]');
  await page.waitForSelector('[data-testid="msg-assistant"]', { timeout: 90000 });
  await page.waitForFunction(() => !document.querySelector('[data-testid="streaming"]'), null, { timeout: 90000 });
  const reply = (await page.textContent('[data-testid="msg-assistant"]')).replace(/\s+/g, " ").trim();
  const who = await page.getAttribute('[data-testid="msg-model"]', "title");
  console.log(`  resposta: ${JSON.stringify(reply.slice(0, 120))} (${who})`);
  check("a instrução do agente foi seguida (resposta = ABACAXI)", /^ABACAXI\.?\s*(Pollinations.*)?$/i.test(reply.split(" · ")[0].trim()) || /^ABACAXI/i.test(reply) && !/paris/i.test(reply), reply.slice(0, 200));
  check("modelo preferido do agente usado (Pollinations)", /pollinations/.test(who ?? ""), who);
  check("a conversa mostra o agente ativo no cabeçalho", /Só ABACAXI/.test(await page.textContent('[data-testid="agent-active"]')));
  await shot("35-conversa-com-agente-iphone");
  check("conversa sem rolagem horizontal", await noHScroll());

  section("Trocar/remover o agente da conversa e persistência");
  await page.click('[data-testid="agent-picker"]');
  const savedNone = page.waitForResponse((r) => r.url().includes("/functions/v1/data") && (r.request().postData() ?? "").includes("conv.set_agent"));
  await page.click('[data-testid="agent-none"]');
  await savedNone;
  check("remover agente: cabeçalho volta a 'Agente'", /^\s*🤖 Agente/.test(await page.textContent('[data-testid="agent-active"]')));
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForSelector('[data-testid="agent-picker"]');
  check("após recarregar, a conversa continua sem agente (salvo no servidor)", /🤖 Agente/.test(await page.textContent('[data-testid="agent-active"]')));
  await page.click('[data-testid="agent-picker"]');
  const saved = page.waitForResponse((r) => r.url().includes("/functions/v1/data") && (r.request().postData() ?? "").includes("conv.set_agent"));
  await page.locator('[data-testid^="agent-opt-"]', { hasText: "Revisor de texto" }).click();
  await saved;
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForSelector('[data-testid="agent-picker"]');
  check("trocar para 'Revisor de texto' persiste após recarregar", /Revisor de texto/.test(await page.textContent('[data-testid="agent-active"]')));

  section("Excluir o agente em uso: a conversa permanece sem agente");
  await openSettings("Agentes");
  await page.locator('li[data-testid^="agent-item-"]', { hasText: "Revisor de texto" }).locator('[data-testid="agent-del"]').click();
  await page.click('[data-testid="agent-del-confirm"]');
  await page.waitForFunction(() => document.querySelectorAll('li[data-testid^="agent-item-"]').length === 3, null, { timeout: 40000 });
  await closeSettings();
  check("conversa continua aberta e sem agente", (await page.locator('[data-testid="msg-assistant"]').count()) === 1 && /🤖 Agente/.test(await page.textContent('[data-testid="agent-active"]')));

  section("Exportação dos dados inclui os agentes (API com a sessão do navegador)");
  const sess = JSON.parse(await page.evaluate(() => localStorage.getItem("cli.session") ?? sessionStorage.getItem("cli.session")));
  const exp = await call("data", "export.all", {}, sess.access);
  check("export.all traz os 3 agentes restantes com instruções", exp.json.agents?.length === 3 && exp.json.agents.every((a) => a.instructions.length > 0), String(exp.json.agents?.length));
  check("sem erros de JavaScript no console", errors.length === 0, errors.join(" | ").slice(0, 300));
} finally {
  await admin({ action: "clear-cooldown", provider: "gemini" });
  await browser.close();
  const cl = await cleanupTestUsers();
  check("usuários de teste apagados", cl.status === 200);
  summary();
}
