import test from "node:test";
import assert from "node:assert/strict";
import { CheckoutWhatsAppConversationAdapter } from "./checkout-whatsapp-conversation.adapter.js";
import { buildMetaUiView } from "../../domain/ui/meta-ui-renderer.js";

const order = { merchantId: "merchant", sessionId: "checkout", externalOrderId: "provider-order", status: "approved", currency: "BRL",
  orderTotal: "12.8600", shippingCents: 1016, lineItemsJson: [{ name: "Preço histórico", unitPriceCents: 300, quantity: 1 }] };
const payment = { id: "intent", merchantId: "merchant", sessionId: "checkout", providerPaymentId: "provider-order", status: "approved", method: "pix", currency: "BRL",
  amountCents: 1385, approvedAmountCents: 1385, amountBreakdown: { version: 1, currency: "BRL", itemsSubtotalCents: 300,
    discountCents: 30, shippingCents: 1016, platformFeeCents: 99, totalCents: 1385 } };
const session: any = { merchantId: "merchant", sessionId: "checkout", conversationId: "checkout-conversation", globalUserId: "buyer", chatHistory: [],
  paymentMethod: "pix", customer: { phone: "5521999990000", phone_verified: true, email: "buyer@example.test", email_verified: true,
    fullName: "Comprador", cpf: "12345678901" }, cart: { cart_ref: "conversation", currency: "BRL", total: 3,
    items: [{ sku: "physical", name: "Preço histórico", quantity: 1, price: 3, productType: "physical", fulfillmentStrategy: "physical_shipping" }] } };
const state: any = { version: 1, conversationId: "conversation", checkoutSessionId: "checkout", stage: "store", history: [{ role: "user", content: "Meu pedido" }], revision: "", page: 0, previousViews: [] };

function fixture(snapshot: any = payment) {
  let statusReads = 0;
  const adapter = new CheckoutWhatsAppConversationAdapter({ execute: async () => assert.fail("status must not ask the payment model or create a charge") } as any,
    { getSession: async () => session } as any, { execute: async () => assert.fail("status must reuse the canonical checkout") } as any,
    { executeForMerchant: async () => ({ name: "Athom" }) } as any);
  (adapter as any).payments = { listForSession: async (merchantId: string, sessionId: string) => {
    assert.equal(merchantId, "merchant"); assert.equal(sessionId, "checkout"); return [{ snapshot: () => payment }];
  } };
  (adapter as any).paymentStatus = { execute: async (input: any) => {
    assert.deepEqual(input, { merchant_id: "merchant", session_id: "checkout", intent_id: "intent" }); statusReads++; return { status: "approved" };
  } };
  (adapter as any).prisma = {
    completedOrder: { findFirst: async ({ where }: any) => { assert.deepEqual(where, { merchantId: "merchant", sessionId: "checkout", externalOrderId: "provider-order" }); return order; } },
    paymentIntent: { findFirst: async ({ where }: any) => { assert.deepEqual(where, { id: "intent", merchantId: "merchant", sessionId: "checkout", status: "approved" }); return snapshot; } },
  };
  return { adapter, statusReads: () => statusReads };
}

test("payment status resumes the same checkout after ordinary chat and shows the full approved receipt", async () => {
  const f = fixture();
  const output = await f.adapter.respondStore({ merchantId: "merchant", buyer: { globalUserId: "buyer", phone: "5521999990000" }, message: "Verificar pagamento", state });
  assert.equal(f.statusReads(), 1);
  assert.equal(output.state.payment?.intentId, "intent");
  assert.match(output.agentMessage, /Pagamento confirmado/);
  assert.equal(output.state.pendingFlow, undefined, "an old missing address must not restart collection after payment");
  assert.equal(output.state.expectsFreeInput, false);
  assert.equal(output.blocks.some(block => ["checkout_summary", "payment_methods", "payment_intent", "checkout_form"].includes(block.type)), false);
  const view = buildMetaUiView(output);
  for (const value of ["3,00", "0,30", "10,16", "0,99", "13,85"]) assert.ok(view.body.includes(value), value);
  assert.ok(!view.body.includes("12,86"), "merchant net accounting must not replace the full paid amount");
  assert.equal(output.blocks.some(block => block.type === "payment_paid_animation"), false, "the notification ledger owns the paid video");
  assert.equal(output.quickReplies.includes("Verificar pagamento"), false);
  assert.equal(state.stage, "store", "the input state remains unchanged");
});

test("a missing legacy breakdown preserves the verified paid total without inventing components", async () => {
  const f = fixture({ ...payment, amountBreakdown: null });
  const output = await f.adapter.respondStore({ merchantId: "merchant", buyer: { globalUserId: "buyer", phone: "5521999990000" }, message: "Verificar pagamento", state });
  const body = buildMetaUiView(output).body;
  assert.match(body, /Total pago: R\$\s*13,85/);
  assert.match(body, /Detalhamento.*indisponível/);
  assert.ok(!body.includes("Frete: R$"));
});

test("an unrelated payment snapshot cannot expose another completed order or label its amount paid", async () => {
  const f = fixture({ ...payment, merchantId: "other-merchant" });
  (f.adapter as any).prisma.completedOrder.findFirst = async () => assert.fail("foreign payment must not read any order");
  const output = await f.adapter.respondStore({ merchantId: "merchant", buyer: { globalUserId: "buyer", phone: "5521999990000" }, message: "Verificar pagamento", state });
  assert.equal(output.blocks.some(block => block.type === "order_confirmation"), false);
  assert.match(output.agentMessage, /registro do pedido está sendo concluído/);
});

test("an incompatible order cannot turn a rejected receipt projection into a paid amount", async () => {
  const f = fixture();
  (f.adapter as any).prisma.completedOrder.findFirst = async () => ({ ...order, currency: "USD" });
  const output = await f.adapter.respondStore({ merchantId: "merchant", buyer: { globalUserId: "buyer", phone: "5521999990000" }, message: "Verificar pagamento", state });
  assert.equal(output.blocks.some(block => block.type === "order_confirmation"), false);
  assert.match(output.agentMessage, /detalhamento.*não está disponível/);
  const legacy = buildMetaUiView({ ...output, blocks: [{ type: "order_confirmation", data: { orderId: "legacy", total: 12.86 } }] });
  assert.match(legacy.body, /Valor do pedido:/);
  assert.ok(!legacy.body.includes("Total pago: R$"));
});
