import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { overlayCurrentProfessionalHolds } from "./prisma-current-service-facts-reader.js";

const resourceId = "professional:professional-a";
const slots = [
  { startsAt: "2031-05-05T10:00:00.000Z", endsAt: "2031-05-05T10:30:00.000Z", date: "2031-05-05", startTime: "10:00", timeZone: "UTC", durationMinutes: 30 },
  { startsAt: "2031-05-05T10:30:00.000Z", endsAt: "2031-05-05T11:00:00.000Z", date: "2031-05-05", startTime: "10:30", timeZone: "UTC", durationMinutes: 30 },
];
const hold = (start: string, end: string, owner = "foreign-owner", resource = resourceId) => ({
  owner, fingerprint: "opaque-private-fingerprint", expiresAt: 2_000_000_000_000,
  slots: [{ resourceId: resource, slotId: "opaque-private-slot", startsAt: start, endsAt: end }],
});

test("T71 current hold overlay draft", async t => {
  await t.test("keeps canonical SQL slots when there are no active holds", () => {
    assert.deepEqual(overlayCurrentProfessionalHolds(slots, [], resourceId), slots);
  });
  await t.test("removes an overlap without hiding the immediately adjacent slot", () => {
    assert.deepEqual(overlayCurrentProfessionalHolds(slots, [hold(slots[0]!.startsAt, slots[0]!.endsAt)], resourceId), [slots[1]]);
  });
  await t.test("an active interval crossing two canonical starts removes both", () => {
    assert.deepEqual(overlayCurrentProfessionalHolds(slots, [hold("2031-05-05T10:15:00.000Z", "2031-05-05T10:45:00.000Z")], resourceId), []);
  });
  await t.test("another professional's held resource does not consume this resource", () => {
    assert.deepEqual(overlayCurrentProfessionalHolds(slots, [hold(slots[0]!.startsAt, slots[0]!.endsAt, "foreign", "professional:other")], resourceId), slots);
  });
  await t.test("the server-bound own hold stays selectable without returning hold metadata", () => {
    const owner = createHash("sha256").update("verified-session").digest("hex");
    const result = overlayCurrentProfessionalHolds(slots, [hold(slots[0]!.startsAt, slots[0]!.endsAt, owner)], resourceId, "verified-session");
    assert.deepEqual(result, slots);
    assert.equal(JSON.stringify(result).includes("fingerprint"), false);
    assert.equal(JSON.stringify(result).includes(owner), false);
  });
  await t.test("another session cannot reuse the server-bound own-hold exception", () => {
    const owner = createHash("sha256").update("verified-session").digest("hex");
    assert.deepEqual(overlayCurrentProfessionalHolds(slots, [hold(slots[0]!.startsAt, slots[0]!.endsAt, owner)], resourceId, "different-session"), [slots[1]]);
  });
  await t.test("malformed active intervals fail closed rather than fabricate availability", () => {
    for (const bad of [hold("invalid", slots[0]!.endsAt), hold(slots[0]!.endsAt, slots[0]!.startsAt), { ...hold(slots[0]!.startsAt, slots[0]!.endsAt), owner: "" }])
      assert.throws(() => overlayCurrentProfessionalHolds(slots, [bad], resourceId), /service_live_holds_invalid/);
  });
  await t.test("valid results do not mutate the canonical SQL read or private hold records", () => {
    const active = [hold(slots[0]!.startsAt, slots[0]!.endsAt)], beforeSlots = structuredClone(slots), beforeHolds = structuredClone(active);
    overlayCurrentProfessionalHolds(slots, active, resourceId);
    assert.deepEqual(slots, beforeSlots); assert.deepEqual(active, beforeHolds);
  });
});
