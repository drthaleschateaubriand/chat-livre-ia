import { OpenAICompatProvider } from "./openai_compat.ts";
import { ModelInfo, Provider } from "./types.ts";

export const PROVIDER_IDS = ["groq", "gemini", "openrouter", "pollinations", "xai"] as const;

/** Mapa nome-do-segredo na tabela server_secrets para cada provedor com chave. */
export const KEY_SECRET: Record<string, string> = {
  groq: "KEY_GROQ",
  gemini: "KEY_GEMINI",
  openrouter: "KEY_OPENROUTER",
  xai: "KEY_XAI",
};

function label(id: string): string {
  return id.replace(/:free$/, "").split("/").pop()!.replace(/[-_]/g, " ");
}
function m(provider: string, id: string, rank: number, lbl?: string): ModelInfo {
  return { provider, id, rank, label: lbl ?? label(id) };
}

const groqStatic = [
  m("groq", "llama-3.3-70b-versatile", 10, "Llama 3.3 70B"),
  m("groq", "openai/gpt-oss-120b", 16, "GPT-OSS 120B"),
  m("groq", "llama-3.1-8b-instant", 40, "Llama 3.1 8B instantâneo"),
  m("groq", "openai/gpt-oss-20b", 42, "GPT-OSS 20B"),
];
const groqPreferred = new Map(groqStatic.map((x) => [x.id, x]));

