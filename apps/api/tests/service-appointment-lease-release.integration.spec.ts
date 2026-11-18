import assert from "node:assert/strict";
import test from "node:test";
import { Redis } from "ioredis";
import { createServiceTestRedis } from "./service-test-redis.mjs";
import { assertServiceArtifacts } from "./service-test-artifacts.mjs";
import { SERVICE_LOCAL_TEST_MS } from "./service-test-startup.mjs";
import { RedisServiceSlots } from "../src/shared/bookings/redis-service-slots.js";
import { captureAppointmentLease } from "../src/shared/bookings/appointment-lease-proof.js";

test("T33 actual Redis original-generation subset release", { timeout: SERVICE_LOCAL_TEST_MS }, async t => {
  assertServiceArtifacts(); const owner = await createServiceTestRedis(); let redis: Redis | undefined;
  try {
    redis = new Redis(owner.url, { lazyConnect: true, maxRetriesPerRequest: 1, commandTimeout: 3000, connectTimeout: 3000, enableOfflineQueue: false });
    await redis.connect(); assert.equal(await redis.get("aacp:synthetic:run"), owner.runId);
    const store = new RedisServiceSlots(redis), date = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
    const a = { resourceId: "professional:a", slotId: "slot-a", startsAt: date + "T10:00:00.000Z", endsAt: date + "T10:20:00.000Z" };
    const b = { ...a, resourceId: "professional:b", slotId: "slot-b" };
    await t.test("only a new acquisition receives a new server generation; public lease shape stays unchanged", async () => {
      const first = await store.acquire("m-generation", "checkout", [a], 240_000), one = await store.assertActive("m-generation", "checkout", [a]);
      const repeat = await store.acquire("m-generation", "checkout", [a], 240_000), same = await store.assertActive("m-generation", "checkout", [a]);
      assert.deepEqual(Object.keys(first).sort(), ["expiresAt", "slots"]); assert.deepEqual(repeat, first);
      assert.match(one.generation ?? "", /^[a-f0-9-]{36}$/); assert.equal(same.generation, one.generation);
      await store.release("m-generation", "checkout"); await store.acquire("m-generation", "checkout", [a], 240_000);
      const newer = await store.assertActive("m-generation", "checkout", [a]); assert.notEqual(newer.generation, one.generation); assert.equal(newer.fingerprint, one.fingerprint);
    });
    await t.test("cancel target A preserves sibling B and does not renew expiration or delete another tenant", async () => {
      await store.acquire("m-subset", "checkout", [a, b], 240_000); await store.acquire("foreign", "checkout", [a, b], 240_000);
      const proof = await store.assertActive("m-subset", "checkout", [a, b]), capture = captureAppointmentLease("m-subset", "checkout", proof, a);
      const foreign = await store.assertActive("foreign", "checkout", [a, b]), ttl = await redis!.pttl(store.checkoutKey("m-subset", "checkout"));
      await store.releaseCaptured("m-subset", capture);
      const remaining = await store.assertActive("m-subset", "checkout", [b]); assert.equal(remaining.generation, proof.generation); assert.deepEqual(remaining.slots, [b]);
      assert.equal(remaining.expiresAt, proof.expiresAt); assert.ok(await redis!.pttl(store.checkoutKey("m-subset", "checkout")) <= ttl);
      assert.equal((await store.assertActive("foreign", "checkout", [a, b])).generation, foreign.generation);
      assert.equal(await redis!.hlen(store.resourceKey("m-subset", a.resourceId)), 0);
      const beforeReplay = await redis!.get(store.checkoutKey("m-subset", "checkout")); await store.releaseCaptured("m-subset", capture);
      assert.equal(await redis!.get(store.checkoutKey("m-subset", "checkout")), beforeReplay);
    });
    await t.test("a live parent cannot certify an index from a different generation with the same fingerprint", async () => {
      await store.acquire("m-index-generation", "checkout", [a], 240_000);
      const parent = await redis!.get(store.checkoutKey("m-index-generation", "checkout")), held = JSON.parse(parent!);
      const resource = store.resourceKey("m-index-generation", a.resourceId);
      const otherGeneration = JSON.stringify({ ...held, generation: "00000000-0000-4000-8000-000000000099" });
      await redis!.hset(resource, held.owner, otherGeneration);
      await assert.rejects(store.acquire("m-index-generation", "checkout", [a], 240_000), /service_slot_unavailable/);
      assert.equal(await redis!.get(store.checkoutKey("m-index-generation", "checkout")), parent);
      assert.equal(await redis!.hget(resource, held.owner), otherGeneration);
    });
    await t.test("a delayed old cleanup never deletes a newer lease with the same owner and fingerprint", async () => {
      await store.acquire("m-aba", "checkout", [a], 240_000); const one = await store.assertActive("m-aba", "checkout", [a]);
      const old = captureAppointmentLease("m-aba", "checkout", one, a); await store.release("m-aba", "checkout");
      await store.acquire("m-aba", "checkout", [a], 240_000); const two = await store.assertActive("m-aba", "checkout", [a]);
      assert.notEqual(one.generation, two.generation); assert.equal(one.fingerprint, two.fingerprint);
      const before = await redis!.get(store.checkoutKey("m-aba", "checkout")); await store.releaseCaptured("m-aba", old);
      assert.equal(await redis!.get(store.checkoutKey("m-aba", "checkout")), before); assert.equal((await store.assertActive("m-aba", "checkout", [a])).generation, two.generation);
    });
    await t.test("two slots on the same professional keep the sibling resource entry after target cancellation", async () => {
      const later = { ...a, slotId: "later-slot", startsAt: date + "T11:00:00.000Z", endsAt: date + "T11:20:00.000Z" };
      await store.acquire("m-same-resource", "checkout", [a, later], 240_000);
      const proof = await store.assertActive("m-same-resource", "checkout", [a, later]);
      await store.releaseCaptured("m-same-resource", captureAppointmentLease("m-same-resource", "checkout", proof, a));
      const remaining = await store.assertActive("m-same-resource", "checkout", [later]);
      assert.deepEqual(remaining.slots, [later]); assert.equal(remaining.generation, proof.generation);
      assert.equal(await redis!.hlen(store.resourceKey("m-same-resource", a.resourceId)), 1);
    });
    await t.test("old resource indexes are cleaned by their own generation without overwriting a newer parent", async () => {
      await store.acquire("m-orphan", "checkout", [a, b], 240_000); const one = await store.assertActive("m-orphan", "checkout", [a, b]);
      const old = captureAppointmentLease("m-orphan", "checkout", one, a), parent = store.checkoutKey("m-orphan", "checkout");
      const raw = JSON.parse((await redis!.get(parent))!); raw.expiresAt = 0;
      await redis!.set(parent, JSON.stringify(raw)); for (const slot of [a, b]) await redis!.hset(store.resourceKey("m-orphan", slot.resourceId), raw.owner, JSON.stringify(raw));
      const c = { ...a, resourceId: "professional:new", slotId: "new-slot" }; await store.acquire("m-orphan", "checkout", [c], 240_000);
      const newer = await redis!.get(parent), newResource = await redis!.hget(store.resourceKey("m-orphan", c.resourceId), raw.owner);
      await store.releaseCaptured("m-orphan", old);
      assert.equal(await redis!.get(parent), newer); assert.equal(await redis!.hget(store.resourceKey("m-orphan", c.resourceId), raw.owner), newResource);
      assert.equal(await redis!.hget(store.resourceKey("m-orphan", a.resourceId), raw.owner), null);
      const remaining = JSON.parse((await redis!.hget(store.resourceKey("m-orphan", b.resourceId), raw.owner))!);
      assert.equal(remaining.generation, one.generation); assert.deepEqual(remaining.slots.map((slot: any) => slot.slotId), ["slot-b"]);
    });
    await t.test("a foreign proof cannot select another merchant's Redis key space", async () => {
      await store.acquire("m-scope", "checkout", [a], 240_000); const proof = await store.assertActive("m-scope", "checkout", [a]);
      const capture = captureAppointmentLease("m-scope", "checkout", proof, a), before = await redis!.get(store.checkoutKey("m-scope", "checkout"));
      await assert.rejects(store.releaseCaptured("foreign", capture), /service_hold_cleanup_foreign_proof/);
      assert.equal(await redis!.get(store.checkoutKey("m-scope", "checkout")), before);
    });
  } finally { redis?.disconnect(); await owner.dispose(); }
});
