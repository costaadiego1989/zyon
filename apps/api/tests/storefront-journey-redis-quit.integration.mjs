import assert from "node:assert/strict";
import { Redis } from "ioredis";
import { createDisposableRedis, assertSyntheticRedisIdentity } from "./local-disposable-redis.mjs";
import { journeyBounded, journeyRedisDiagnostic } from "./storefront-journey-owned-clients.mjs";

// Isolates transport shutdown from Nest/BullMQ. This is not an application
// shutdown or commerce validation, and never reads ambient application config.
assert.deepEqual(process.argv.slice(2), ["--local-disposable", "--no-real-provider"]);
let owned, client, failure;
try {
  owned = await createDisposableRedis();
  client = new Redis(owned.url, { lazyConnect: true, enableOfflineQueue: false,
    maxRetriesPerRequest: 0, retryStrategy: () => null, connectTimeout: 5000 });
  await client.connect();
  assertSyntheticRedisIdentity(owned.url, owned.runId, await client.get("aacp:synthetic:run"));
  assert.equal(await client.ping(), "PONG");
  assert.equal(await journeyBounded(client.quit(), 5000, "journey_isolated_quit_timeout"), "OK");
  console.log(JSON.stringify({ phase: "isolated-owned-redis-quit", quitAcknowledged: true, providerCalls: 0 }));
} catch (error) {
  failure = error;
  console.log(JSON.stringify({ phase: "isolated-owned-redis-quit", failed: true,
    code: error?.message === "journey_isolated_quit_timeout" ? error.message : "isolated_quit_failed",
    ...(client ? { client: journeyRedisDiagnostic("isolated-owned-client", client) } : {}) }));
} finally {
  // The resource owner closes only its own bridge sockets/children and exact
  // labelled container; no arbitrary Redis/application client is disconnected.
  try { if (owned) { await owned.dispose(); assert.deepEqual(owned.bridgeStatus(), { listening: false, sockets: 0, children: 0 }); } }
  catch (error) { failure = new AggregateError([...(failure ? [failure] : []), error], "isolated_quit_cleanup_failed"); }
}
if (failure) throw failure;