// Gemini: catálogo conferido com chave real em 2026-10-15 (gemini-2.5-* e 2.0-flash retornam 404 "no longer available to new users").
// Ranks: Groq (10…) e Gemini ficam ANTES de OpenRouter e Pollinations (90) no Automático. 3.7/3.8 têm rank um pouco pior
// porque deram 503 "high demand" (transitório) nos testes; mesmo assim ficam como reserva.
const geminiStatic = [
  m("gemini", "gemini-3.5-flash", 12, "Gemini 3.5 Flash"),
  m("gemini", "gemini-3.5-flash-lite", 15, "Gemini 3.5 Flash-Lite"),
  m("gemini", "gemini-flash-lite-latest", 17, "Gemini Flash-Lite (latest)"),
];
const geminiPreferred = new Map<string, ModelInfo>([
  ...geminiStatic.map((x) => [x.id, x] as [string, ModelInfo]),
  ["gemini-3.8-flash", m("gemini", "gemini-3.8-flash", 19, "Gemini 3.8 Flash")],
  ["gemini-3.7-flash", m("gemini", "gemini-3.7-flash", 20, "Gemini 3.7 Flash")],
  ["gemini-flash-latest", m("gemini", "gemini-flash-latest", 21, "Gemini Flash (latest)")],
]);
/** Fora da lista de chat: imagem, voz (TTS), transcrição, música, robótica, computer-use, pesquisa profunda, agentes, omni, embeddings… */
export const GEMINI_NON_CHAT = /tts|image|transcribe|lyria|robotics|computer-use|deep-research|antigravity|omni|nano-banana|embedding|aqa|live|audio|customtools|imagen|veo/i;
/** Resposta de GET /v1beta/models: só modelos que suportam generateContent (nomes "models/<id>"). */
export function parseGeminiModels(j: unknown): string[] {
  const ms = (j as { models?: { name?: string; supportedGenerationMethods?: string[] }[] })?.models;
  if (!Array.isArray(ms)) return [];
  return ms
    .filter((x) => x?.name && Array.isArray(x.supportedGenerationMethods) && x.supportedGenerationMethods.includes("generateContent"))
    .map((x) => String(x.name).replace(/^models\//, ""));
}
export function geminiFromLive(ids0: string[], st: ModelInfo[]): ModelInfo[] {
  const ids = ids0.map((i) => i.replace(/^models\//, "")).filter((i) => !GEMINI_NON_CHAT.test(i));
  const hit = ids.filter((i) => geminiPreferred.has(i)).map((i) => geminiPreferred.get(i)!);
  if (hit.length) return hit;
  // nenhum preferido na lista ao vivo: usa o que houver de Flash de texto estável (sem preview/exp)
  const extra = ids.filter((i) => /^gemini-.*flash/.test(i) && !/preview|exp|thinking|8b/.test(i)).slice(0, 3);
  return extra.length ? extra.map((i, n) => m("gemini", i, 30 + n)) : st;
}

// xAI (Grok): SEM plano gratuito garantido; cobrança por token na conta de quem criou a chave.
// Nomes de modelos conforme https://docs.x.ai/docs/models (conferidos na documentação em 2026-10-15); este catálogo estático
// só vale até haver chave: com chave, a lista vem de GET https://api.x.ai/v1/models. Ranks altos = depois de todos os gratuitos.
const xaiStatic = [
  { ...m("xai", "grok-4.3", 200, "Grok 4.3 (pago, não verificado)"), unverified: true },
  { ...m("xai", "grok-4.7", 210, "Grok 4.7 (pago, não verificado)"), unverified: true },
  { ...m("xai", "grok-4.20-0309-non-reasoning", 220, "Grok 4.20 sem raciocínio (pago, não verificado)"), unverified: true },
];
const xaiPreferred = new Map<string, ModelInfo>([
  ["grok-4.3", m("xai", "grok-4.3", 200, "Grok 4.3 (pago)")],
  ["grok-4.7", m("xai", "grok-4.7", 210, "Grok 4.7 (pago)")],
  ["grok-4.20-0309-non-reasoning", m("xai", "grok-4.20-0309-non-reasoning", 220, "Grok 4.20 sem raciocínio (pago)")],
]);

/** xAI usa 403 (e às vezes 402) quando os créditos acabam ou o limite de gasto é atingido: tratamos como cota esgotada. */
export function classifyXai(status: number, body: string): "quota" | "auth" | null {
  if (status === 402) return "quota";
  if (status === 403) return /credit|spend|spending|balance|billing|limit|exhaust|quota|payment/i.test(body) ? "quota" : "auth";
  if (status === 401) return "auth";
  if (status === 400 && /api[ _-]?key|incorrect|invalid.*(key|token|credential)/i.test(body)) return "auth";
  return null;
}

export function buildProviders(fetchImpl?: typeof fetch, overrides: Partial<Record<string, string>> = {}): Provider[] {
  return [
    new OpenAICompatProvider({
      id: "groq",
      name: "Groq",
      keyUrl: "https://console.groq.com/keys",
      anonymous: false,
      note: "Plano grátis com limites por modelo (requisições e tokens por minuto/dia).",
      chatUrl: overrides.groq ?? "https://api.groq.com/openai/v1/chat/completions",
      modelsUrl: overrides.groq ? undefined : "https://api.groq.com/openai/v1/models",
      liveNeedsKey: true,
      staticModels: groqStatic,
      fetchImpl,
      fromLive: (ids, st) => {
        const hit = ids.filter((i) => groqPreferred.has(i)).map((i) => groqPreferred.get(i)!);
        if (hit.length) return hit;
        const extra = ids.filter((i) => !/whisper|tts|orpheus|guard|playai|compound|embed|safeguard/i.test(i)).slice(0, 4);
        return extra.length ? extra.map((i, n) => m("groq", i, 50 + n)) : st;
      },
    }),
    new OpenAICompatProvider({
      id: "gemini",
      name: "Google Gemini",
      keyUrl: "https://aistudio.google.com/apikey",
      anonymous: false,
      note: "Plano grátis do Google AI Studio, com limites por modelo e dados que podem ser usados para melhorar produtos do Google.",
      chatUrl: overrides.gemini ?? "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
      // listagem nativa (traz supportedGenerationMethods); chaves novas "AQ." só funcionam aqui com x-goog-api-key
      modelsUrl: overrides.gemini ? undefined : "https://generativelanguage.googleapis.com/v1beta/models?pageSize=200",
      modelsHeaders: (k) => ({ "x-goog-api-key": k }),
      parseModels: parseGeminiModels,
      liveNeedsKey: true,
      staticModels: geminiStatic,
      fetchImpl,
      fromLive: geminiFromLive,
    }),
    new OpenAICompatProvider({
      id: "openrouter",
      name: "OpenRouter (modelos :free)",
      keyUrl: "https://openrouter.ai/settings/keys",
      anonymous: false,
      note: "Somente modelos com sufixo :free; limites diários/por minuto menores, e variam por conta.",
      chatUrl: overrides.openrouter ?? "https://openrouter.ai/api/v1/chat/completions",
      modelsUrl: overrides.openrouter ? undefined : "https://openrouter.ai/api/v1/models",
      liveNeedsKey: false,
      extraHeaders: { "X-Title": "CHAT LIVRE IA", "HTTP-Referer": "https://drthaleschateaubriand.github.io/chat-livre-ia/" },
      staticModels: [m("openrouter", "google/gemma-4-31b-it:free", 22, "Gemma 4 31B (grátis)")],
      fetchImpl,
      fromLive: (ids, st) => {
        const free = ids.filter((i) => i.endsWith(":free") && !/safety|guard|embed|note-preview|lfm|lightning/i.test(i));
        const pref = [/gemma-4-31b/, /nemotron-3-super/, /nemotron-3-ultra/, /gemma-4-26b/, /laguna-s/, /inkling/];
        const score = (i: string) => { const k = pref.findIndex((r) => r.test(i)); return k < 0 ? 99 : k; };
        const sorted = [...free].sort((a, b) => score(a) - score(b));
        const out = sorted.slice(0, 5).map((i, n) => m("openrouter", i, 22 + n * 2));
        return out.length ? out : st;
      },
    }),
    new OpenAICompatProvider({
      id: "pollinations",
      name: "Pollinations (anônimo)",
      keyUrl: null,
      anonymous: true,
      note: "API oficial anônima, sem chave; sujeita a fila e limites por IP. Sempre disponível como último recurso.",
      chatUrl: overrides.pollinations ?? "https://text.pollinations.ai/openai",
      staticModels: [m("pollinations", "openai-fast", 90, "GPT-OSS 20B (Pollinations)")],
      fetchImpl,
    }),
    new OpenAICompatProvider({
      id: "xai",
      name: "xAI Grok (opcional, pago)",
      keyUrl: "https://console.x.ai",
      anonymous: false,
      paid: true,
      note: "OPCIONAL: requer chave xAI com créditos e PODE GERAR COBRANÇA na conta xAI do dono da chave (não há plano gratuito garantido; só créditos promocionais eventuais). Desligado por padrão: só ativa com chave gravada e só é usado ao escolher um modelo Grok ou ao permitir provedores com possível custo no Automático.",
      chatUrl: overrides.xai ?? "https://api.x.ai/v1/chat/completions",
      modelsUrl: overrides.xai ? undefined : "https://api.x.ai/v1/models",
      liveNeedsKey: true,
      maxTokensField: "max_completion_tokens",
      classify: classifyXai,
      staticModels: xaiStatic,
      fetchImpl,
      fromLive: (ids, st) => {
        const hit = ids.filter((i) => xaiPreferred.has(i)).map((i) => xaiPreferred.get(i)!);
        if (hit.length) return hit;
        const extra = ids.filter((i) => /^grok-/.test(i) && !/imagine|video|voice|image|multi-agent|build|embed|tts|stt|vision/i.test(i)).slice(0, 3);
        return extra.length ? extra.map((i, n) => m("xai", i, 230 + n, `${i} (pago)`)) : st;
      },
    }),
  ];
}
