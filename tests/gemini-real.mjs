// Conversa REAL em produção com o login do DONO (owner_code.txt, nunca impresso): resposta do Gemini, fallback para Pollinations com o Gemini
// em cooldown, e limpeza (apaga a conversa de teste). Usa o plano grátis com parcimônia (2 chamadas de chat). Não cria usuários.
import { readFileSync } from "node:fs";
import { OWNER_FILE, admin, call, chat, check, summary } from "./lib.mjs";

const section = (t) => console.log(`\n▶ ${t}`);
const code = readFileSync(OWNER_FILE, "utf8").trim();
let conv = null, tok = null;
try {
  section("Login do dono (código lido de owner_code.txt)");
  const l = await call("auth", "login", { code });
  check("login do dono 200", l.status === 200);
  tok = l.json.access_token;

  section("Catálogo: Gemini configurado, só modelos de chat atuais");
  const cat = await call("data", "models.list", {}, tok);
  const gem = cat.json.catalog.find((c) => c.provider === "gemini");
  const ids = gem.models.map((m) => m.id);
  console.log("  modelos Gemini ativos:", ids.join(", "));
  check("Gemini aparece como configurado", gem.configured === true);
  check("inclui gemini-3.5-flash, 3.5-flash-lite e flash-lite-latest", ["gemini-3.5-flash", "gemini-3.5-flash-lite", "gemini-flash-lite-latest"].every((i) => ids.includes(i)));
  check("não inclui 2.5/2.0 nem imagem/TTS/transcrição/lyria/robotics/computer-use/deep-research/antigravity/omni/nano-banana/embedding", !ids.some((i) => /2\.5|2\.0|tts|image|transcribe|lyria|robotics|computer-use|deep-research|antigravity|omni|nano-banana|embedding/.test(i)));
  const order = cat.json.catalog.filter((c) => c.configured && !c.paid).flatMap((c) => c.models.map((m) => ({ p: c.provider, rank: m.rank }))).sort((a, b) => a.rank - b.rank).map((x) => x.p);
  check("ordem do Automático: Pollinations é o último gratuito e vem depois do Gemini", order.at(-1) === "pollinations" && order.indexOf("gemini") < order.indexOf("pollinations"), order.join(">"));

  section("Conversa real: resposta vem do Gemini");
  const c1 = await chat(tok, { content: 'Responda apenas com a palavra "azul".', model: "auto" });
  const done = c1.events.find((e) => e.event === "done");
  console.log("  eventos de troca:", JSON.stringify(c1.events.filter((e) => e.event === "fallback" || e.event === "attempt").map((e) => e.data)));
  conv = c1.events.find((e) => e.data?.conversation_id)?.data.conversation_id ?? done?.data?.message?.conversation_id ?? null;
  check("stream terminou com 'done' do provedor gemini", done?.data?.message?.provider === "gemini", JSON.stringify(c1.events.slice(-2)));
  const ms = await call("data", "conv.messages", { id: conv }, tok);
  const last = ms.json.messages?.at(-1);
  check("mensagem gravada com provider=gemini e model", last?.role === "assistant" && last.provider === "gemini" && /^gemini-/.test(last.model), JSON.stringify({ p: last?.provider, m: last?.model }));
  check("conteúdo da resposta não vazio", (last?.content ?? "").length > 0);
  console.log(`  provider/model gravados: ${last?.provider} / ${last?.model} (fallback_used=${last?.fallback_used})`);

  section("Gemini em cooldown => cai para o Pollinations");
  const p = await admin({ action: "pause", provider: "gemini", seconds: 120 });
  check("pausa do Gemini aplicada (admin)", p.status === 200);
  const c2 = await chat(tok, { conversation_id: conv, content: 'Agora responda apenas com a palavra "verde".', model: "auto" });
  const d2 = c2.events.find((e) => e.event === "done");
  const ms2 = await call("data", "conv.messages", { id: conv }, tok);
  const l2 = ms2.json.messages?.at(-1);
  console.log(`  provider/model gravados: ${l2?.provider} / ${l2?.model} (fallback_used=${l2?.fallback_used})`);
  check("resposta veio do Pollinations com o Gemini em cooldown", d2?.data?.message?.provider === "pollinations" && l2?.provider === "pollinations", JSON.stringify(c2.events.slice(-2)));
  check("o Gemini não foi chamado durante o cooldown (nenhum 'attempt' dele)", !c2.events.some((e) => e.event === "attempt" && e.data?.provider === "gemini"));
} finally {
  const c = await admin({ action: "clear-cooldown", provider: "gemini" });
  check("cooldown do Gemini removido", c.status === 200);
  if (conv && tok) {
    const d = await call("data", "conv.delete", { id: conv }, tok);
    check("conversa de teste apagada", d.status === 200);
    const g = await call("data", "conv.messages", { id: conv }, tok);
    check("conversa apagada some (404)", g.status === 404);
  }
  if (tok) await call("auth", "logout", {}, tok);
  summary();
}
