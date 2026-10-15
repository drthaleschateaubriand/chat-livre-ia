import { getSecret } from "../db.ts";
import { ProviderManager } from "./manager.ts";
import { buildProviders, KEY_SECRET } from "./registry.ts";
import { DbStateStore } from "./store.ts";

let mgr: ProviderManager | null = null;
export function manager(): ProviderManager {
  if (!mgr) {
    mgr = new ProviderManager({
      providers: buildProviders(),
      store: new DbStateStore(),
      getKey: async (id) => (KEY_SECRET[id] ? await getSecret(KEY_SECRET[id]) : null),
    });
  }
  return mgr;
}
