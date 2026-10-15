// Lógica PURA do código numérico de acesso (sem dependências de Deno/DOM). Usada pelo servidor e pelo frontend.

export const CODE_LENGTH = 19;
export const CODE_MIN = 18;
export const CODE_MAX = 20;

/** Remove espaços, hífens e pontos de formatação. Não remove outros caracteres (serão rejeitados). */
export function normalizeCode(input: string): string {
  return String(input ?? "").replace(/[\s\u00a0\-\u2010-\u2015.]/g, "");
}

function digitsOf(code: string): number[] {
  return Array.from(code, (c) => c.charCodeAt(0) - 48);
}

/** Verdadeiro se o código é previsível (repetido, sequência, padrão curto repetido, poucos dígitos distintos). */
export function isPredictable(code: string): boolean {
  const d = digitsOf(code);
  const n = d.length;
  if (n === 0) return true;
  // poucos dígitos distintos
  if (new Set(d).size <= 3) return true;
  // progressão aritmética módulo 10 em todo o código (inclui 1111…, 0123…, 9876…, 1357…)
  const step = (d[1] - d[0] + 10) % 10;
  let arithmetic = true;
  for (let i = 1; i < n; i++) {
    if ((d[i] - d[i - 1] + 10) % 10 !== step) {
      arithmetic = false;
      break;
    }
  }
  if (arithmetic) return true;
  // padrão curto repetido (período 1..6) em todo o código
  for (let p = 1; p <= 6; p++) {
    let periodic = true;
    for (let i = p; i < n; i++) {
      if (d[i] !== d[i - p]) {
        periodic = false;
        break;
      }
    }
    if (periodic) return true;
  }
  // sequência longa (≥ 7) de mesmo dígito ou passo ±1
  let run = 1;
  let prevStep: number | null = null;
  for (let i = 1; i < n; i++) {
    const s = (d[i] - d[i - 1] + 10) % 10;
    if ((s === 0 || s === 1 || s === 9) && s === prevStep) run++;
    else run = (s === 0 || s === 1 || s === 9) ? 2 : 1;
    prevStep = s;
    if (run >= 7) return true;
  }
  return false;
}

export type CodeCheck =
  | { ok: true; code: string }
  | { ok: false; reason: "empty" | "non_digit" | "length" | "predictable"; message: string };

/** Normaliza e valida: somente dígitos, 18–20 dígitos, não previsível. */
export function validateCode(input: string): CodeCheck {
  const code = normalizeCode(input);
  if (code.length === 0) return { ok: false, reason: "empty", message: "Digite seu código numérico." };
  if (!/^[0-9]+$/.test(code)) return { ok: false, reason: "non_digit", message: "O código contém apenas números." };
  if (code.length < CODE_MIN || code.length > CODE_MAX) {
    return { ok: false, reason: "length", message: `O código tem ${CODE_LENGTH} dígitos (aceitamos de ${CODE_MIN} a ${CODE_MAX}).` };
  }
  if (isPredictable(code)) {
    return { ok: false, reason: "predictable", message: "Esse código não é válido (sequência previsível ou repetida)." };
  }
  return { ok: true, code };
}

/** Agrupa visualmente: 1234 5678 9012 3456 789 */
export function formatCode(code: string): string {
  return normalizeCode(code).replace(/(\d{4})(?=\d)/g, "$1 ");
}

/**
 * Gera dígito uniforme sem viés de módulo (rejection sampling) a partir de bytes aleatórios.
 * 250 = 10 * 25: bytes >= 250 são descartados.
 */
export function digitsFromRandom(count: number, rand: (n: number) => Uint8Array): string {
  let out = "";
  while (out.length < count) {
    const buf = rand(Math.max(32, (count - out.length) * 2));
    for (let i = 0; i < buf.length && out.length < count; i++) {
      if (buf[i] < 250) out += String(buf[i] % 10);
    }
  }
  return out;
}

/** Gera um código de 19 dígitos criptograficamente seguro e não previsível. */
export function generateCode(rand?: (n: number) => Uint8Array): string {
  const r = rand ?? ((n: number) => crypto.getRandomValues(new Uint8Array(n)));
  for (let i = 0; i < 100; i++) {
    const code = digitsFromRandom(CODE_LENGTH, r);
    if (!isPredictable(code)) return code;
  }
  throw new Error("não foi possível gerar código");
}
