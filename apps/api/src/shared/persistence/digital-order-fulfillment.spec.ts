import assert from "node:assert/strict";
import test from "node:test";
import type { Prisma } from "@prisma/client";
import { createDigitalOrderFulfillment } from "./digital-order-fulfillment.js";
import { normalPaymentAuthorityFixture } from "../../modules/payment/domain/normal-checkout-payment.fixture.js";
import { paymentCartFingerprint } from "../../modules/checkout/domain/services/payment-cart-fingerprint.js";

function fixture() {
  const f = normalPaymentAuthorityFixture();
  const target = f.authority.frozenProjection.cart.items.find(line => line.sku === "TARGET")!;
  Reflect.set(target, "productType", "digital"); Reflect.set(target, "fulfillmentStrategy", "digital");
  f.authority.amountBreakdown.cartFingerprint = paymentCartFingerprint(f.authority.frozenProjection);
  const currentCustomer = { email: "changed@example.test", phone: "11900000000", fullName: "Changed buyer" };
  const order = { id: "order", merchantId: "merchant", sessionId: "checkout", externalOrderId: "provider",
    orderTotal: 127, currency: "BRL", completedAt: new Date("2026-10-20T12:00:00Z"),
    lineItemsJson: [{ sku: "TARGET", variantId: "target", quantity: 1 }], session: { customer: currentCustomer } };
  const payment = { ...f.scope, approvedAmountCents: 12849, status: "approved", providerPaymentId: "provider",
    digitalContent: [{ variantId: "target", sku: "TARGET", productName: "Synthetic download",
      downloadUrl: "https://example.test/download.pdf", downloadExpiryDays: 30 }] };
  const entitlements: unknown[] = [], deliveries: Array<Record<string, unknown>> = [], events: unknown[] = [];
  const tx = {
    completedOrder: { async findFirstOrThrow(args: unknown) { assert.deepEqual(args, {
      where: { id: "order", merchantId: "merchant" }, include: { session: true } }); return order; } },
    paymentIntent: { async findFirst(args: unknown) { assert.deepEqual(args, { where: {
      merchantId: "merchant", sessionId: "checkout", providerPaymentId: "provider", status: "approved" } }); return payment; } },
    digitalEntitlement: { async create(args: { data: Record<string, unknown> }) { entitlements.push(args.data); return args.data; } },
    digitalDelivery: { async create(args: { data: Record<string, unknown> }) { deliveries.push(args.data); return args.data; } },
    outboxMessage: { async create(args: unknown) { events.push(args); return args; } },
  } as unknown as Prisma.TransactionClient;
  return { ...f, payment, currentCustomer, entitlements, deliveries, events,
    run: () => createDigitalOrderFulfillment(tx, "order", "merchant") };
}

test("normal paid digital fulfillment uses frozen buyer contacts, never later session contacts", async () => {
  const f = fixture(); await f.run();
  assert.equal(f.entitlements.length, 1); assert.equal(f.events.length, 2);
  assert.deepEqual(f.deliveries.map(row => [row.channel, row.destination, row.buyerName]), [
    ["email", f.authority.frozenProjection.customer.email, "Synthetic Buyer"],
    ["whatsapp", f.authority.frozenProjection.customer.phone, "Synthetic Buyer"],
  ]);
});

for (const fault of ["malformed", "merchant", "session", "payment", "provider-input", "amount", "breakdown"] as const)
  test(`normal digital fulfillment refuses ${fault} authority before any delivery or entitlement`, async () => {
    const f = fixture();
    if (fault === "malformed") Reflect.set(f.payment.creation, "normalCrossSellAuthority", null);
    if (fault === "merchant") f.authority.merchantId = "foreign";
    if (fault === "session") f.authority.checkoutSessionId = "foreign";
    if (fault === "payment") f.authority.paymentId = "foreign";
    if (fault === "provider-input") Reflect.set(f.payment.creation.input, "normalCrossSellAuthority", f.authority);
    if (fault === "amount") f.authority.amountCents += 1;
    if (fault === "breakdown") f.authority.amountBreakdown.platformFeeCents += 1;
    await assert.rejects(f.run(), /payment_normal_cross_sell_authority_conflict/);
    assert.deepEqual([f.entitlements, f.deliveries, f.events], [[], [], []]);
  });

test("legacy digital payment without normal authority retains existing current-contact behavior", async () => {
  const f = fixture(); Reflect.deleteProperty(f.payment.creation, "normalCrossSellAuthority");
  await f.run();
  assert.deepEqual(f.deliveries.map(row => [row.channel, row.destination]), [
    ["email", f.currentCustomer.email], ["whatsapp", f.currentCustomer.phone],
  ]);
});
