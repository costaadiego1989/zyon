import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { slotFingerprint, withOriginalSlotLeaseProof, originalSlotLeaseProof } from "./redis-service-slots.js";
import { captureAppointmentLease, noAppointmentLease, parseAppointmentLease, retainAppointmentLease,
  assertLeaseCaptureUnusedWithin, findAppointmentLeaseWithin } from "./appointment-lease-proof.js";
const target = { resourceId: "professional:p", slotId: "canonical-slot", startsAt: "2030-01-02T10:00:00.000Z", endsAt: "2030-01-02T10:20:00.000Z" };
const sibling = { ...target, slotId: "sibling-slot", startsAt: "2030-01-02T11:00:00.000Z", endsAt: "2030-01-02T11:20:00.000Z" };
const owner = "server-checkout", ownerHash = createHash("sha256").update(owner).digest("hex");
const proof = () => ({ merchantId: "m", ownerHash, generation: "00000000-0000-4000-8000-000000000001",
  fingerprint: slotFingerprint([target, sibling]), expiresAt: "2030-01-02T09:17:00.000Z", slots: [{ ...target }, { ...sibling }] });
test("T33 original appointment lease proof", async t => {
  await t.test("capture binds original tenant owner generation exact target and original whole resources", () => {
    const original = proof(), captured = captureAppointmentLease("m", owner, original, target);
    assert.equal(captured.kind, "owned"); assert.equal(captured.generation, original.generation); assert.equal(captured.ownerHash, ownerHash);
    assert.equal(captured.fingerprint, original.fingerprint); assert.deepEqual(captured.target, target);
    assert.deepEqual(captured.resources, ["professional:p"]); assert.match(captured.targetKey, /^[a-f0-9]{64}$/);
    original.slots[0].slotId = "later-mutation"; assert.equal(captured.target.slotId, "canonical-slot");
  });
  await t.test("same deterministic owner fingerprint and times do not equate different generations", () => {
    const first = captureAppointmentLease("m", owner, proof(), target), newer = proof(); newer.generation = "00000000-0000-4000-8000-000000000002";
    const second = captureAppointmentLease("m", owner, newer, target);
    assert.equal(first.targetKey, second.targetKey); assert.equal(first.fingerprint, second.fingerprint); assert.notEqual(first.generation, second.generation);
  });
  await t.test("foreign owner tenant target malformed or missing generation cannot create a private capture", () => {
    for (const change of [{ merchantId: "foreign" }, { ownerHash: "b".repeat(64) }, { generation: undefined }, { generation: "deterministic-owner" }, { fingerprint: "a".repeat(64) }])
      assert.throws(() => captureAppointmentLease("m", owner, { ...proof(), ...change }, target), /service_hold_original_proof_required/);
    assert.throws(() => captureAppointmentLease("m", owner, proof(), { ...target, slotId: "foreign" }), /service_hold_original_proof_required/);
  });
  await t.test("after rewrites retain immutable capture rather than reconstructing it from current cart", () => {
    const captured = captureAppointmentLease("m", owner, proof(), target), after = retainAppointmentLease({ privateLease: captured }, { operationalStatus: "scheduled", priceInCents: 5000 });
    assert.deepEqual(after.privateLease, captured); assert.equal(after.priceInCents, 5000);
    assert.equal(parseAppointmentLease(after.privateLease)?.kind, "owned");
    assert.deepEqual(retainAppointmentLease({}, { version: 1 }), { version: 1 });
  });
  await t.test("no-hold capture is explicit and has no fabricated owner or generation", () => {
    const none = noAppointmentLease(target, "hold_off"); assert.equal(none.kind, "none"); assert.deepEqual(none.target, target);
    assert.equal(Object.hasOwn(none, "generation"), false); assert.deepEqual(parseAppointmentLease(none), none);
  });
  await t.test("original generation target already consumed rejects another appointment before writes", async () => {
    const captured = captureAppointmentLease("m", owner, proof(), target); let queried: unknown[] = [];
    const tx = { $queryRaw: async (_sql: unknown, ...values: unknown[]) => { queried = values; return [{ id: "original-capture" }]; } } as unknown as Prisma.TransactionClient;
    await assert.rejects(assertLeaseCaptureUnusedWithin(tx, "m", captured), /service_hold_generation_consumed/);
    assert.ok(queried.includes("m")); assert.ok(queried.includes(captured.generation)); assert.ok(queried.includes(captured.targetKey));
  });
  await t.test("latest applicable binding wins and an old moved target is never used as fallback", async () => {
    const captured = captureAppointmentLease("m", owner, proof(), target);
    const tx = { appointmentAudit: { findFirst: async () => ({ id: "latest-binding", version: 3, after: { privateLease: captured } }) } } as unknown as Prisma.TransactionClient;
    const appointment = { id: "a", merchantId: "m", professionalId: "p", startsAt: new Date(target.startsAt), endsAt: new Date(target.endsAt), version: 4 };
    const found = await findAppointmentLeaseWithin(tx, appointment); assert.equal(found?.auditId, "latest-binding"); assert.deepEqual(found?.capture, captured);
    await assert.rejects(findAppointmentLeaseWithin(tx, { ...appointment, startsAt: new Date(sibling.startsAt), endsAt: new Date(sibling.endsAt) }), /service_appointment_lease_binding_mismatch/);
  });
});


test("T33 private acquisition proof carrier", () => {
  const original = proof(), hold = withOriginalSlotLeaseProof({ expiresAt: original.expiresAt, slots: original.slots }, original);
  assert.deepEqual(Object.keys(hold).sort(), ["expiresAt", "slots"]);
  assert.equal(JSON.stringify(hold).includes(original.generation), false);
  const captured = originalSlotLeaseProof(hold)!;
  original.slots[0].slotId = "later-mutation";
  assert.equal(captured.slots[0].slotId, "canonical-slot");
  assert.ok(Object.isFrozen(captured)); assert.ok(Object.isFrozen(captured.slots[0]));
  assert.equal(originalSlotLeaseProof(JSON.parse(JSON.stringify(hold))), undefined);
  assert.equal(originalSlotLeaseProof({ ...hold }), undefined);
});
