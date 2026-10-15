// E2E do login por QR code (Playwright/Chromium headless) contra a PRODUÇÃO no GitHub Pages.
//   node tests/e2e-qr.mjs [URL]       (limpe public.rate_limits antes; apaga a conta de teste no fim)
// A CÂMERA é a câmera FAKE do Chromium alimentada com um vídeo do QR (ffmpeg): valida o caminho getUserMedia -> decodificação -> login,
// mas NÃO é uma câmera física de celular (isso não dá para testar aqui).
import { chromium, devices } from "playwright";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { PNG } from "pngjs";
import jsQR from "jsqr";
import QRCode from "qrcode";
import { call, check, cleanupTestUsers, register, summary } from "./lib.mjs";

const APP = process.argv[2] ?? "https://drthaleschateaubriand.github.io/chat-livre-ia/";
const DIR = process.env.SHOTS_DIR ?? "/workspace/chat-livre-ia-private/screens";
const TMP = "/workspace/chat-livre-ia-private/qr-tmp";
mkdirSync(DIR, { recursive: true }); mkdirSync(TMP, { recursive: true });
const section = (t) => console.log(`\n▶ ${t}`);
const iphone = { ...devices["iPhone 13"], viewport: { width: 390, height: 844 }, locale: "pt-BR" };
const decodePng = (path) => { const p = PNG.sync.read(readFileSync(path)); return jsQR(new Uint8ClampedArray(p.data), p.width, p.height)?.data ?? null; };
const leaks = []; // URLs de requisições que contenham o código (não devem existir)
let CODE = "";
const watch = (page) => page.on("request", (r) => { if (CODE && (r.url().includes(CODE) || /[?&]c=\d{18}/.test(r.url()))) leaks.push(r.url()); });
const errors = [];
const trackErrors = (page) => { page.on("pageerror", (e) => errors.push(String(e))); };

const browser = await chromium.launch();

section("App privado: login com código (usuário de TESTE criado pelo ADMIN) e sem criação de conta");
const T = await register();
CODE = T.json.code;
const ctx1 = await browser.newContext({ ...iphone, acceptDownloads: true });
const page = await ctx1.newPage(); watch(page); trackErrors(page);
await page.goto(APP, { waitUntil: "networkidle" });
check("tela de login tem o botão 'Entrar com QR code'", await page.isVisible('[data-testid="qr-login-btn"]'));
check("não há 'Criar conta' na interface", (await page.locator("text=Criar conta").count()) === 0);
await page.fill('[data-testid="code-input"]', CODE);
await page.click('[data-testid="login-btn"]');
await page.waitForSelector('[data-testid="composer"]', { timeout: 30000 });

section("Configurações → QR de acesso (exige o código + confirmação)");
await page.click('[data-testid="menu-btn"]');
await page.click('[data-testid="settings-btn"]');
await page.click("button:has-text('QR de acesso')");
check("botão desabilitado sem código/confirmação", await page.isDisabled('[data-testid="qr-generate"]'));
await page.fill('[data-testid="qr-code-input"]', "4829 1750 3648 1927 301");
await page.check('[data-testid="qr-ack"]');
await page.click('[data-testid="qr-generate"]');
await page.waitForSelector('[role="alert"]', { timeout: 15000 });
check("código errado: erro e nenhum QR exibido", (await page.locator('[data-testid="qr-img"]').count()) === 0);
check("código errado não derruba a sessão", await page.isVisible('[data-testid="settings"]'));
await page.fill('[data-testid="qr-code-input"]', CODE);
await page.click('[data-testid="qr-generate"]');
await page.waitForSelector('[data-testid="qr-img"]', { timeout: 15000 });
await page.screenshot({ path: `${DIR}/20-qr-ajustes-iphone.png` });
await page.locator('[data-testid="qr-card"]').scrollIntoViewIfNeeded();
await page.screenshot({ path: `${DIR}/19-qr-revelacao-iphone.png` });
const warn = await page.textContent('[data-testid="qr-card"]');
check("aviso claro: QR equivale ao código / quem o tiver acessa a conta", /equivale ao seu código/i.test(warn) && /acessa a sua conta/i.test(warn));
const [dl2] = await Promise.all([page.waitForEvent("download"), page.click('[data-testid="qr-download"]')]);
const qrPath = `${TMP}/qr-conta.png`;
await dl2.saveAs(qrPath);
check(`botão baixar salva um PNG (${dl2.suggestedFilename()})`, /\.png$/.test(dl2.suggestedFilename()));
const payload = decodePng(qrPath);
check("o PNG baixado decodifica e contém o link com FRAGMENTO #/login?c=<código>", payload === `${APP}#/login?c=${CODE}`, String(payload));
check("o link NÃO usa query string (código só no fragmento)", !!payload && new URL(payload).search === "" && new URL(payload).hash.includes(CODE));
await page.click('[data-testid="qr-hide"]');
check("'Ocultar QR' remove a imagem", (await page.locator('[data-testid="qr-img"]').count()) === 0);
await page.keyboard.press("Escape");

