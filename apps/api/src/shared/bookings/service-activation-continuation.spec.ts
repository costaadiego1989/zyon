import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { ConflictException } from "@nestjs/common";
import { assertNewOrAcceptedServiceCapacityWithin } from "./service-activation-continuation.js";
import { composeServiceReleaseArtifactSource } from "./service-release-artifact.js";
import { syntheticServiceReleaseRuntime } from "../../../tests/service-release-fixture-data.js";
import { professionalSlotId, professionalHoldRequests } from "./service-checkout-selection.js";
import { professionalScheduleSnapshot } from "./service-checkout-cart.js";
import { slotFingerprint } from "./redis-service-slots.js";

composeServiceReleaseArtifactSource(Object.freeze({ readManifest: () => undefined, measureRuntime: syntheticServiceReleaseRuntime }));
function fixture() {
  const now = new Date("2030-01-01T12:00:00Z"), tuple = { productId: "product", variantId: "variant", professionalId: "professional", professionalVersion: 1, policyVersion: 1,
    date: "2030-01-02", startsAt: "2030-01-02T13:00:00.000Z", endsAt: "2030-01-02T13:30:00.000Z", timeZone: "America/Sao_Paulo", durationMinutes: 30, priceInCents: 5000, currency: "BRL" };
  const selection = { ...tuple, slotId: professionalSlotId("merchant", tuple) }, slots = professionalHoldRequests([selection]);
  const cart: any = { currency: "BRL", total: 50, items: [{ product_id: "product", variantId: "variant", sku: "SKU", name: "Service", quantity: 1, price: 50,
    productType: "service", fulfillmentStrategy: "scheduled_service", fulfillmentSchedule: professionalScheduleSnapshot(selection) }] };
  let row: any = { merchantId: "merchant", sessionId: "checkout", cart }, failure: Error | undefined;
  const proof: any = { merchantId: "merchant", ownerHash: createHash("sha256").update("checkout").digest("hex"), generation: "00000000-0000-4000-8000-000000000001",
    fingerprint: slotFingerprint(slots), selectionFingerprint: slotFingerprint(slots), expiresAt: "2030-01-01T12:04:00.000Z", slots };
  const tx: any = { checkoutSession: { findUnique: async (input: any) => { assert.deepEqual(input.where, { merchantId_sessionId: { merchantId: "merchant", sessionId: "checkout" } }); return row; } },
    merchant: { findUnique: async () => ({ businessMode: "services", businessModeSelectedAt: now, businessModeNeedsReview: false }) },
    serviceBusinessPolicy: { findUnique: async () => ({ admissionsEnabled: true, holdEnabled: true, holdMinutes: 4, paymentMode: "at_attendance", version: 1, configuredAt: now }) },
    serviceReservation: { findFirst: async () => null } };
  const terms = { sessionId: "checkout", selections: [selection], cart, now, store: () => ({ assertActive: async () => { if (failure) throw failure; return proof; } }) };
  return { tx, terms, proof, noRow: () => { row = null; }, foreignRow: () => { row = { ...row, merchantId: "foreign" }; },
    changedCart: () => { row = { ...row, cart: { ...cart, total: 40 } }; }, fail: (error: Error) => { failure = error; } };
}
function activationNotReady(error: unknown): boolean {
  assert.ok(error instanceof ConflictException);
  assert.equal(error.getStatus(), 409);
  assert.deepEqual(error.getResponse(), { code: "service_activation_not_ready", blockers: ["release_manifest_missing"] });
  return true;
}

test("T94 private accepted lease continuation", async t => {
  await t.test("exact original SQL terms and current original Redis generation continue without an AP or release manifest", async () => {
    const f = fixture(); await assertNewOrAcceptedServiceCapacityWithin(f.tx, "merchant", f.terms);
  });
  await t.test("a hold-off draft or JSON-only cart cannot claim existing accepted authority", async () => {
    const f = fixture(); await assert.rejects(assertNewOrAcceptedServiceCapacityWithin(f.tx, "merchant"), activationNotReady);
    f.noRow(); await assert.rejects(assertNewOrAcceptedServiceCapacityWithin(f.tx, "merchant", f.terms), activationNotReady);
  });
  await t.test("foreign SQL scope and changed persisted terms cannot borrow an original lease", async () => {
    for (const reason of ["foreign", "cart"]) { const f = fixture(); if (reason === "foreign") f.foreignRow(); else f.changedCart();
      await assert.rejects(assertNewOrAcceptedServiceCapacityWithin(f.tx, "merchant", f.terms), activationNotReady); }
  });
  await t.test("replaced owner, expired proof or absent generation is not an original acceptance", async () => {
    for (const patch of [{ ownerHash: "f".repeat(64) }, { expiresAt: "2030-01-01T11:00:00Z" }, { generation: undefined }]) {
      const f = fixture(); Object.assign(f.proof, patch); await assert.rejects(assertNewOrAcceptedServiceCapacityWithin(f.tx, "merchant", f.terms), activationNotReady);
    }
  });
  await t.test("a definitive expired Redis response cannot renew a lease through the continuation check", async () => {
    const f = fixture(); f.fail(new ConflictException("service_hold_expired")); await assert.rejects(assertNewOrAcceptedServiceCapacityWithin(f.tx, "merchant", f.terms), activationNotReady);
  });
  await t.test("an unknown Redis error retains its identity instead of becoming a ready fallback or retry", async () => {
    const f = fixture(), error = new Error("synthetic-store-unknown"); f.fail(error);
    await assert.rejects(assertNewOrAcceptedServiceCapacityWithin(f.tx, "merchant", f.terms), value => value === error);
  });
});
