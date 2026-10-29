import test from "node:test";
import assert from "node:assert/strict";
import { ConflictException, NotFoundException } from "@nestjs/common";
import { CheckoutWhatsAppConversationAdapter } from "./checkout-whatsapp-conversation.adapter.js";
import { paymentCartFingerprint } from "../../../checkout/domain/services/payment-cart-fingerprint.js";
import { buildMetaUiView, presentMetaUi } from "../../domain/ui/meta-ui-renderer.js";

const buyer = { globalUserId: "buyer", phone: "552193001883" };
function fixture() {
  let stored: any = { merchantId: "merchant", sessionId: "checkout", conversationId: "chat", globalUserId: "buyer", persistenceVersion: 10, chatHistory: [],
    cart: { cart_ref: "cart", currency: "BRL", total: 289.8, items: [{ sku: "sku", name: "Item", price: 289.8, quantity: 1, productType: "physical" }] },
    customer: { email_verified: true, email: "qa@example.invalid", phone_verified: true, phone: buyer.phone, fullName: "Cliente QA", cpf: "52998224725", address_verified: true,
      address: { zip: "01310100", street: "Rua", city: "São Paulo", state: "SP", number: "100", complement: "" } },
    shipping: { carrier: "Correios", method: "PAC", customerPrice: 0, realCost: 22.08, deliveryDays: 6 }, paymentMethod: "pix" };
  const state: any = { version: 1, conversationId: "cart", checkoutSessionId: "checkout", stage: "checkout", history: [], previousViews: [], page: 0, revision: "old",
    payment: { intentId: "pix", sessionId: "checkout", method: "pix", amount_cents: 29079, status: "requires_action", copy_paste: "OLD-PIX" } };
  const calls: any[] = [];
  const reopen = { execute: async (merchantId: string, sessionId: string, section: string, proof: any) => {
    calls.push({ merchantId, sessionId, section, proof });
    assert.equal(proof.globalUserId, "buyer"); assert.equal(proof.customer.email_verified, true);
    stored = { ...stored, paymentMethod: undefined, persistenceVersion: 42 };
    return { experience: { stage: "payment", items: [], copy: { quick_replies: ["Tenho um cupom de desconto"] } }, revision: 42 };
  } };
  const coupon = { executeForCheckout: async (input: any) => { calls.push(input); stored = { ...stored, persistenceVersion: 43, cart: { ...stored.cart, currentDiscount: 10 } }; return { session: stored, rules: { couponBoxEnabled: true } }; } };
  const adapter = new CheckoutWhatsAppConversationAdapter({ execute: async () => { assert.fail("native edits reuse the shared APIs, not chat interpretation"); } } as any,
    { getSession: async () => stored } as any, {} as any, { executeForMerchant: async () => ({ name: "Empresa" }) } as any,
    { getPaymentCapabilities: async () => ({ pix: true, card: true, boleto: false, providers: { card: "stripe" } }) } as any,
    { sign: () => "signed.token" } as any, undefined, undefined,
    { execute: async () => { assert.fail("editing must not create a replacement charge"); } } as any,
    { execute: async () => ({ status: "requires_action" }) } as any, undefined, undefined, undefined,
    reopen as any, coupon as any);
  const send = (action: any, next = state, message = "Escolha") => adapter.respondStore({ merchantId: "merchant", buyer, state: next, message, action });
  return { adapter, state, calls, reopen, coupon, send, read: () => stored };
}

test("switching the pending Pix to card asks first, then reuses storefront reopening and retains shipping", async () => {
  const f = fixture(); const previous = process.env.WIDGET_BASE_URL; process.env.WIDGET_BASE_URL = "https://widget.example.com";
  try {
    const ask = await f.send({ kind: "tool", tool: "create_payment", args: { method: "card", fingerprint: paymentCartFingerprint(f.read()) } });
    assert.equal(f.calls.length, 0); assert.equal(ask.blocks.some(b => b.type === "payment_intent"), false);
    const action = buildMetaUiView(ask).choices.find(c => c.label === "Confirmar troca")!.action;
    const done = await f.send(action, ask.state);
    assert.equal(f.calls.length, 1); assert.equal(f.calls[0].section, "payment");
    assert.equal(done.state.payment, undefined); assert.equal(done.state.paymentGeneration, 1);
    assert.equal(f.read().shipping.customerPrice, 0); assert.equal(f.read().shipping.realCost, 22.08);
    const url = new URL((done.blocks.find(b => b.type === "checkout_redirect")!.data as any).url);
    assert.equal(url.searchParams.get("paymentMethod"), "card"); assert.equal(url.searchParams.get("paymentRevision"), "42");
  } finally { if (previous === undefined) delete process.env.WIDGET_BASE_URL; else process.env.WIDGET_BASE_URL = previous; }
});