section("Abrir o LINK do QR (câmera nativa do celular): login automático e fragmento limpo");
const ctx2 = await browser.newContext({ ...iphone });
const p2 = await ctx2.newPage(); watch(p2); trackErrors(p2);
const loginBodies = [];
p2.on("request", (r) => { if (r.url().endsWith("/auth/login")) loginBodies.push(r.postData()); });
await p2.goto(payload, { waitUntil: "domcontentloaded" });
await p2.waitForSelector('[data-testid="composer"]', { timeout: 30000 });
check("link do QR => login automático (chat aberto)", true);
check("fragmento com o código foi REMOVIDO da URL (history.replaceState)", !p2.url().includes(CODE) && !p2.url().includes("login") && p2.url().startsWith(APP), p2.url());
check("o código também não ficou em location.hash", (await p2.evaluate(() => location.hash)) === "");
check("o login enviou o código só no CORPO do POST (HTTPS), não na URL", loginBodies.length === 1 && loginBodies[0].includes(CODE));
await p2.screenshot({ path: `${DIR}/21-login-por-link-iphone.png` });
// já logado + link: ignora e limpa
const p2b = await ctx2.newPage(); watch(p2b);
await p2b.goto(payload, { waitUntil: "domcontentloaded" });
await p2b.waitForSelector('[data-testid="composer"]');
check("com sessão ativa, abrir o link só limpa o fragmento (não faz novo login)", !p2b.url().includes(CODE));
await ctx2.close();

section("Link inválido: mensagem e fallback para digitar");
const ctx3 = await browser.newContext({ ...iphone });
const p3 = await ctx3.newPage(); watch(p3);
await p3.goto(`${APP}#/login?c=123`, { waitUntil: "networkidle" });
await p3.waitForSelector('[role="alert"]');
check("mensagem de link inválido", /não contém um código de acesso válido/.test(await p3.textContent('[role="alert"]')));
check("fragmento limpo mesmo no link inválido", !p3.url().includes("login"));
await p3.fill('[data-testid="code-input"]', CODE);
await p3.click('[data-testid="login-btn"]');
await p3.waitForSelector('[data-testid="composer"]', { timeout: 30000 });
check("depois do erro, digitar o código manualmente funciona", true);
await ctx3.close();

section("Escolher imagem do QR salva na galeria");
const ctx4 = await browser.newContext({ ...iphone });
const p4 = await ctx4.newPage(); watch(p4); trackErrors(p4);
await p4.goto(APP, { waitUntil: "networkidle" });
await p4.click('[data-testid="qr-login-btn"]');
await p4.waitForSelector('[data-testid="qr-scanner"]');
// QR de OUTRO conteúdo e imagem sem QR: mensagens claras, sem login
writeFileSync(`${TMP}/qr-outro.png`, await QRCode.toBuffer("https://example.com/qualquer-coisa", { width: 400 }));
const blank = new PNG({ width: 200, height: 200 }); blank.data.fill(255); writeFileSync(`${TMP}/branco.png`, PNG.sync.write(blank));
await p4.setInputFiles('[data-testid="qr-file"]', `${TMP}/qr-outro.png`);
await p4.waitForFunction(() => /não é um QR de login/.test(document.querySelector('[data-testid="qr-msg"]')?.textContent ?? ""), null, { timeout: 15000 });
check("QR de outro site é recusado com mensagem clara", true);
await p4.setInputFiles('[data-testid="qr-file"]', `${TMP}/branco.png`);
await p4.waitForFunction(() => /Não encontrei um QR/.test(document.querySelector('[data-testid="qr-msg"]')?.textContent ?? ""), null, { timeout: 15000 });
check("imagem sem QR: mensagem clara", true);
await p4.screenshot({ path: `${DIR}/22-qr-imagem-invalida-iphone.png` });
await p4.setInputFiles('[data-testid="qr-file"]', qrPath);
await p4.waitForSelector('[data-testid="composer"]', { timeout: 30000 });
check("imagem do QR salva (PNG baixado) => login", true);
await ctx4.close();

