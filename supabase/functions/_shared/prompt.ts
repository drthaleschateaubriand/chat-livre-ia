// Montagem do prompt de sistema do chat. Módulo puro (testável com vitest).
// As instruções de um AGENTE são apenas texto do prompt: não alteram limites, escolha de provedor nem qualquer regra do servidor.

export const LANG_NAMES: Record<string, string> = { "pt-BR": "português do Brasil", "en-US": "inglês", "es-ES": "espanhol" };

export interface AgentPrompt { name: string; instructions: string }

export function baseInstruction(lang: string): string {
  return `Você é o CHAT LIVRE IA, um assistente prestativo e honesto. Responda por padrão em ${LANG_NAMES[lang] ?? "português do Brasil"}, a menos que o usuário peça outro idioma. Use Markdown quando ajudar (listas, tabelas, blocos de código com a linguagem indicada). Se não souber algo, diga com clareza em vez de inventar.`;
}

/** Ordem: instrução base → AGENTE → memórias → resumo. */
export function buildSystemPrompt(lang: string, memories: string[], summary: string | null, agent?: AgentPrompt | null): string {
  let s = baseInstruction(lang);
  if (agent && agent.instructions.trim()) {
    s += `\n\nAgente ativo nesta conversa: "${agent.name.replace(/"/g, "'")}". As instruções abaixo foram configuradas pelo dono da conta para esta conversa e DEVEM ser seguidas à risca quanto a papel, tom, idioma, formato e tamanho das respostas, inclusive quando mudam o estilo padrão descrito acima (têm prioridade sobre o estilo padrão, mas nunca sobre limites técnicos ou regras de segurança do sistema, que são aplicados fora do prompt).\n<instrucoes_do_agente>\n${agent.instructions.trim()}\n</instrucoes_do_agente>`;
  }
  if (memories.length) s += `\n\nMemórias fornecidas pelo usuário (use apenas quando relevante):\n${memories.map((m) => `- ${m}`).join("\n")}`;
  if (summary) s += `\n\nResumo do início desta conversa (contexto anterior, já resumido):\n${summary}`;
  return s;
}

/**
 * Modelo a usar. O agente só influencia quando a conversa está em Automático e o agente tem um modelo preferido.
 * Provedor PAGO só é usado se o usuário permitiu pagos (allowPaid): o agente nunca contorna essa permissão.
 */
export function resolveModelPref(userPref: string | null | undefined, agentPref: string | null | undefined, isPaid: (providerId: string) => boolean, allowPaid: boolean): string {
  const base = userPref && userPref !== "" ? userPref : "auto";
  if (base !== "auto") return base;
  if (!agentPref || agentPref === "auto") return "auto";
  const provider = agentPref.split("|")[0];
  if (isPaid(provider) && !allowPaid) return "auto";
  return agentPref;
}
