import { db } from "../db.ts";
import { FailureInfo, StateStore } from "./manager.ts";

/** Persistência do circuit breaker e do consumo (Postgres, via service role). */
export class DbStateStore implements StateStore {
  async cooldowns(): Promise<Record<string, number>> {
    const { data, error } = await db().from("provider_state").select("provider,model,cooldown_until").gt("cooldown_until", new Date().toISOString());
    if (error) throw new Error("state_read_failed");
    const out: Record<string, number> = {};
    for (const r of data ?? []) out[`${r.provider}|${r.model}`] = new Date(r.cooldown_until).getTime();
    return out;
  }

  async success(provider: string, model: string, info: { tin: number; tout: number; limitInfo?: Record<string, string>; cooldownUntil?: number }) {
    await db().rpc("usage_add", { p_provider: provider, p_model: model, p_req: 1, p_tin: info.tin, p_tout: info.tout, p_err: 0, p_limited: 0, p_info: info.limitInfo ?? null });
    await db().from("provider_state").upsert({
      provider, model, consecutive_failures: 0, last_status: 200, last_error: null,
      cooldown_until: info.cooldownUntil ? new Date(info.cooldownUntil).toISOString() : null, updated_at: new Date().toISOString(),
    });
  }

  async failure(provider: string, model: string, f: FailureInfo) {
    const key = f.scope === "provider" ? "*" : model;
    const { data } = await db().from("provider_state").select("consecutive_failures").eq("provider", provider).eq("model", key).maybeSingle();
    const n = (data?.consecutive_failures ?? 0) + 1;
    const ms = f.explicit ? f.cooldownMs : Math.min(f.cooldownMs * 2 ** Math.min(n - 1, 5), 10 * 60_000);
    await db().from("provider_state").upsert({
      provider, model: key, consecutive_failures: n, last_status: f.status, last_error: f.message,
      cooldown_until: new Date(Date.now() + ms).toISOString(), updated_at: new Date().toISOString(),
    });
    await db().rpc("usage_add", { p_provider: provider, p_model: model, p_req: 1, p_tin: 0, p_tout: 0, p_err: 1, p_limited: f.kind === "rate_limit" ? 1 : 0, p_info: null });
  }
}