section("Sem câmera / permissão de câmera NEGADA => mensagem e fallback");
const ctx5 = await browser.newContext({ ...iphone });
const p5 = await ctx5.newPage(); watch(p5);
await p5.goto(APP, { waitUntil: "networkidle" });
await p5.click('[data-testid="qr-login-btn"]');
await p5.waitForFunction(() => /negada|não permite usar a câmera|Nenhuma câmera|Não foi possível abrir a câmera/.test(document.querySelector('[data-testid="qr-msg"]')?.textContent ?? ""), null, { timeout: 15000 });
const noCam = await p5.textContent('[data-testid="qr-msg"]');
console.log(`  (Chromium headless real, sem câmera: "${noCam}")`);
check("sem câmera (real, headless): mensagem explicativa com alternativas (imagem/digitar)", /imagem|digite/i.test(noCam));
await p5.click('[data-testid="qr-type"]');
check("'Digitar o código' volta ao campo de login", await p5.isVisible('[data-testid="code-input"]'));
await ctx5.close();
// Negação de permissão: o headless não mostra prompt; SIMULAMOS o erro NotAllowedError do getUserMedia (o texto/fluxo da UI é real)
const ctx5b = await browser.newContext({ ...iphone });
await ctx5b.addInitScript(() => { navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException("Permission denied", "NotAllowedError")); });
const p5b = await ctx5b.newPage();
await p5b.goto(APP, { waitUntil: "networkidle" });
await p5b.click('[data-testid="qr-login-btn"]');
await p5b.waitForFunction(() => /Permissão da câmera negada/.test(document.querySelector('[data-testid="qr-msg"]')?.textContent ?? ""), null, { timeout: 15000 });
check("[simulado] NotAllowedError => 'Permissão da câmera negada' + sugere imagem/digitar", /imagem/.test(await p5b.textContent('[data-testid="qr-msg"]')));
await p5b.screenshot({ path: `${DIR}/23-camera-negada-iphone.png` });
// mesmo sem câmera, a imagem da galeria funciona e o resultado é mostrado
await p5b.setInputFiles('[data-testid="qr-file"]', `${TMP}/branco.png`);
await p5b.waitForFunction(() => /Não encontrei um QR/.test(document.querySelector('[data-testid="qr-msg"]')?.textContent ?? ""), null, { timeout: 15000 });
check("com câmera negada, a leitura de imagem continua funcionando e mostra o resultado", true);
await p5b.setInputFiles('[data-testid="qr-file"]', qrPath);
await p5b.waitForSelector('[data-testid="composer"]', { timeout: 30000 });
check("com câmera negada: escolher a imagem do QR => login", true);
await ctx5b.close();
await browser.close();

section("Câmera (FAKE do Chromium com vídeo do QR) => lê o QR e entra");
const y4m = `${TMP}/qr.y4m`;
execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-loop", "1", "-i", qrPath, "-t", "4", "-r", "10", "-vf", "scale=480:480:force_original_aspect_ratio=decrease,pad=640:480:(ow-iw)/2:(oh-ih)/2:white,format=yuv420p", y4m]);
const camBrowser = await chromium.launch({ args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", `--use-file-for-fake-video-capture=${y4m}`] });
const ctx6 = await camBrowser.newContext({ ...iphone, permissions: ["camera"] });
const p6 = await ctx6.newPage(); watch(p6); trackErrors(p6);
await p6.goto(APP, { waitUntil: "networkidle" });
const hasBD = await p6.evaluate(() => "BarcodeDetector" in window);
console.log(`  (BarcodeDetector nativo neste Chromium headless: ${hasBD ? "sim" : "não — usa jsQR"})`);
await p6.click('[data-testid="qr-login-btn"]');
await p6.waitForSelector('[data-testid="qr-video"]');
await p6.screenshot({ path: `${DIR}/24-camera-fake-iphone.png` });
await p6.waitForSelector('[data-testid="composer"]', { timeout: 40000 });
check("câmera (fake) lê o QR do vídeo e faz login", true);
await ctx6.close();
await camBrowser.close();

check("NENHUMA requisição levou o código na URL/query (só no corpo do POST de login)", leaks.length === 0, leaks.join(" | "));
check("sem erros de JavaScript", errors.length === 0, errors.slice(0, 3).join(" | "));

// limpeza: apaga os usuários de TESTE (o dono real nunca é tocado)
const cl = await cleanupTestUsers();
check("usuários de teste apagados", cl.status === 200);
summary();
