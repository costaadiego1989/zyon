import assert from "node:assert/strict";
import test from "node:test";
import type { Prisma, CompletedOrder } from "@prisma/client";
import { readOrderProfessionalSelectionsWithin } from "./service-order-appointment.js";
import { professionalSlotId } from "./service-checkout-selection.js";

function fixture() {
  const selections = ["a", "b"].map((key, index) => ({ productId: "service-" + key, variantId: "variant-" + key,
    professionalId: "professional-" + key, professionalVersion: 3 + index, policyVersion: 2, date: "2030-01-02",
    startsAt: "2030-01-02T10:00:00.000Z", endsAt: "2030-01-02T10:20:00.000Z", timeZone: "UTC", durationMinutes: 20,
    priceInCents: 5000 + index * 1000, currency: "BRL", slotId: "" }));
  selections.forEach(s => { s.slotId = professionalSlotId("m", s); });
  const lines = selections.map((s, i) => ({ lineId: "unit-" + i, snapshotVersion: 2, sku: "sku-" + i, name: "Synthetic service",
    variantId: s.variantId, productType: "service", fulfillmentStrategy: "scheduled_service", unitPriceCents: s.priceInCents, quantity: 1,
    schedule: { professionalId: s.professionalId, professionalVersion: s.professionalVersion, policyVersion: s.policyVersion, date: s.date,
      startsAt: s.startsAt, endsAt: s.endsAt, timeZone: s.timeZone, durationMinutes: s.durationMinutes, slotId: s.slotId } }));
  const tx = { productVariant: { findMany: async ({ where }: any) => where.product.merchantId === "m"
    ? selections.map(s => ({ id: s.variantId, productId: s.productId })) : [] },
    checkoutSession: { findUnique: async () => assert.fail("mutable checkout cart cannot supply an immutable paid unit") } } as unknown as Prisma.TransactionClient;
  const order = { merchantId: "m", currency: "BRL", lineItemsJson: lines } as unknown as CompletedOrder;
  return { selections, lines, tx, order };
}

test("T35 full immutable order service selections", async t => {
  await t.test("every paid unit participates in the original whole-lease fingerprint", async () => {
    const f = fixture(), result = await readOrderProfessionalSelectionsWithin(f.tx, f.order);
    assert.deepEqual(result, f.selections); assert.equal(result.length, 2); assert.notEqual(result[0].professionalId, result[1].professionalId);
  });
  await t.test("JSONB property order does not change canonical selections or opaque identities", async () => {
    const f = fixture(), original = await readOrderProfessionalSelectionsWithin(f.tx, f.order);
    f.order.lineItemsJson = f.lines.map(line => Object.fromEntries(Object.entries(line).reverse())) as any;
    assert.deepEqual(await readOrderProfessionalSelectionsWithin(f.tx, f.order), original);
  });
  await t.test("foreign variant identity and ambiguous duplicate unit never fall back to legacy admission", async () => {
    const foreign = fixture(); foreign.order.merchantId = "foreign";
    await assert.rejects(readOrderProfessionalSelectionsWithin(foreign.tx, foreign.order), /service_order_variant_not_found/);
    const ambiguous = fixture(); ambiguous.order.lineItemsJson = [ambiguous.lines[0], ambiguous.lines[0]] as any;
    await assert.rejects(readOrderProfessionalSelectionsWithin(ambiguous.tx, ambiguous.order), /service_order_unit_ambiguous/);
  });
  await t.test("a professional marker on an invalid line cannot become an unclassified legacy bypass", async () => {
    const f = fixture(); f.lines[0].schedule.professionalVersion = 0;
    await assert.rejects(readOrderProfessionalSelectionsWithin(f.tx, f.order), /service_order_snapshot_invalid/);
    const root = Object.assign(fixture().tx, { $transaction: () => assert.fail("root client must be refused") });
    await assert.rejects(readOrderProfessionalSelectionsWithin(root, fixture().order), /service_order_transaction_required/);
  });
});
