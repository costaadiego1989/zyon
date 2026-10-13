import test from "node:test";
import assert from "node:assert/strict";
import { CheckoutWhatsAppConversationAdapter } from "./checkout-whatsapp-conversation.adapter.js";
import { paymentCartFingerprint } from "../../../checkout/domain/services/payment-cart-fingerprint.js";
import { deriveChatStage, missingFieldsForStage } from "../../../checkout/domain/services/customer-extraction.service.js";
import { buildMetaUiView } from "../../domain/ui/meta-ui-renderer.js";
import { BadRequestException } from "@nestjs/common";

const initial: any = { version: 1, conversationId: "conversation", stage: "store", history: [], revision: "", page: 0, previousViews: [] };
const buyer = { globalUserId: "buyer", phone: "552171191446", fullName: "Nome Comprador" };
const session: any = { merchantId: "merchant", sessionId: "checkout", conversationId: "checkout-conversation", globalUserId: buyer.globalUserId,
  chatHistory: [],
  paymentMethod: "pix", customer: { phone: buyer.phone, phone_verified: true, fullName: "Nome Comprador", email: "buyer@example.com", email_verified: true, cpf: "12345678901" },
  cart: { currency: "BRL", total: 10, items: [{ sku: "one", name: "Item", price: 10, quantity: 1, productType: "digital", fulfillmentStrategy: "digital_entitlement" }] } };

test("store actions use the shared storefront use case and retain the verified buyer and full quick replies", async () => {
  let seen: any;
  const adapter = new CheckoutWhatsAppConversationAdapter({} as any, {} as any,
    { execute: async (request: any) => { seen = request; return { message: "Produtos", suggested_next: Array.from({ length: 20 }, (_, i) => `Opção ${i}`), blocks: [] }; } } as any,
    { executeForMerchant: async () => ({ name: "Empresa", agentName: "Zyon", agentGreeting: "Saudação da empresa", quickReplies: ["Atalho da empresa"] }) } as any);
  const greeting = await adapter.respondStore({ merchantId: "merchant", buyer, message: "Oi", state: initial });
  assert.equal(greeting.agentMessage, "Saudação da empresa"); assert.deepEqual(greeting.quickReplies, ["Atalho da empresa"]);
  const output = await adapter.respondStore({ merchantId: "merchant", buyer, message: "Ver produtos", state: greeting.state,
    action: { kind: "tool", tool: "search_products", args: { categoryId: "category", cursor: "cursor" } } });
  assert.equal(seen.cart_id, initial.conversationId); assert.equal(seen.trusted_buyer_context.globalUserId, buyer.globalUserId);
  assert.equal(seen.ui_action.args.cursor, "cursor"); assert.equal(output.quickReplies.length, 20);
});

test("ordinary chat cannot create a charge; a bound native Pix action uses stable provider idempotency", async () => {
  let creates = 0; const keys: string[] = [];
  const adapter = new CheckoutWhatsAppConversationAdapter({ execute: async () => ({ message: "Confira as opções", actions: [], experience: { copy: { quick_replies: [] } } }) } as any,
    { getSession: async (m: string) => m === "merchant" ? session : undefined } as any, {} as any, { executeForMerchant: async () => ({ name: "Empresa" }) } as any,
    undefined, undefined, undefined, undefined,
    { execute: async (input: any) => { creates++; keys.push(input.idempotency_key); return { id: "intent", amountCents: 1099, status: "pending", buyerFacing: { qrCodeCopyPaste: "RAW-PIX", clientSecret: "NEVER-ON-WHATSAPP" } }; } } as any,
    { execute: async () => ({ status: "pending" }) } as any);
  const state = { ...initial, stage: "checkout", checkoutSessionId: "checkout", history: [{ role: "assistant", content: "Checkout" }] };
  await adapter.respondStore({ merchantId: "merchant", buyer, message: "Pix", state });
  assert.equal(creates, 0);
  const input: any = { merchantId: "merchant", buyer, message: "Gerar Pix", state, action: { kind: "tool", tool: "create_payment", args: { method: "pix", fingerprint: paymentCartFingerprint(session) } } };
  const output = await adapter.respondStore(input); await adapter.respondStore(input);
  assert.equal(creates, 2); assert.equal(keys[0], keys[1]);
  assert.equal(JSON.stringify(output).includes("NEVER-ON-WHATSAPP"), false);
  assert.ok(buildMetaUiView(output).media.some(m => m.type === "text" && m.text.body === "RAW-PIX"));
  await assert.rejects(adapter.respondStore({ ...input, merchantId: "foreign" }), /checkout_session_not_found/);
});

test("Meta's canonical phone is accepted only with provider proof and does not bypass email verification", () => {
  assert.equal(deriveChatStage(session), "payment_pending");
  assert.ok(!missingFieldsForStage(session, "data_collection").includes("telefone"));
  const unverified = { ...session, customer: { ...session.customer, phone_verified: false } };
  assert.equal(deriveChatStage(unverified), "data_collection");
  assert.ok(missingFieldsForStage(unverified, "data_collection").includes("telefone"));
  assert.equal(deriveChatStage({ ...session, customer: { ...session.customer, email_verified: false } }), "data_collection");
});

test("a cart that became unavailable before checkout keeps the shopper in a recoverable store conversation", async () => {
  const adapter = new CheckoutWhatsAppConversationAdapter({} as any, {} as any,
    { execute: async () => ({ message: "Finalizar", blocks: [{ type: "checkout_prepared", data: {} }], suggested_next: [] }) } as any,
    { executeForMerchant: async () => ({ name: "Empresa" }) } as any,
    { execute: async () => { assert.fail("rejected cart must not start checkout"); } } as any, undefined, undefined,
    { resolveStorefront: async () => { throw new BadRequestException("insufficient_stock"); } } as any);
  const response = await adapter.respondStore({ merchantId: "merchant", buyer, message: "Finalizar compra", state: initial });
  assert.match(response.agentMessage, /disponibilidade/); assert.equal(response.state.stage, "store");
  assert.deepEqual(response.quickReplies, ["Ver Carrinho", "Continuar Comprando"]);
});

test("full personal identifiers continue in the same secure checkout instead of chat or Meta forms", async () => {
  const withoutCpf = { ...session, customer: { ...session.customer, cpf: undefined } };
  const adapter = new CheckoutWhatsAppConversationAdapter({ execute: async () => { assert.fail("CPF must not be collected in WhatsApp chat"); } } as any,
    { getSession: async () => withoutCpf } as any, {} as any, { executeForMerchant: async () => ({ name: "Empresa" }) } as any);
  const response = await adapter.respondStore({ merchantId: "merchant", buyer, message: "52998224725",
    state: { ...initial, stage: "checkout", checkoutSessionId: "checkout", flowIds: { zyon_registration_v1: "flow" } } });
  assert.match(response.agentMessage, /checkout seguro/); assert.equal(response.state.pendingFlow, undefined);
  assert.equal(response.state.expectsFreeInput, false); assert.equal(JSON.stringify(response).includes("52998224725"), false);
  assert.equal(response.blocks.some(block => block.type === "checkout_form"), false);
});
