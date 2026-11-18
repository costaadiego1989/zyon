import assert from "node:assert/strict";
import test from "node:test";
import { Redis } from "ioredis";
import { createServiceTestRedis } from "./service-test-redis.mjs";
import { assertServiceArtifacts } from "./service-test-artifacts.mjs";
import { SERVICE_LOCAL_TEST_MS } from "./service-test-startup.mjs";
import { RedisServiceSlots, originalSlotLeaseProof } from "../src/shared/bookings/redis-service-slots.js";
import { captureAppointmentLease } from "../src/shared/bookings/appointment-lease-proof.js";

test("T34 actual destination acquisition preserves original owned generation and sibling", { timeout: SERVICE_LOCAL_TEST_MS }, async t => {
  assertServiceArtifacts(); const owned = await createServiceTestRedis(); let redis: Redis | undefined;
  try {
    redis = new Redis(owned.url, { lazyConnect: true, maxRetriesPerRequest: 1, commandTimeout: 3000, connectTimeout: 3000, enableOfflineQueue: false });
    await redis.connect(); assert.equal(await redis.get("aacp:synthetic:run"), owned.runId);
    const store = new RedisServiceSlots(redis), date = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
    const a = { resourceId: "professional:p", slotId: "source-a", startsAt: date + "T10:00:00.000Z", endsAt: date + "T10:20:00.000Z" };
    const b = { ...a, slotId: "sibling-b", startsAt: date + "T10:40:00.000Z", endsAt: date + "T11:00:00.000Z" };
    const c = { ...a, slotId: "destination-c", startsAt: date + "T10:10:00.000Z", endsAt: date + "T10:30:00.000Z" };
    const prepare = async (merchantId: string) => {
      await store.acquire(merchantId, "original", [a, b], 240_000);
      const original = await store.assertActive(merchantId, "original", [a, b]);
      return { original, capture: captureAppointmentLease(merchantId, "original", original, a),
        parent: await redis!.get(store.checkoutKey(merchantId, "original")),
        resource: await redis!.hget(store.resourceKey(merchantId, a.resourceId), original.ownerHash) };
    };
    await t.test("overlap exclusion permits only A and acquires a NEW server generation without releasing origin", async () => {
      const m = "reschedule-generation", f = await prepare(m);
      const held = await store.acquireForAppointmentReschedule(m, "new-command", [c], 240_000, f.capture);
      const proof = originalSlotLeaseProof(held)!; assert.ok(proof); assert.notEqual(proof.generation, f.original.generation);
      assert.deepEqual(Object.keys(held).sort(), ["expiresAt", "slots"]); assert.equal(JSON.stringify(held).includes(proof.generation!), false);
      assert.equal(await redis!.get(store.checkoutKey(m, "original")), f.parent);
      assert.equal(await redis!.hget(store.resourceKey(m, a.resourceId), f.original.ownerHash), f.resource);
      const retry = await store.acquireForAppointmentReschedule(m, "new-command", [c], 240_000, f.capture);
      assert.equal(originalSlotLeaseProof(retry)!.generation, proof.generation);
    });
    await t.test("source ownership never excludes another slot B on the same professional", async () => {
      const m = "reschedule-sibling", f = await prepare(m), overlapB = { ...c, startsAt: date + "T10:30:00.000Z", endsAt: date + "T10:50:00.000Z" };
      await assert.rejects(store.acquireForAppointmentReschedule(m, "new-command", [overlapB], 240_000, f.capture), /service_slot_unavailable/);
      assert.equal(await redis!.get(store.checkoutKey(m, "new-command")), null);
      assert.equal(await redis!.get(store.checkoutKey(m, "original")), f.parent);
    });
    await t.test("same owner fingerprint and timestamps with a NEW source generation cannot grant old-proof exclusion", async () => {
      const m = "reschedule-aba", f = await prepare(m); await store.release(m, "original");
      await store.acquire(m, "original", [a, b], 240_000); const newer = await store.assertActive(m, "original", [a, b]);
      assert.notEqual(newer.generation, f.original.generation); assert.equal(newer.fingerprint, f.original.fingerprint);
      const parent = await redis!.get(store.checkoutKey(m, "original"));
      await assert.rejects(store.acquireForAppointmentReschedule(m, "new-command", [c], 240_000, f.capture), /service_slot_unavailable/);
      assert.equal(await redis!.get(store.checkoutKey(m, "original")), parent);
    });
    await t.test("known rollback exact destination cleanup keeps all original slots and expiry unchanged", async () => {
      const m = "reschedule-rollback", f = await prepare(m);
      const held = await store.acquireForAppointmentReschedule(m, "new-command", [c], 240_000, f.capture);
      const newCapture = captureAppointmentLease(m, "new-command", originalSlotLeaseProof(held), c);
      await store.releaseCaptured(m, newCapture);
      assert.equal(await redis!.get(store.checkoutKey(m, "new-command")), null);
      assert.equal(await redis!.get(store.checkoutKey(m, "original")), f.parent);
      assert.equal(await redis!.hget(store.resourceKey(m, a.resourceId), f.original.ownerHash), f.resource);
    });
    await t.test("postcommit old A cleanup retains B plus new destination and replays with no extra effect", async () => {
      const m = "reschedule-commit", f = await prepare(m);
      const held = await store.acquireForAppointmentReschedule(m, "new-command", [c], 240_000, f.capture), next = originalSlotLeaseProof(held)!;
      await store.releaseCaptured(m, f.capture);
      const original = await store.assertActive(m, "original", [b]), destination = await store.assertActive(m, "new-command", [c]);
      assert.equal(original.generation, f.original.generation); assert.equal(original.expiresAt, f.original.expiresAt);
      assert.equal(destination.generation, next.generation); assert.deepEqual(original.slots, [b]);
      const before = await redis!.get(store.checkoutKey(m, "new-command")); await store.releaseCaptured(m, f.capture);
      assert.equal(await redis!.get(store.checkoutKey(m, "new-command")), before);
    });
    await t.test("foreign tenant proof cannot select another tenant source or destination namespace", async () => {
      const f = await prepare("reschedule-foreign");
      await assert.rejects(store.acquireForAppointmentReschedule("foreign", "new-command", [c], 240_000, f.capture));
      assert.equal(await redis!.get(store.checkoutKey("foreign", "new-command")), null);
      assert.equal(await redis!.get(store.checkoutKey("reschedule-foreign", "original")), f.parent);
    });
  } finally { redis?.disconnect(); await owned.dispose(); }
});
