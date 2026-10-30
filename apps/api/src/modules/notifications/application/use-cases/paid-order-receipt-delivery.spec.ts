import test from "node:test";
import assert from "node:assert/strict";
import { SendOrderConfirmationUseCase } from "./send-order-confirmation.use-case.js";
import { SendMerchantOrderNotificationUseCase } from "./send-merchant-order-notification.use-case.js";
import { SendPaidOrderReceiptCorrectionUseCase } from "./send-paid-order-receipt-correction.use-case.js";
import type { OrderConfirmationEvent } from "../../domain/events/notification.events.js";

const event: OrderConfirmationEvent = { type: "ORDER_CONFIRMATION", merchantId: "m1", merchantName: "Loja", orderId: "185874", orderNumber: "185874",
  buyerEmail: "buyer@example.test", buyerPhone: "+5521993001883", items: [{ name: "Produto", price: "3.00", quantity: 1 }], total: "12.86", currency: "BRL",
  paidReceipt: { status: "itemized", currency: "BRL", itemsSubtotalCents: 300, discountCents: 30, shippingCents: 1016,
    platformFeeCents: 99, totalPaidCents: 1385, merchantOrderTotalCents: 1286 } };
const purpose = "qa-order-receipt-correction-v1:185874";
function harness(canonical: OrderConfirmationEvent | null = event) {
  const emails: any[] = [], whatsapp: any[] = [], dashboard: any[] = [], reads: any[] = [];
  const reader = { read: async (input: any) => { reads.push(input); return canonical; } };
  const email = { send: async (input: any) => { emails.push(input); return { status: "sent", messageId: "email-1" }; } };
  const wa = { execute: async (input: any) => { whatsapp.push(input); return { status: "accepted" as const, channel: "whatsapp_template" as const, messageId: "wamid" }; } };
  const buyer = new SendOrderConfirmationUseCase(email, { send: async () => { throw Error("legacy_forbidden"); } }, wa, reader);
  const merchant = new SendMerchantOrderNotificationUseCase({ getContact: async () => ({ merchantName: "Loja", supportEmail: "ops@example.test",
    whatsappConnected: true, whatsappPhone: "+5521993001883" }), create: async (input: any) => { dashboard.push(input); } } as any, email, wa, reader);
  const correction = new SendPaidOrderReceiptCorrectionUseCase(reader, buyer, merchant);
  return { buyer, merchant, correction, emails, whatsapp, dashboard, reads };
}

test("normal confirmation hydrates contacts and charge amount from canonical order instead of incoming payload", async () => {
  const h = harness();
  await h.buyer.execute({ ...event, buyerEmail: "attacker@example.test", total: "9999.99", paidReceipt: undefined });
  assert.equal(h.emails[0].to, "buyer@example.test"); assert.match(h.emails[0].html, /13,85/);
  assert.equal(h.whatsapp[0].variables.amount.replace(/\u00a0/g, " "), "R$ 13,85");
  assert.match(h.whatsapp[0].variables.receiptSummary, /Taxa de serviço/);
});
test("unavailable canonical scope refuses all buyer and merchant deliveries", async () => {
  const h = harness(null);
  await assert.rejects(h.buyer.execute(event), /scope_unavailable/);
  await assert.rejects(h.merchant.execute(event), /scope_unavailable/);
  assert.equal(h.emails.length + h.whatsapp.length + h.dashboard.length, 0);
});
test("correction sends only two receipts, keeps stable separate keys and never creates a second order dashboard event", async () => {
  const h = harness();
  await h.correction.execute({ merchantId: "m1", externalOrderId: "185874", idempotencyPurpose: purpose });
  assert.equal(h.emails.length, 2); assert.equal(h.whatsapp.length, 2); assert.equal(h.dashboard.length, 0);
  assert.equal(h.emails[0].idempotencyKey, `${purpose}:m1:185874:buyer-email`);
  assert.equal(h.emails[1].idempotencyKey, `${purpose}:m1:185874:merchant-email`);
  assert.equal(h.whatsapp[0].idempotencyKey, purpose); assert.equal(h.whatsapp[1].idempotencyKey, purpose);
  assert.deepEqual(h.whatsapp.map(input => input.type), ["order_confirmation", "merchant_order_paid"]);
  const keys = h.emails.map(input => input.idempotencyKey);
  await h.correction.execute({ merchantId: "m1", externalOrderId: "185874", idempotencyPurpose: purpose });
  assert.deepEqual(h.emails.slice(2).map(input => input.idempotencyKey), keys);
});
test("normal delivery retains its original keys separately from correction and preserves dashboard", async () => {
  const h = harness(); await h.buyer.execute(event); await h.merchant.execute(event);
  assert.equal(h.emails[0].idempotencyKey, "order-confirmation:m1:185874:buyer-email");
  assert.equal(h.whatsapp[0].idempotencyKey, "185874"); assert.equal(h.dashboard.length, 1);
  assert.equal(h.dashboard[0].metadata.total, "12.86");
  assert.equal(h.dashboard[0].metadata.paidReceipt.totalPaidCents, 1385);
});
for (const canonical of [null, { ...event, merchantId: "other" }, { ...event, orderId: "other" }, { ...event, paidReceipt: undefined },
  { ...event, paidReceipt: { status: "total_only" as const, currency: "BRL", totalPaidCents: 1385, reason: "breakdown_unavailable" as const } }]) {
  test(`correction requires bound and fully reconciled approved receipt ${JSON.stringify(canonical?.paidReceipt ?? canonical?.merchantId)}`, async () => {
    const h = harness(canonical); await assert.rejects(h.correction.execute({ merchantId: "m1", externalOrderId: "185874", idempotencyPurpose: purpose }), /canonical_payment_required/);
    assert.equal(h.emails.length + h.whatsapp.length + h.dashboard.length, 0);
  });
}
test("correction requires an explicit purpose bound to the same external order", async () => {
  const h = harness();
  await assert.rejects(h.correction.execute({ merchantId: "m1", externalOrderId: "185874", idempotencyPurpose: "qa-order-receipt-correction-v1:other" }), /purpose_invalid/);
  assert.equal(h.reads.length, 0);
});
