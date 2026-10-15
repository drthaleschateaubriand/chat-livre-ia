// Validação dos AGENTES (personas com instruções salvas). Módulo puro (sem Deno/Supabase) para poder ser testado com vitest.
export const AGENT_LIMITS = { name: 60, description: 200, instructions: 4000, emoji: 8, perUser: 50 } as const;
export const MODEL_PREF_RE = /^(auto|[a-z]{3,20}\|[A-Za-z0-9._:\/\-]{1,100})$/;

export class AgentValidationError extends Error {}

export interface AgentInput {
  name: string;
  description: string;
  instructions: string;
  emoji: string | null;
  preferred_model: string;
}

function text(v: unknown, field: string, max: number, required: boolean): string {
  if (v === undefined || v === null) {
    if (required) throw new AgentValidationError(`Campo obrigatório: ${field}.`);
    return "";
  }
  if (typeof v !== "string") throw new AgentValidationError(`Campo inválido: ${field}.`);
  // remove caracteres de controle (exceto quebra de linha e tab) e normaliza finais de linha
  const t = v.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").trim();
  if (required && !t) throw new AgentValidationError(`Preencha ${field}.`);
  if (t.length > max) throw new AgentValidationError(`${field} passa do limite de ${max} caracteres.`);
  return t;
}

/** Valida e normaliza o corpo de agent.create/agent.update. */
export function validateAgentInput(b: Record<string, unknown>): AgentInput {
  const name = text(b.name, "o nome", AGENT_LIMITS.name, true);
  const description = text(b.description, "a descrição", AGENT_LIMITS.description, false).replace(/\s+/g, " ");
  const instructions = text(b.instructions, "as instruções", AGENT_LIMITS.instructions, true);
  const emojiRaw = text(b.emoji, "o emoji", 32, false);
  if ([...emojiRaw].length > 4 || emojiRaw.length > AGENT_LIMITS.emoji) throw new AgentValidationError("Emoji/ícone: use no máximo 1 a 4 símbolos.");
  const pm = b.preferred_model === undefined || b.preferred_model === null || b.preferred_model === "" ? "auto" : b.preferred_model;
  if (typeof pm !== "string" || !MODEL_PREF_RE.test(pm)) throw new AgentValidationError("Modelo preferido inválido.");
  return { name: name.replace(/\s+/g, " "), description, instructions, emoji: emojiRaw || null, preferred_model: pm };
}
