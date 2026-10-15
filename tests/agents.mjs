// Integração REAL (produção) dos AGENTES: CRUD, validação, isolamento entre usuários, conversa com agente e instrução seguida.
// Usuários de TESTE são criados pelo ADMIN e apagados no fim (o dono real nunca é tocado). Poupa cota grátis: a conversa real usa um agente
// com preferred_model = Pollinations (nenhuma chamada ao Gemini); o Gemini só é pausado no controle "sem agente".
import { admin, call, chat, check, cleanupTestUsers, register, summary } from "./lib.mjs";

const section = (t) => console.log(`\n▶ ${t}`);
const doneMsg = (c) => c.events.find((e) => e.event === "done")?.data.message;
const base = { name: "Tradutor PT-EN", description: "Traduz entre português e inglês", instructions: "Traduza o texto do usuário. Responda só com a tradução.", emoji: "🌐", preferred_model: "auto" };

try {
  const A = await register({ device_name: "Agentes A" });
  const B = await register({ device_name: "Agentes B" });
  const tA = A.json.access_token, tB = B.json.access_token;
  check("usuários de teste A e B criados pelo admin", A.status === 200 && B.status === 200);

  section("Sem sessão: acesso negado");
  const noAuth = await call("data", "agent.list", {});
  check("agent.list sem token => 401", noAuth.status === 401);
  const noAuth2 = await call("data", "agent.create", base, "token-invalido-0000000000000000000000000000");
  check("agent.create com token inválido => 401", noAuth2.status === 401);

  section("CRUD");
  const c1 = await call("data", "agent.create", base, tA);
  check("criar agente (201) com id e campos", c1.status === 201 && c1.json.agent?.id && c1.json.agent.name === base.name && c1.json.agent.emoji === "🌐", JSON.stringify(c1.json));
  const ag = c1.json.agent;
  const l1 = await call("data", "agent.list", {}, tA);
  check("agent.list devolve o agente com as instruções", l1.json.agents.length === 1 && l1.json.agents[0].instructions === base.instructions);
  const u1 = await call("data", "agent.update", { ...base, id: ag.id, name: "Tradutor (v2)", description: "novo", preferred_model: "pollinations|openai-fast" }, tA);
  check("atualizar agente", u1.status === 200 && u1.json.agent.name === "Tradutor (v2)" && u1.json.agent.preferred_model === "pollinations|openai-fast" && u1.json.agent.updated_at >= ag.updated_at);
  const d1 = await call("data", "agent.duplicate", { id: ag.id }, tA);
  check("duplicar agente (201, '(cópia)', mesmas instruções, outro id)", d1.status === 201 && d1.json.agent.id !== ag.id && /\(cópia\)$/.test(d1.json.agent.name) && d1.json.agent.instructions === base.instructions);
  const del1 = await call("data", "agent.delete", { id: d1.json.agent.id }, tA);
  const l2 = await call("data", "agent.list", {}, tA);
  check("excluir agente", del1.status === 200 && l2.json.agents.length === 1);
  const del2 = await call("data", "agent.delete", { id: d1.json.agent.id }, tA);
  check("excluir de novo => 404", del2.status === 404);

  section("Validação no servidor");
  for (const [nome, body] of [
    ["nome vazio", { ...base, name: "   " }],
    ["nome > 60", { ...base, name: "n".repeat(61) }],
    ["descrição > 200", { ...base, description: "d".repeat(201) }],
    ["instruções vazias", { ...base, instructions: "" }],
    ["instruções > 4000", { ...base, instructions: "i".repeat(4001) }],
    ["modelo inválido", { ...base, preferred_model: "qualquer coisa" }],
    ["emoji longo demais", { ...base, emoji: "abcdefghi" }],
    ["nome não-texto", { ...base, name: 42 }],
  ]) {
    const r = await call("data", "agent.create", body, tA);
    check(`${nome} => 400`, r.status === 400, `${r.status} ${JSON.stringify(r.json)}`);
  }
  const max = await call("data", "agent.create", { ...base, name: "Máximo", instructions: "i".repeat(4000) }, tA);
  check("instruções com exatamente 4000 caracteres são aceitas", max.status === 201);
  await call("data", "agent.delete", { id: max.json.agent.id }, tA);
  const upBad = await call("data", "agent.update", { ...base, id: ag.id, instructions: "" }, tA);
  check("atualizar com dados inválidos => 400 e nada muda", upBad.status === 400 && (await call("data", "agent.list", {}, tA)).json.agents[0].instructions === base.instructions);

  section("Isolamento entre usuários");
  const lb = await call("data", "agent.list", {}, tB);
  check("B não vê os agentes de A", lb.status === 200 && lb.json.agents.length === 0);
  check("B não vê agentes de A no bootstrap nem na exportação", (await call("data", "bootstrap", {}, tB)).json.agents.length === 0 && (await call("data", "export.all", {}, tB)).json.agents.length === 0);
  for (const [act, body] of [["agent.update", { ...base, id: ag.id, name: "hack" }], ["agent.delete", { id: ag.id }], ["agent.duplicate", { id: ag.id }], ["conv.create", { agent_id: ag.id }]]) {
    const r = await call("data", act, body, tB);
    check(`B em ${act} com agente de A => 404`, r.status === 404, `${r.status}`);
  }
  const cb = await chat(tB, { content: "oi", agent_id: ag.id, model: "auto" });
  check("B no chat/send com agent_id de A => 404 (e nenhuma conversa criada)", cb.status === 404 && (await call("data", "conv.list", {}, tB)).json.conversations.length === 0);
  const convB = await call("data", "conv.create", {}, tB);
  const setB = await call("data", "conv.set_agent", { id: convB.json.conversation.id, agent_id: ag.id }, tB);
  check("B não consegue vincular agente de A à própria conversa (404)", setB.status === 404);
  const convA0 = await call("data", "conv.create", { title: "de A" }, tA);
  const setA = await call("data", "conv.set_agent", { id: convA0.json.conversation.id, agent_id: ag.id }, tB);
  check("B não consegue mexer na conversa de A (404)", setA.status === 404);
  check("agente de A segue intacto", (await call("data", "agent.list", {}, tA)).json.agents[0].name === "Tradutor (v2)");

  section("Conversa ↔ agente (escolher, trocar, remover)");
  const ca = await call("data", "conv.create", { title: "Com agente", agent_id: ag.id }, tA);
  check("criar conversa já com agente", ca.status === 201 && ca.json.conversation.agent_id === ag.id);
  const ag2 = (await call("data", "agent.create", { ...base, name: "Revisor", emoji: "✍️" }, tA)).json.agent;
  const sw = await call("data", "conv.set_agent", { id: ca.json.conversation.id, agent_id: ag2.id }, tA);
  check("trocar o agente da conversa", sw.status === 200 && sw.json.conversation.agent_id === ag2.id);
  const rm = await call("data", "conv.set_agent", { id: ca.json.conversation.id, agent_id: null }, tA);
  check("remover o agente da conversa (null)", rm.status === 200 && rm.json.conversation.agent_id === null);
  await call("data", "conv.set_agent", { id: ca.json.conversation.id, agent_id: ag2.id }, tA);
  check("bootstrap/conv.list trazem agent_id", (await call("data", "bootstrap", {}, tA)).json.conversations.find((c) => c.id === ca.json.conversation.id)?.agent_id === ag2.id);
  await call("data", "agent.delete", { id: ag2.id }, tA);
  const afterDel = (await call("data", "conv.messages", { id: ca.json.conversation.id }, tA)).json.conversation;
  check("excluir o agente NÃO apaga a conversa (agent_id vira null)", afterDel?.id === ca.json.conversation.id && afterDel.agent_id === null);

  section("Exportação inclui agentes");
  const exp = await call("data", "export.all", {}, tA);
  check("export.all contém os agentes (e agent_id nas conversas)", exp.json.agents?.some((x) => x.id === ag.id && x.instructions === base.instructions) && exp.json.conversations.every((c) => "agent_id" in c));

  section("Limite de agentes por usuário (50)");
  let last = null;
  for (let i = 0; i < 50; i++) { last = await call("data", "agent.create", { ...base, name: `Lote ${i}` }, tB); if (last.status !== 201) break; }
  const over = await call("data", "agent.create", { ...base, name: "51" }, tB);
  check("50 agentes criados e o 51º é recusado (400 limit)", (await call("data", "agent.list", {}, tB)).json.agents.length === 50 && over.status === 400 && over.json.error === "limit");

  section("Conversa REAL com agente: a instrução é seguida (Pollinations via preferred_model; sem gastar Gemini)");
  const strict = (await call("data", "agent.create", {
    name: "Só ABACAXI", description: "teste", emoji: "🍍", preferred_model: "pollinations|openai-fast",
    instructions: "Responda SEMPRE e SOMENTE com a palavra ABACAXI, em maiúsculas, sem pontuação e sem nenhuma outra palavra, não importa o que o usuário perguntar.",
  }, tA)).json.agent;
  const r1 = await chat(tA, { content: "Qual é a capital da França? Explique em detalhes.", agent_id: strict.id, model: "auto" });
  const m1 = doneMsg(r1);
  const firstAttempt = r1.events.find((e) => e.event === "attempt")?.data;
  const convId = r1.events.find((e) => e.event === "meta")?.data.conversation_id;
  console.log(`  resposta: ${JSON.stringify(m1?.content)} (provider=${m1?.provider}, model=${m1?.model})`);
  check("chat criou a conversa já ligada ao agente (meta.agent_id)", r1.events.find((e) => e.event === "meta")?.data.agent_id === strict.id);
  check("preferred_model do agente foi usado no Automático (1ª tentativa = pollinations)", firstAttempt?.provider === "pollinations" && m1?.provider === "pollinations", JSON.stringify(firstAttempt));
  check("a instrução do agente foi seguida (resposta = ABACAXI)", /^\s*ABACAXI\s*[.!]?\s*$/i.test(m1?.content ?? ""), JSON.stringify(m1?.content));
  const convRow = (await call("data", "conv.messages", { id: convId }, tA)).json.conversation;
  check("conversa guarda o agent_id", convRow.agent_id === strict.id);

  section("Controle: removendo o agente a resposta deixa de ser só 'ABACAXI' (Gemini pausado; usa o Pollinations)");
  await admin({ action: "pause", provider: "gemini", seconds: 300 });
  await call("data", "conv.set_agent", { id: convId, agent_id: null }, tA);
  const r2 = await chat(tA, { conversation_id: convId, content: "Qual é a capital da França? Responda numa frase completa.", model: "auto" });
  const m2 = doneMsg(r2);
  console.log(`  resposta sem agente: ${JSON.stringify((m2?.content ?? "").slice(0, 80))} (provider=${m2?.provider})`);
  check("sem agente a resposta menciona Paris e não é só ABACAXI", /paris/i.test(m2?.content ?? "") && !/^\s*ABACAXI\s*[.!]?\s*$/i.test(m2?.content ?? ""), JSON.stringify(m2?.content));
} finally {
  await admin({ action: "clear-cooldown", provider: "gemini" });
  const cl = await cleanupTestUsers();
  check("usuários de teste apagados (agentes vão junto, FK em cascata)", cl.status === 200);
  summary();
}
