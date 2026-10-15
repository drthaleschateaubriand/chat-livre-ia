// Gestão da conta única do dono (app privado). Usado SOMENTE pela função admin-set-key (protegida por ADMIN_TOKEN).
import { db, requireSecret } from "./db.ts";
import { generateCode } from "./code.ts";
import { hmacHex } from "./crypto.ts";
import { HttpError } from "./http.ts";

/** Cria um usuário com um código novo de 19 dígitos. Devolve o código (única vez em que existe em texto puro). */
export async function createUser(opts: { owner?: boolean; test?: boolean }): Promise<{ userId: string; code: string }> {
  const pepper = await requireSecret("PEPPER");
  for (let i = 0; i < 5; i++) {
    const code = generateCode();
    const { data, error } = await db().from("users").insert({
      code_lookup: await hmacHex(pepper, "lookup:" + code),
      code_verify: await hmacHex(pepper, "verify:" + code),
      is_owner: !!opts.owner,
      is_test: !!opts.test,
    }).select("id").single();
    if (!error) {
      const { error: e2 } = await db().from("preferences").insert({ user_id: data.id });
      if (e2) { await db().from("users").delete().eq("id", data.id); throw new Error("prefs_create_failed"); }
      return { userId: data.id as string, code };
    }
    if (error.code === "23505") {
      // índice único do dono: já existe um dono (corrida) ou colisão do lookup (improvável): distingue pelo dono
      if (opts.owner && /single_owner/.test(error.message ?? "")) throw new HttpError(409, "owner_exists", "Já existe um dono.");
      continue;
    }
    throw new Error("user_create_failed");
  }
  throw new Error("user_create_failed");
}

/** Gera um código novo para o MESMO usuário (atualiza os hashes, mantém todos os dados) e revoga todas as sessões. */
export async function rotateCode(userId: string): Promise<string> {
  const pepper = await requireSecret("PEPPER");
  for (let i = 0; i < 5; i++) {
    const code = generateCode();
    const { data, error } = await db().from("users").update({
      code_lookup: await hmacHex(pepper, "lookup:" + code),
      code_verify: await hmacHex(pepper, "verify:" + code),
    }).eq("id", userId).select("id");
    if (!error) {
      if (!data?.length) throw new HttpError(404, "not_found", "Usuário não encontrado.");
      await db().from("sessions").update({ revoked_at: new Date().toISOString() }).eq("user_id", userId).is("revoked_at", null);
      return code;
    }
    if (error.code !== "23505") throw new Error("code_rotate_failed");
  }
  throw new Error("code_rotate_failed");
}

/** Criptografa o texto com uma chave pública RSA (PEM SPKI), RSA-OAEP/SHA-256. Retorna base64. */
export async function encryptFor(publicKeyPem: string, text: string): Promise<string> {
  const b64 = publicKeyPem.replace(/-----(BEGIN|END) PUBLIC KEY-----/g, "").replace(/\s+/g, "");
  if (!b64 || b64.length > 2000 || !/^[A-Za-z0-9+/=]+$/.test(b64)) throw new HttpError(400, "bad_request", "Chave pública inválida (use PEM SPKI RSA).");
  let key: CryptoKey;
  try {
    const der = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    key = await crypto.subtle.importKey("spki", der, { name: "RSA-OAEP", hash: "SHA-256" }, false, ["encrypt"]);
  } catch {
    throw new HttpError(400, "bad_request", "Chave pública inválida (use PEM SPKI RSA de 2048+ bits).");
  }
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "RSA-OAEP" }, key, new TextEncoder().encode(text)));
  let s = "";
  for (const b of ct) s += String.fromCharCode(b);
  return btoa(s);
}
