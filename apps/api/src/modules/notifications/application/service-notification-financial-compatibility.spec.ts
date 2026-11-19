import assert from "node:assert/strict";
import test from "node:test";
import { PrismaPaidOrderReceiptReader } from "../infrastructure/repositories/prisma-paid-order-receipt.reader.js";
import { renderOrderConfirmationWhatsApp, orderConfirmationInstructions } from "../infrastructure/templates/order-confirmation.template.js";
import { SendOrderConfirmationUseCase } from "./use-cases/send-order-confirmation.use-case.js";
import { getTemplateDefinition } from "../../whatsapp-templates/domain/catalog/template-catalog.js";
import { isWhatsAppTemplateType } from "../../whatsapp-templates/domain/catalog/template-types.js";

function fixture(canonical = true, appointments: any[] = [{ id: "appointment", merchantId: "m", orderId: "order", orderUnitId: "line_1", operationalStatus: "scheduled" }]) {
  const line: any = { snapshotVersion: 2, lineId: "line_1", name: "Consultation", sku: "s", variantId: "v", productType: "service", fulfillmentStrategy: "scheduled_service", quantity: 1, unitPriceCents: 10000,
    ...(canonical ? { schedule: { professionalId: "professional", professionalVersion: 1, policyVersion: 1, date: "2030-01-02", startsAt: "2030-01-02T13:00Z", endsAt: "2030-01-02T13:20Z", timeZone: "America/Sao_Paulo", durationMinutes: 20 } } : {}) };
  const order: any = { id: "order", merchantId: "m", sessionId: "session", externalOrderId: "psp", status: "approved", currency: "BRL", orderTotal: "100.00", shippingCents: 0, lineItemsJson: [line] };
  const original = { type: "ORDER_CONFIRMATION", merchantId: "m", orderId: "psp", orderNumber: "psp", buyerEmail: "buyer@example.test", buyerPhone: "+5521999990000", items: [{ name: "Consultation", quantity: 1, price: "100.00", productType: "service" }], total: "100.00" };
  const payment: any = { id: "intent", merchantId: "m", sessionId: "session", providerPaymentId: "psp", status: "approved", amountCents: 10100, approvedAmountCents: 10100, currency: "BRL",
    amountBreakdown: { version: 1, currency: "BRL", itemsSubtotalCents: 10000, discountCents: 0, shippingCents: 0, platformFeeCents: 100, totalCents: 10100 } };
  const queries: any[] = [];
  const prisma: any = { completedOrder: { findFirst: async () => order }, paymentIntent: { findFirst: async () => payment }, outboxMessage: { findFirst: async () => ({ payload: original }) },
    serviceAppointment: { findMany: async (input: any) => { queries.push(input); return appointments; } } };
  return { reader: new PrismaPaidOrderReceiptReader(prisma), order, payment, queries };
}

test("T38 booking notices remain separate from truthful existing financial receipts", async t => {
  await t.test("a real canonical service unit gets neutral separate-booking copy and never overwrites PSP gross", async () => {
    const f = fixture(), e = await f.reader.read({ merchantId: "m", externalOrderId: "psp" }); assert.ok(e);
    assert.equal(e.paidReceipt?.totalPaidCents, 10100); assert.equal(e.total, "100.00"); assert.equal(e.items[0].price, "100.00");
    assert.match(orderConfirmationInstructions(e), /agendamento.*separad/i); assert.doesNotMatch(orderConfirmationInstructions(e), /combinar o atendimento/);
    assert.match(renderOrderConfirmationWhatsApp(e), /101,00/); assert.equal(f.queries.length, 1);
    assert.equal(f.queries[0].where.merchantId, "m"); assert.equal(f.queries[0].where.orderId, "order");
  });
  await t.test("order receipt before admission or after cancellation cannot falsely confirm a slot", async () => {
    for (const rows of [[], [{ id: "appointment", merchantId: "m", orderId: "order", orderUnitId: "line_1", operationalStatus: "cancelled" }]]) {
      const e = await fixture(true, rows).reader.read({ merchantId: "m", externalOrderId: "psp" }); assert.ok(e);
      const copy = orderConfirmationInstructions(e); assert.match(copy, /separad/i); assert.doesNotMatch(copy, /hor?rio confirmado|agendamento confirmado|combinar o atendimento/i);
      assert.equal(e.paidReceipt?.totalPaidCents, 10100);
    }
  });
  await t.test("legacy unbooked service and digital/physical instructions remain unchanged", async () => {
    const e = await fixture(false).reader.read({ merchantId: "m", externalOrderId: "psp" }); assert.ok(e);
    assert.match(orderConfirmationInstructions(e), /combinar o atendimento/);
    assert.match(orderConfirmationInstructions({ ...e, items: [{ productType: "digital", name: "Download", price: "100.00", quantity: 1 }] }), /acesso aos produtos digitais/i);
    assert.match(orderConfirmationInstructions({ ...e, items: [{ productType: "physical", name: "Product", price: "100.00", quantity: 1 }] }), /entrega ou retirada/i);
  });
  await t.test("financial confirmation still sends one buyer receipt with its original idempotence purpose and gross total", async () => {
    const e = await fixture().reader.read({ merchantId: "m", externalOrderId: "psp" }); assert.ok(e); const emails: any[] = [], messages: any[] = [];
    const usecase = new SendOrderConfirmationUseCase({ send: async (i: any) => { emails.push(i); return { status: "sent", messageId: "email" }; } },
      { send: async () => assert.fail("legacy sender forbidden") }, { execute: async (i: any) => { messages.push(i); return { status: "accepted", channel: "whatsapp_template", messageId: "wamid" }; } }, { read: async () => e });
    await usecase.execute(e); assert.equal(emails.length, 1); assert.equal(emails[0].idempotencyKey, "order-confirmation:m:psp:buyer-email");
    assert.deepEqual(messages.map(i => i.type), ["order_paid_animation", "order_nonphysical_confirmation"]);
    assert.match(messages[1].freeformText, /101,00/); assert.match(messages[1].freeformText, /separad/i);
    assert.equal(messages.filter(i => i.type === "service_appointment_notice").length, 0);
  });
  await t.test("canonical discount1000 plus fee200 keeps PSP9200 separate from service nominal10000", async () => {
    const f = fixture(); f.order.orderTotal = "90.00"; f.payment.amountCents = 9200; f.payment.approvedAmountCents = 9200;
    f.payment.amountBreakdown = { version: 1, currency: "BRL", itemsSubtotalCents: 10000, discountCents: 1000, shippingCents: 0, platformFeeCents: 200, totalCents: 9200 };
    const e = await f.reader.read({ merchantId: "m", externalOrderId: "psp" }); assert.ok(e);
    assert.equal(e.paidReceipt?.totalPaidCents, 9200); assert.equal(e.total, "90.00"); assert.equal(e.items[0].price, "100.00");
    assert.match(renderOrderConfirmationWhatsApp(e), /92,00/); assert.match(orderConfirmationInstructions(e), /separad/i);
  });
  await t.test("service utility template purpose is distinct from order shipment and can render all canonical facts", () => {
    assert.equal(isWhatsAppTemplateType("service_appointment_notice"), true);
    const d = getTemplateDefinition("service_appointment_notice"); assert.equal(d.category, "UTILITY"); assert.equal(d.hasCoupon, false);
    assert.ok(Object.values(d.variableMap).includes("appointmentSummary")); assert.doesNotMatch(d.freeformBody, /pedido enviado|combinar o atendimento/i);
  });
});
