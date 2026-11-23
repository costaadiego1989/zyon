import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import * as leases from "./redis-service-slots.js";
import { captureAppointmentLease } from "./appointment-lease-proof.js";
import { publicationClaimMemory } from "../../../tests/publication-claim-memory.fixture.js";
const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const slots = [{ resourceId: "professional:one", slotId: "slot", startsAt: "2035-02-05T13:00:00.000Z", endsAt: "2035-02-05T13:20:00.000Z" }];
const newlyCreated = (hold: leases.SlotHold) => { const read = Reflect.get(leases, "newlyCreatedSlotLeaseProof"); return typeof read === "function" ? read(hold) as leases.ActiveSlotLeaseProof | undefined : undefined; };

test("T40 private publication adoption preserves the new SQL winner against late creator compensation", async t => {
  await t.test("B adopts A's same generation without obtaining compensation authority; A cannot remove it", async () => {
    const f = publicationClaimMemory(), first = await f.store.acquire("merchant", "session", slots, 240000, { publicationClaim: A });
    assert.equal(f.state.held.publicationClaim, A); const proof = leases.originalSlotLeaseProof(first)!; assert.ok(newlyCreated(first));
    const second = await f.store.acquire("merchant", "session", slots, 240000, { publicationClaim: B });
    assert.equal(f.state.held.publicationClaim, B); assert.deepEqual(leases.originalSlotLeaseProof(second), proof); assert.equal(second.expiresAt, first.expiresAt);
    assert.equal(newlyCreated(second), undefined); const adopted = structuredClone(f.state.held);
    assert.deepEqual(await f.store.releaseCaptured("merchant", captureAppointmentLease("merchant", "session", proof, slots[0]!), { publicationClaim: A }), { released: false });
    assert.deepEqual(f.state.held, adopted); assert.equal(f.state.releaseCalls, 0);
  });
  await t.test("borrowing a legacy unclaimed hold leaves its encoded state exactly unchanged", async () => {
    const f = publicationClaimMemory(); f.seed(slots, createHash("sha256").update("session").digest("hex")); const before = JSON.stringify(f.state.held);
    const held = await f.store.acquire("merchant", "session", slots, 240000, { publicationClaim: B });
    assert.equal(JSON.stringify(f.state.held), before); assert.equal(newlyCreated(held), undefined); assert.equal(f.state.held.publicationClaim, undefined);
  });
  await t.test("claim adoption after JS pre-read is fenced in the release Lua invocation", async () => {
    const f = publicationClaimMemory(), held = await f.store.acquire("merchant", "session", slots, 240000, { publicationClaim: A });
    const proof = leases.originalSlotLeaseProof(held)!; f.hooks.beforeRelease = async () => { await f.store.acquire("merchant", "session", slots, 240000, { publicationClaim: B }); };
    assert.deepEqual(await f.store.releaseCaptured("merchant", captureAppointmentLease("merchant", "session", proof, slots[0]!), { publicationClaim: A }), { released: false });
    assert.equal(f.state.held.publicationClaim, B); assert.equal(f.state.held.generation, proof.generation); assert.equal(f.state.releaseCalls, 0);
  });
  await t.test("ordinary acquire without the private option leaves the adopted claim and original lease unchanged", async () => {
    const f = publicationClaimMemory(), held = await f.store.acquire("merchant", "session", slots, 240000, { publicationClaim: A }); const before = JSON.stringify(f.state.held);
    const ordinary = await f.store.acquire("merchant", "session", slots, 240000); assert.equal(JSON.stringify(f.state.held), before);
    assert.equal(ordinary.expiresAt, held.expiresAt); assert.equal(newlyCreated(ordinary), undefined); assert.doesNotMatch(JSON.stringify(ordinary), /publicationClaim|generation|ownerHash/);
  });
});
