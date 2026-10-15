import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2";

let client: SupabaseClient | null = null;
export function db(): SupabaseClient {
  if (!client) {
    client = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return client;
}

// Segredos: primeiro Deno.env (se um dia houver secret nativo), depois a tabela privada server_secrets.
const cache = new Map<string, { v: string | null; t: number }>();
const TTL = 30_000;

export async function getSecret(name: string): Promise<string | null> {
  const env = Deno.env.get(name);
  if (env) return env;
  const c = cache.get(name);
  if (c && Date.now() - c.t < TTL) return c.v;
  const { data, error } = await db().from("server_secrets").select("value").eq("name", name).maybeSingle();
  if (error) throw new Error("secret_lookup_failed");
  const v = data?.value ?? null;
  cache.set(name, { v, t: Date.now() });
  return v;
}

export function invalidateSecret(name: string) {
  cache.delete(name);
}

export async function requireSecret(name: string): Promise<string> {
  const v = await getSecret(name);
  if (!v) throw new Error(`missing_secret_${name}`);
  return v;
}
