import { initialLeaseMemory } from "./initial-lease-memory.fixture.js";

// Component protocol double only. Real Lua/CAS and SQL-timeout proof belong to
// the additive native child; these tests verify private arguments/receipts.
export function publicationClaimMemory() {
  const f = initialLeaseMemory(), connection = f.store.redis, original = connection.eval.bind(connection);
  const hooks = { beforeRelease: undefined as (() => Promise<void>) | undefined };
  Reflect.set(connection, "eval", async (script: string, keyCount: number, ...args: any[]) => {
    if (script.includes("local nowParts = redis.call('TIME')")) {
      const wanted = JSON.parse(args[keyCount]);
      if (f.state.held?.publicationClaim && wanted.publicationClaim) f.state.held.publicationClaim = wanted.publicationClaim;
    } else {
      if (hooks.beforeRelease) { const hook = hooks.beforeRelease; hooks.beforeRelease = undefined; await hook(); }
      const claim = args[keyCount + 5];
      if (claim && f.state.held?.publicationClaim !== claim) return "publication_adopted";
    }
    return original(script, keyCount, ...args);
  });
  return { ...f, hooks };
}
