// CORS restrito: nada de "*". Origens permitidas fixas.
export const ALLOWED_ORIGINS = [
  "https://drthaleschateaubriand.github.io",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://localhost:4173",
  "http://127.0.0.1:4173",
];

export function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("origin");
  const h: Record<string, string> = {
    "Vary": "Origin",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info",
    "Access-Control-Max-Age": "86400",
  };
  if (origin && ALLOWED_ORIGINS.includes(origin)) h["Access-Control-Allow-Origin"] = origin;
  return h;
}

/** true se a origem existe e NÃO é permitida (navegadores de outros sites). */
export function originBlocked(req: Request): boolean {
  const origin = req.headers.get("origin");
  return !!origin && !ALLOWED_ORIGINS.includes(origin);
}
