import { OpenAICompatProvider } from "./openai_compat.ts";
import { ModelInfo, Provider } from "./types.ts";

export const PROVIDER_IDS = ["groq", "gemini", "openrouter", "pollinations"] as const;

/** Mapa nome-do-segredo na tabela server_secrets para cada provedor com chave. */
export const KEY_SECRET: Record<string, string> = {
  groq: "KEY_GROQ",
  gemini: "KEY_GEMINI",
  openrouter: "KEY_OPENROUTER",
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

const geminiStatic = [
  m("gemini", "gemini-2.5-flash", 12, "Gemini 2.5 Flash"),
  m("gemini", "gemini-2.0-flash", 14, "Gemini 2.0 Flash"),
  m("gemini", "gemini-2.5-flash-lite", 30, "Gemini 2.5 Flash-Lite"),
];
const geminiPreferred = new Map(geminiStatic.map((x) => [x.id, x]));

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
      modelsUrl: overrides.gemini ? undefined : "https://generativelanguage.googleapis.com/v1beta/openai/models",
      liveNeedsKey: true,
      staticModels: geminiStatic,
      fetchImpl,
      fromLive: (ids0, st) => {
        const ids = ids0.map((i) => i.replace(/^models\//, ""));
        const hit = ids.filter((i) => geminiPreferred.has(i)).map((i) => geminiPreferred.get(i)!);
        if (hit.length) return hit;
        const extra = ids.filter((i) => /^gemini-.*flash/.test(i) && !/preview|exp|image|tts|live|audio|embedding|thinking|8b/.test(i)).slice(0, 3);
        return extra.length ? extra.map((i, n) => m("gemini", i, 35 + n)) : st;
      },
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
  ];
}
