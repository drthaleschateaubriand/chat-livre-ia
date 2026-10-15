// Interface Provider: para adicionar um novo provedor basta implementar esta interface e registrá-lo em registry.ts.

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ModelInfo {
  provider: string;
  id: string;
  label: string;
  /** menor = preferido no modo Automático */
  rank: number;
  /** true = veio de catálogo estático (não conferido na listagem oficial da API com chave) */
  unverified?: boolean;
}

export type StreamPart =
  | { type: "delta"; text: string }
  | { type: "activity" } // o provedor está vivo (ex.: tokens de raciocínio descartados)
  | { type: "usage"; tin?: number; tout?: number }
  | { type: "headers"; info: Record<string, string> };

export type ErrorKind = "rate_limit" | "auth" | "bad_model" | "too_large" | "quota" | "server" | "empty" | "timeout" | "network" | "aborted";

export class ProviderError extends Error {
  constructor(
    public kind: ErrorKind,
    message: string,
    public status: number | null = null,
    public retryAfterS: number | null = null,
    public headers: Record<string, string> = {},
  ) {
    super(message);
  }
}

export interface StreamOptions {
  signal?: AbortSignal;
  /** tempo máximo até o primeiro byte/atividade */
  firstByteTimeoutMs: number;
  /** tempo máximo de silêncio entre eventos */
  idleTimeoutMs: number;
  maxTokens?: number;
}

export interface Provider {
  id: string;
  name: string;
  /** página oficial onde se obtém a chave grátis (ou null se anônimo) */
  keyUrl: string | null;
  anonymous: boolean;
  note: string;
  /** true = pode gerar cobrança na conta do dono da chave (não entra no Automático sem permissão explícita) */
  paid?: boolean;
  /** configurado = pode ser chamado agora (anônimo: sempre; com chave: se houver chave) */
  configured(key: string | null): boolean;
  /** lista modelos elegíveis (usa API oficial quando possível; cai para catálogo estático) */
  listModels(key: string | null): Promise<ModelInfo[]>;
  stream(model: string, messages: ChatMessage[], key: string | null, opts: StreamOptions): AsyncGenerator<StreamPart>;
}
