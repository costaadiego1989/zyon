import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { assertNativePrismaUrl, inspectNativePrismaClient } from "./native-prisma-admission-guards.mjs";
import { assertLegacySyntheticIdentity, legacyPrismaSelection } from "./legacy-prisma-disposable-guards.mjs";
import { assertSyntheticRedisIdentity } from "./local-disposable-redis.mjs";

const [url, runId, name, redisUrl, redisRunId] = process.argv.slice(2);
assert.equal(process.argv.length, name === "auth-me" ? 7 : 5, "exact_worker_arguments_required");
const selection = legacyPrismaSelection(["--local-disposable", "--prisma-loopback-exec", `--suite=${name}`]);
assertNativePrismaUrl(url);
for (const key of ["DATABASE_URL", "DIRECT_URL", "REDIS_URL", "NODE_OPTIONS", "DOTENV_CONFIG_PATH", "PRISMA_QUERY_ENGINE_LIBRARY", "READY_PROD_TEST_PRISMA_CLIENT", "AACP_RUN_PRISMA_TESTS"]) {
  assert.equal(process.env[key], undefined, "clean_worker_environment_required");
}
inspectNativePrismaClient(fileURLToPath(new URL("../", import.meta.url)));
const { PrismaClient } = await import("@prisma/client");
const verifier = new PrismaClient({ datasources: { db: { url } }, log: [] });
try {
  const rows = await verifier.$queryRaw`SELECT current_database() AS database, run_id FROM synthetic_native_marker`;
  assertLegacySyntheticIdentity(url, runId, rows);
} finally {
  await verifier.$disconnect();
}
if (name === "auth-me") {
  // Validate syntax before opening a socket, then verify the live owned marker.
  assertSyntheticRedisIdentity(redisUrl, redisRunId, redisRunId);
  const { Redis } = await import("ioredis");
  const redis = new Redis(redisUrl, { lazyConnect: true, maxRetriesPerRequest: 0,
    retryStrategy: () => null, connectTimeout: 5000, commandTimeout: 5000 });
  try {
    await redis.connect();
    assertSyntheticRedisIdentity(redisUrl, redisRunId, await redis.get("aacp:synthetic:run"));
  } finally { redis.disconnect(); }
  process.env.REDIS_URL = redisUrl;
}
// Only after proving ownership, opt the exact legacy test into this process's DB.
// No dotenv, AppModule, provider configuration or arbitrary test-path input.
process.env.DATABASE_URL = url;
process.env.AACP_RUN_PRISMA_TESTS = "1";
await import(new URL(selection.spec, import.meta.url).href);
// One unref'ed diagnostic cannot keep the worker alive or turn a failed test
// green. Report resource kinds only, never connection strings or credentials.
if (name === "auth-me") {
  const diagnostics = setTimeout(() => console.error(JSON.stringify({
    suite: name, pendingResourceKinds: process.getActiveResourcesInfo(),
  })), 10_000);
  diagnostics.unref();
}
