import { corsHeaders, originBlocked } from "./cors.ts";

export class HttpError extends Error {
  constructor(public status: number, public code: string, message: string, public extra: Record<string, unknown> = {}, public headers: Record<string, string> = {}) {
    super(message);
  }
}

export function json(req: Request, body: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(req), "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...extra },
  });
}

export async function readJson(req: Request, maxBytes = 200_000): Promise<Record<string, unknown>> {
  const text = await req.text();
  if (text.length > maxBytes) throw new HttpError(413, "too_large", "Requisição muito grande.");
  if (!text) return {};
  try {
    const v = JSON.parse(text);
    if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
  } catch { /* cai no erro */ }
  throw new HttpError(400, "bad_json", "JSON inválido.");
}

export function str(v: unknown, max = 10_000): string {
  if (typeof v !== "string") throw new HttpError(400, "bad_request", "Parâmetro inválido.");
  if (v.length > max) throw new HttpError(400, "bad_request", "Texto longo demais.");
  return v;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function uuid(v: unknown): string {
  if (typeof v !== "string" || !UUID.test(v)) throw new HttpError(400, "bad_request", "Identificador inválido.");
  return v.toLowerCase();
}

/** Envolve um handler: CORS, preflight, bloqueio de origem, erros genéricos. */
export function serve(handler: (req: Request, path: string) => Promise<Response>) {
  Deno.serve(async (req) => {
    if (req.method === "OPTIONS") {
      if (originBlocked(req)) return new Response(null, { status: 403 });
      return new Response(null, { status: 204, headers: corsHeaders(req) });
    }
    if (originBlocked(req)) return new Response(JSON.stringify({ error: "origin_not_allowed" }), { status: 403, headers: { "Content-Type": "application/json" } });
    if (req.method !== "POST") return json(req, { error: "method_not_allowed" }, 405);
    try {
      const path = new URL(req.url).pathname.replace(/\/+$/, "").split("/").pop() ?? "";
      return await handler(req, path);
    } catch (e) {
      if (e instanceof HttpError) {
        return json(req, { error: e.code, message: e.message, ...e.extra }, e.status, e.headers);
      }
      console.error("erro interno:", e instanceof Error ? e.message : String(e));
      return json(req, { error: "internal", message: "Erro interno. Tente novamente em instantes." }, 500);
    }
  });
}

export function clientIp(req: Request): string {
  return req.headers.get("cf-connecting-ip") ?? req.headers.get("x-real-ip") ??
    (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() ?? "unknown";
}
