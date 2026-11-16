import { test } from "node:test";
import assert from "node:assert/strict";
import { ConflictException } from "@nestjs/common";
import { acquireProfessionalLease, assertProfessionalLease, type ProfessionalLeaseOwner } from "./professional-service-lease.js";
import { professionalSlotId, type ProfessionalCheckoutSelection } from "./service-checkout-selection.js";

test("T27 lease policy", async t => {
  const data = { productId: "service", variantId: "variant", professionalId: "professional", professionalVersion: 7,
    policyVersion: 4, date: "2030-01-01", startsAt: "2030-01-01T10:00:00.000Z", endsAt: "2030-01-01T10:30:00.000Z",
    timeZone: "UTC", durationMinutes: 30, priceInCents: 5000, currency: "BRL" };
  const selected: ProfessionalCheckoutSelection = { ...data, slotId: professionalSlotId("merchant", data) };
  for (const paymentMode of ["online", "at_attendance"] as const) {
    await t.test(paymentMode + " with hold off has no cache dependency", async () => {
      let accesses = 0;
      const owner: ProfessionalLeaseOwner = { ownerId: "checkout", store: () => { accesses++; throw new Error("redis offline"); } };
      const policy = { paymentMode, holdEnabled: false, holdMinutes: null };
      assert.equal(await acquireProfessionalLease("merchant", [selected], policy, owner), undefined);
      await assertProfessionalLease("merchant", [selected], policy);
      assert.equal(accesses, 0);
    });
    await t.test(paymentMode + " uses configured minutes and versioned professional identity", async () => {
      const commands: unknown[][] = [];
      const policy = { paymentMode, holdEnabled: true, holdMinutes: 17 };
      const slots = [{ resourceId: "professional:professional", slotId: selected.slotId,
        startsAt: selected.startsAt, endsAt: selected.endsAt }];
      const hold = { expiresAt: "2030-01-01T09:17:00.000Z", slots };
      const owner: ProfessionalLeaseOwner = { ownerId: "authenticated-checkout", store: () => ({
        acquire: async (...args) => { commands.push(["acquire", ...args]); return hold; },
        assertActive: async (...args) => { commands.push(["assert", ...args]); },
        get: async () => hold, release: async () => {},
      }) };
      assert.deepEqual(await acquireProfessionalLease("merchant", [selected], policy, owner), hold);
      await assertProfessionalLease("merchant", [selected], policy, owner);
      assert.deepEqual(commands, [["acquire", "merchant", "authenticated-checkout", slots, 1_020_000],
        ["assert", "merchant", "authenticated-checkout", slots]]);
      await assert.rejects(assertProfessionalLease("merchant", [selected], policy), /service_hold_required/);
    });
  }
  await t.test("expired, foreign or changed lease errors cannot become confirmation", async () => {
    const policy = { paymentMode: "at_attendance" as const, holdEnabled: true, holdMinutes: 8 };
    let calls = 0;
    const owner: ProfessionalLeaseOwner = { ownerId: "checkout", store: () => ({
      acquire: async () => { throw new Error("not used"); },
      assertActive: async () => { calls++; throw new ConflictException("service_slot_hold_expired"); },
      get: async () => undefined, release: async () => {},
    }) };
    await assert.rejects(assertProfessionalLease("merchant", [selected], policy, owner), /service_slot_hold_expired/);
    assert.equal(calls, 1);
  });
});