test("keeping Pix and a stale confirmation never invoke cancellation", async () => {
  const f = fixture(); const ask = await f.send({ kind: "tool", tool: "edit_checkout", args: { section: "payment", fingerprint: paymentCartFingerprint(f.read()) } });
  const keep = await f.send({ kind: "tool", tool: "cancel_checkout_edit", args: {} }, ask.state);
  assert.equal(keep.state.payment?.intentId, "pix"); assert.equal(f.calls.length, 0);
  await f.send({ kind: "tool", tool: "confirm_checkout_edit", args: { section: "payment", intentId: "foreign", fingerprint: paymentCartFingerprint(f.read()) } }, ask.state);
  assert.equal(f.calls.length, 0);
});

test("unconfirmed/paid provider cancellation cannot clear the payment or issue another checkout", async () => {
  const f = fixture(); f.reopen.execute = async () => { throw new ConflictException("checkout_payment_cancellation_unconfirmed"); };
  const ask = await f.send({ kind: "tool", tool: "edit_checkout", args: { section: "payment", fingerprint: paymentCartFingerprint(f.read()) } });
  const done = await f.send(buildMetaUiView(ask).choices.find(c => c.label === "Confirmar troca")!.action, ask.state);
  assert.match(done.agentMessage, /não foi possível confirmar/); assert.equal(done.state.payment?.intentId, "pix");
  assert.equal(done.blocks.some(b => b.type === "checkout_redirect"), false);
});

test("coupon entry cancels the pending quote through the existing API and sends the code with its server version", async () => {
  const f = fixture();
  const ask = await f.send({ kind: "tool", tool: "edit_checkout", args: { section: "coupon", fingerprint: paymentCartFingerprint(f.read()) } });
  const entry = await f.send(buildMetaUiView(ask).choices.find(c => c.label === "Confirmar troca")!.action, ask.state);
  assert.equal(entry.state.expectsFreeInput, true);
  const applied = await f.send(undefined, entry.state, "loja10");
  assert.deepEqual(f.calls[1], { merchant_id: "merchant", session_id: "checkout", code: "LOJA10", expectedVersion: 42 });
  assert.equal(applied.state.pendingCoupon, undefined); assert.match(applied.agentMessage, /Cupom aplicado/);
  assert.equal(f.read().cart.currentDiscount, 10);
});

test("invalid coupon keeps input active and does not interpret a numeric code as a menu choice", async () => {
  const f = fixture(); f.coupon.executeForCheckout = async () => { throw new NotFoundException("COUPON_NOT_FOUND"); };
  const current = { ...f.state, payment: undefined, pendingCoupon: { sessionId: "checkout", fingerprint: paymentCartFingerprint(f.read()) } };
  const response = await f.send(undefined, current, "123");
  assert.equal(response.state.expectsFreeInput, true); assert.ok(response.state.pendingCoupon);
  assert.match(response.agentMessage, /não pôde ser aplicado/);
});

test("coupon title fits Meta's row limit without losing its authoritative action", () => {
  const view = buildMetaUiView({ agentMessage: "Escolha", quickReplies: ["Tenho um cupom de desconto"], state: fixture().state, blocks: [] });
  const result = presentMetaUi(view, "turn");
  assert.equal(view.choices[0].label, "Usar cupom");
  assert.equal(JSON.stringify(result.messages).includes("1. Usar cupom"), true);
});

test("new Pix attempts after a confirmed cancellation have new keys and retries retain that key", async () => {
  const f = fixture(); const keys: string[] = [];
  (f.adapter as any).createPayment = { execute: async (input: any) => { keys.push(input.idempotency_key); return { id: "fresh", status: "requires_action", amountCents: 29079, buyerFacing: { qrCodeCopyPaste: "FRESH-PIX" } }; } };
  const send = (generation: number) => f.send({ kind: "tool", tool: "create_payment", args: { method: "pix", fingerprint: paymentCartFingerprint(f.read()) } }, { ...f.state, payment: undefined, paymentGeneration: generation });
  await send(0); await send(1); await send(1);
  assert.notEqual(keys[0], keys[1]); assert.equal(keys[1], keys[2]);
});

test("an unverified account cannot invoke the shared edit API", async () => {
  const f = fixture(); f.read().customer.email_verified = false;
  await assert.rejects(f.send({ kind: "tool", tool: "edit_checkout", args: { section: "payment", fingerprint: paymentCartFingerprint(f.read()) } }), /whatsapp_checkout_edit_buyer_required/);
  assert.equal(f.calls.length, 0);
});
