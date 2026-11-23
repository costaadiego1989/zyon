import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import * as leases from "./redis-service-slots.js";
import { captureAppointmentLease } from "./appointment-lease-proof.js";
import { initialLeaseMemory } from "../../../tests/initial-lease-memory.fixture.js";
const newlyCreated = (hold: leases.SlotHold) => { const read = Reflect.get(leases, "newlyCreatedSlotLeaseProof"); return typeof read === "function" ? read(hold) as leases.ActiveSlotLeaseProof | undefined : undefined; };
const slots = [{ resourceId: "professional:one", slotId: "slot", startsAt: "2035-02-05T13:00:00.000Z", endsAt: "2035-02-05T13:20:00.000Z" }];
test("T40 initial lease receipt is private and proves only this acquisition's new generation", async t => {
  await t.test("a newly created generation has a private immutable receipt without changing public shape", async () => {
    const f = initialLeaseMemory(), hold = await f.store.acquire("merchant", "session", slots, 240000), proof = newlyCreated(hold);
    assert.ok(proof); assert.deepEqual(proof, leases.originalSlotLeaseProof(hold)); assert.ok(Object.isFrozen(proof));
    assert.deepEqual(Object.keys(hold).sort(), ["expiresAt", "slots"]); assert.deepEqual(JSON.parse(JSON.stringify(hold)), { expiresAt: hold.expiresAt, slots });
    assert.doesNotMatch(JSON.stringify(hold), /generation|ownerHash|newlyCreated/);
  });
  await t.test("idempotent same-owner acquisition preserves original generation and expiry but is not newly created", async () => {
    const f = initialLeaseMemory(), first = await f.store.acquire("merchant", "session", slots, 240000), proof = leases.originalSlotLeaseProof(first);
    const next = await f.store.acquire("merchant", "session", slots, 240000); assert.equal(newlyCreated(next), undefined);
    assert.deepEqual(leases.originalSlotLeaseProof(next), proof); assert.equal(next.expiresAt, first.expiresAt); assert.equal(f.state.releaseCalls, 0);
  });
  await t.test("serialized or caller-created holds cannot manufacture this receipt", async () => {
    const f = initialLeaseMemory(), hold = await f.store.acquire("merchant", "session", slots, 240000);
    assert.equal(newlyCreated(JSON.parse(JSON.stringify(hold))), undefined);
    const forged = leases.withOriginalSlotLeaseProof({ ...hold }, leases.originalSlotLeaseProof(hold)!); assert.equal(newlyCreated(forged), undefined);
  });
  await t.test("lost acquisition acknowledgement supplies no successful result and leaves the uncertain generation untouched", async () => {
    const f = initialLeaseMemory(); f.state.loseAck = true; await assert.rejects(f.store.acquire("merchant", "session", slots, 240000));
    assert.ok(f.state.held); assert.equal(f.state.acquireCalls, 1); assert.equal(f.state.releaseCalls, 0);
  });
  await t.test("captured rollback cleanup cannot erase a replacement generation with identical terms", async () => {
    const f = initialLeaseMemory(), hold = await f.store.acquire("merchant", "session", slots, 240000), capture = captureAppointmentLease("merchant", "session", leases.originalSlotLeaseProof(hold), slots[0]!);
    f.replace(); const replacement = structuredClone(f.state.held); assert.deepEqual(await f.store.releaseCaptured("merchant", capture), { released: false });
    assert.deepEqual(f.state.held, replacement); assert.equal(f.state.releaseCalls, 0);
  });
  await t.test("known original captured target can be cleaned without broad owner release", async () => {
    const f = initialLeaseMemory(), hold = await f.store.acquire("merchant", "session", slots, 240000), proof = leases.originalSlotLeaseProof(hold)!;
    assert.equal(proof.ownerHash, createHash("sha256").update("session").digest("hex"));
    const capture = captureAppointmentLease("merchant", "session", proof, slots[0]!); assert.deepEqual(await f.store.releaseCaptured("merchant", capture), { released: true }); assert.equal(f.state.held, undefined);
  });
});
