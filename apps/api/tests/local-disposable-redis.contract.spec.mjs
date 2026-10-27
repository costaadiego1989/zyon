import assert from "node:assert/strict";
import test from "node:test";
import { assertOwnedRedisContainer, assertSyntheticRedisIdentity } from "./local-disposable-redis.mjs";
import { legacyPrismaSelection, legacyPrismaTestEnvironment } from "./legacy-prisma-disposable-guards.mjs";

const runId = "12345678-1234-1234-1234-123456789abc";
const id = "a".repeat(64);
const info = {
  Id: id, Name: `/aacp-auth-redis-${runId}`,
  Config: { Labels: { "com.zyon.auth-redis-test": runId } },
  HostConfig: { NetworkMode: "none", ReadonlyRootfs: true, PortBindings: {} },
  Mounts: [{ Type: "tmpfs" }],
};

test("only the fixed auth-me suite is admitted with the synthetic auth fixture", () => {
  const selected = legacyPrismaSelection(["--local-disposable", "--prisma-loopback-exec", "--suite=auth-me"]);
  assert.equal(selected.spec, "../src/modules/auth/presentation/auth-me.prisma-e2e-spec.ts");
  assert.equal(selected.fixture, "./fixtures/legacy-prisma/auth.sql");
  assert.equal(legacyPrismaTestEnvironment({ REDIS_URL: "redis://external", NODE_OPTIONS: "external" }).REDIS_URL, undefined);
});

test("Redis ownership requires exact ID, name, label and isolated storage/network", () => {
  assert.doesNotThrow(() => assertOwnedRedisContainer(info, id, runId));
  for (const invalid of [
    { ...info, Id: "b".repeat(64) }, { ...info, Name: "/foreign" },
    { ...info, Config: { Labels: { "com.zyon.auth-redis-test": "foreign" } } },
    { ...info, HostConfig: { ...info.HostConfig, NetworkMode: "bridge" } },
    { ...info, HostConfig: { ...info.HostConfig, ReadonlyRootfs: false } },
    { ...info, HostConfig: { ...info.HostConfig, PortBindings: { "6379/tcp": [{}] } } },
    { ...info, Mounts: [{ Type: "volume" }] },
  ]) assert.throws(() => assertOwnedRedisContainer(invalid, id, runId));
  assert.throws(() => assertOwnedRedisContainer(info, "a", runId));
});

const url = "redis://127.0.0.1:54321/0";
test("Redis admission requires exact loopback URL and persisted run marker", () => {
  assert.doesNotThrow(() => assertSyntheticRedisIdentity(url, runId, runId));
  for (const invalid of ["redis://localhost:54321/0", "redis://external:54321/0",
    "redis://127.0.0.1:6379/0", "redis://127.0.0.1:54321/1", url + "?x=1", url + "#x",
    "redis://user:pass@127.0.0.1:54321/0", "rediss://127.0.0.1:54321/0"])
    assert.throws(() => assertSyntheticRedisIdentity(invalid, runId, runId));
  for (const marker of [null, "", "foreign"]) assert.throws(() => assertSyntheticRedisIdentity(url, runId, marker));
  assert.throws(() => assertSyntheticRedisIdentity(url, "foreign", "foreign"));
});
