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

test("starting a new buyer checkout asks for email in WhatsApp and does not trust the WhatsApp alias as registration", async () => {
  let proof: any;
  const empty = { ...session, paymentMethod: undefined, customer: { phone: buyer.phone, phone_verified: true, email_verified: false } };
  const adapter = new CheckoutWhatsAppConversationAdapter({} as any, { getSession: async () => empty } as any,
    { execute: async () => ({ message: "Checkout", blocks: [{ type: "checkout_prepared", data: {} }], suggested_next: [] }) } as any,
    { executeForMerchant: async () => ({ name: "Empresa" }) } as any,
    { execute: async (_: any, context: any) => { proof = context; return { session_id: "checkout", conversation_id: "checkout-conversation" }; } } as any,
    undefined, undefined, { resolveStorefront: async () => session.cart } as any);
  const result = await adapter.respondStore({ merchantId: "merchant", buyer, message: "Finalizar compra", state: initial });
  assert.match(result.agentMessage, /Qual é seu e-mail de contato/);
  assert.equal(result.state.expectsFreeInput, true);
  assert.equal(proof.trustedPhoneBuyer.fullName, undefined);
  assert.equal(result.blocks.some(block => block.type === "checkout_redirect"), false);
});

test("a returning phone asks only for contact email without reading its account or starting an email challenge", async () => {
  let stored: any = { ...session, customer: { phone: buyer.phone, phone_verified: true, email_verified: false } };
  let called = 0;
  const adapter = new CheckoutWhatsAppConversationAdapter({} as any, { getSession: async () => stored } as any,
    { execute: async () => ({ message: "Checkout", blocks: [{ type: "checkout_prepared", data: {} }], suggested_next: [] }) } as any,
    { executeForMerchant: async () => ({ name: "Empresa" }) } as any,
    { execute: async (_: any, context: any) => { assert.equal(context.trustedPhoneBuyer.email, undefined); assert.equal(context.trustedPhoneBuyer.cpf, undefined); return { session_id: "checkout" }; } } as any,
    undefined, undefined, { resolveStorefront: async () => session.cart } as any, undefined, undefined, undefined,
    { emailHint: async () => "existing@example.com" } as any,
    { beginEmailVerification: async (input: any, merchantName: string) => { called++; assert.equal(merchantName, "Empresa"); stored = { ...input, customer: { ...input.customer, otp_code: "123456", otp_expires_at: new Date(Date.now() + 600000).toISOString() } }; return stored; } } as any);
  const result = await adapter.respondStore({ merchantId: "merchant", buyer, message: "Finalizar compra", state: initial });
  assert.equal(called, 0); assert.match(result.agentMessage, /e-mail de contato/);
  assert.equal(stored.customer.email_verified, false);
  assert.equal(result.agentMessage.includes("existing@example.com"), false);
  assert.equal(result.agentMessage.includes("123456"), false);
  assert.equal(result.quickReplies.includes("Reenviar código"), false);
});

test("an old email challenge does not turn an ordinary checkout message into account authentication", async () => {
  const pending = { ...session, customer: { ...session.customer, email_verified: false, otp_code: "123456" } };
  const adapter = new CheckoutWhatsAppConversationAdapter({ execute: async () => ({ message: "Código de verificação inválido. Confira seu email.", missing_fields: ["código de verificação"], actions: [] }) } as any,
    { getSession: async () => pending } as any, {execute:async()=>({message:"Como posso ajudar na loja?",blocks:[],suggested_next:[]})} as any, { executeForMerchant: async () => ({ name: "Empresa" }) } as any);
  const result = await adapter.respondStore({ merchantId: "merchant", buyer, message: "000000", state: { ...initial, stage: "checkout", checkoutSessionId: "checkout" } });
  assert.match(result.agentMessage, /ajudar/);
  assert.equal(result.agentMessage.includes("Enviamos"), false);
});

test("email login persists when returning to the store, while unverified or foreign-phone sessions stay anonymous", async () => {
  let context: any;
  let stored: any = { ...session, globalUserId: "registered-buyer", cart: { ...session.cart, cart_ref: initial.conversationId } };
  const adapter = new CheckoutWhatsAppConversationAdapter({} as any, { getSession: async () => stored } as any,
    { execute: async (input: any) => { context = input.trusted_buyer_context; return { message: "Produtos", suggested_next: [], blocks: [] }; } } as any,
    { executeForMerchant: async () => ({ name: "Empresa" }) } as any);
  const state: any = { ...initial, stage: "checkout", checkoutSessionId: "checkout", history: [{ role: "user", content: "Email confirmado" }] };
  const action: any = { kind: "tool", tool: "search_products", args: { query: "*" } };
  await adapter.respondStore({ merchantId: "merchant", buyer, message: "Continuar comprando", state, action });
  assert.equal(context.globalUserId, "registered-buyer");
  assert.equal(context.email, "buyer@example.com");
  stored = { ...stored, customer: { ...stored.customer, email_verified: false } };
  await adapter.respondStore({ merchantId: "merchant", buyer, message: "Continuar comprando", state, action });
  assert.equal(context.globalUserId, buyer.globalUserId); assert.equal(context.email, undefined);
  stored = { ...stored, customer: { ...stored.customer, email_verified: true, phone: "5511988887777" } };
  await adapter.respondStore({ merchantId: "merchant", buyer, message: "Continuar comprando", state, action });
  assert.equal(context.globalUserId, buyer.globalUserId); assert.equal(context.email, undefined);
});

test("store actions use the shared storefront use case and retain the verified buyer and full quick replies", async () => {
  let seen: any;
  const adapter = new CheckoutWhatsAppConversationAdapter({} as any, {} as any,
    { execute: async (request: any) => { seen = request; return { message: "Produtos", suggested_next: Array.from({ length: 20 }, (_, i) => `Opção ${i}`), blocks: [] }; } } as any,
    { executeForMerchant: async () => ({ name: "Empresa", agentName: "Zyon", agentGreeting: "Saudação da empresa", quickReplies: ["Atalho da empresa"] }) } as any);
  const greeting = await adapter.respondStore({ merchantId: "merchant", buyer, message: "Oi", state: initial });
  assert.ok(greeting.agentMessage.includes("Saudação da empresa")); assert.match(greeting.agentMessage, /^👋 \*Zyon · Empresa\*/); assert.deepEqual(greeting.quickReplies, ["Atalho da empresa"]);
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

test("native checkout advertises only configured methods and binds each payment selection to the current total", async () => {
  const ready = { ...session, paymentMethod: undefined };
  let creates = 0;
  const adapter = new CheckoutWhatsAppConversationAdapter({ execute: async () => ({ message: "Escolha como pagar", actions: [],
    blocks: [{ type: "payment_methods", data: { methods: [{ key: "boleto", label: "Boleto" }] } }],
    experience: { copy: { quick_replies: ["PIX", "Cartão de crédito", "Cartão de débito", "Boleto"] } } }) } as any,
    { getSession: async () => ready } as any, {} as any, { executeForMerchant: async () => ({ name: "Empresa" }) } as any,
    { getPaymentCapabilities: async () => ({ pix: true, card: true, boleto: false, providers: { pix: "mercadopago", card: "stripe" } }) } as any,
    undefined, undefined, undefined, { execute: async () => { creates++; } } as any);
  const state: any = { ...initial, stage: "checkout", checkoutSessionId: "checkout", history: [{ role: "user", content: "Sim" }] };
  const view = buildMetaUiView(await adapter.respondStore({ merchantId: "merchant", buyer, message: "Cartão de crédito", state }));
  assert.equal(creates, 0, "text is navigation, never payment authority");
  const methods = view.choices.filter(c => c.action.kind === "tool" && c.action.tool === "create_payment");
  assert.deepEqual(methods.map(c => c.label), ["Pix", "Cartão de crédito"]);
  assert.ok(methods.every(c => c.action.kind === "tool" && c.action.args.fingerprint === paymentCartFingerprint(ready)));
  assert.equal(view.choices.some(c => /boleto|débito|^PIX$/u.test(c.label)), false);
});

test("Stripe card selection emits the secure handoff once instead of returning the payment chooser", async () => {
  const ready = { ...session, paymentMethod: undefined };
  const previousWidget = process.env.WIDGET_BASE_URL;
  process.env.WIDGET_BASE_URL = "https://widget.example.com";
  try {
    const adapter = new CheckoutWhatsAppConversationAdapter({ execute: async () => { assert.fail("native selection must not become chat text"); } } as any,
      { getSession: async () => ready } as any, {} as any, { executeForMerchant: async () => ({ name: "Empresa" }) } as any,
      { getPaymentCapabilities: async () => ({ pix: true, card: true, boleto: false, providers: { card: "stripe" } }) } as any,
      { sign: () => "signed.opaque_token" } as any, undefined, undefined, { execute: async () => { assert.fail("Stripe intent is created by the secure widget"); } } as any);
    const output = await adapter.respondStore({ merchantId: "merchant", buyer, message: "Cartão de crédito", state: { ...initial, stage: "checkout", checkoutSessionId: "checkout" },
      action: { kind: "tool", tool: "create_payment", args: { method: "card", fingerprint: paymentCartFingerprint(ready) } } });
    const redirect = output.blocks.find(b => b.type === "checkout_redirect")!;
    assert.equal(new URL((redirect.data as any).url).searchParams.get("paymentMethod"), "card");
    assert.equal(output.blocks.some(b => b.type === "payment_methods"), false);
    assert.match(output.agentMessage, /Stripe/);
  } finally { if (previousWidget === undefined) delete process.env.WIDGET_BASE_URL; else process.env.WIDGET_BASE_URL = previousWidget; }
});

test("hosted card provider selection returns its payment URL and never exposes raw provider secrets", async () => {
  const ready = { ...session, paymentMethod: undefined };
  const adapter = new CheckoutWhatsAppConversationAdapter({} as any, { getSession: async () => ready } as any, {} as any,
    { executeForMerchant: async () => ({ name: "Empresa" }) } as any,
    { getPaymentCapabilities: async () => ({ card: true, pix: false, boleto: false, providers: { card: "asaas" } }) } as any,
    undefined, undefined, undefined,
    { execute: async (input: any) => { assert.equal(input.method, "card"); return { id: "card-intent", amountCents: 1099, status: "requires_action", buyerFacing: { invoiceUrl: "https://www.asaas.com/i/invoice", clientSecret: "NEVER-IN-CHAT" } }; } } as any,
    { execute: async () => ({ status: "requires_action" }) } as any);
  const output = await adapter.respondStore({ merchantId: "merchant", buyer, message: "Cartão", state: { ...initial, stage: "checkout", checkoutSessionId: "checkout" },
    action: { kind: "tool", tool: "create_payment", args: { method: "card", fingerprint: paymentCartFingerprint(ready) } } });
  const view = buildMetaUiView(output);
  assert.ok(view.media.some(m => m.type === "interactive" && m.interactive.type === "cta_url" && (m.interactive.action as any).parameters.url === "https://www.asaas.com/i/invoice"));
  assert.equal(JSON.stringify(output).includes("NEVER-IN-CHAT"), false);
});

test("native payment cannot use a stale cart total or an unavailable method", async () => {
  const ready = { ...session, paymentMethod: undefined };
  const adapter = new CheckoutWhatsAppConversationAdapter({} as any, { getSession: async () => ready } as any, {} as any,
    { executeForMerchant: async () => ({ name: "Empresa" }) } as any,
    { getPaymentCapabilities: async () => ({ pix: true, card: false, boleto: false }) } as any,
    undefined, undefined, undefined, { execute: async () => { assert.fail("stale/unavailable action must not create a charge"); } } as any);
  const input: any = { merchantId: "merchant", buyer, message: "Pagar", state: { ...initial, stage: "checkout", checkoutSessionId: "checkout" },
    action: { kind: "tool", tool: "create_payment", args: { method: "pix", fingerprint: "stale" } } };
  assert.match((await adapter.respondStore(input)).agentMessage, /pedido mudou/i);
  input.action.args = { method: "boleto", fingerprint: paymentCartFingerprint(ready) };
  assert.match((await adapter.respondStore(input)).agentMessage, /não está disponível/);
});

test("Meta's canonical phone requires provider proof; a contact email does not authenticate its account", () => {
  assert.equal(deriveChatStage(session), "payment_pending");
  assert.ok(!missingFieldsForStage(session, "data_collection").includes("telefone"));
  const unverified = { ...session, customer: { ...session.customer, phone_verified: false } };
  assert.equal(deriveChatStage(unverified), "data_collection");
  assert.ok(missingFieldsForStage(unverified, "data_collection").includes("telefone"));
  const contactOnly={ ...session, customer: { ...session.customer, email_verified: false } };
  assert.equal(deriveChatStage(contactOnly), "payment_pending");
  assert.equal(contactOnly.customer.email_verified,false);
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

test("ordinary conversation after creating a charge uses the store agent and preserves the original payment", async () => {
  const pending = { intentId: "original", sessionId: "checkout", method: "card" as const, status: "requires_action", amount_cents: 1099 };
  let storeInput: any;
  const adapter = new CheckoutWhatsAppConversationAdapter({ execute: async () => assert.fail("ordinary chat must not return to the payment agent") } as any,
    { getSession: async () => session } as any,
    { execute: async (input: any) => { storeInput = input; return { message: "Tudo bem! Como posso ajudar?", blocks: [], suggested_next: ["Ver produtos"] }; } } as any,
    { executeForMerchant: async () => ({ name: "Empresa" }) } as any);
  (adapter as any).prisma = { storefrontCart: { findUnique: async ({ where }: any) => {
    assert.deepEqual(where.merchantId_sessionId, { merchantId: "merchant", sessionId: "conversation" });
    return { items: [{ variantId: "one" }], expiresAt: new Date(Date.now() + 60000) };
  } } };
  const result = await adapter.respondStore({ merchantId: "merchant", buyer, message: "Oi, como você está?", state: { ...initial, history: [{ role: "user", content: "Pagar" }], stage: "checkout", checkoutSessionId: "checkout", expectsFreeInput: true, payment: pending } });
  assert.equal(storeInput.user_message, "Oi, como você está?");
  assert.equal(result.state.stage, "store");
  assert.equal(result.state.cartHasItems, true);
  assert.deepEqual(result.state.payment, pending);
  assert.equal(result.blocks.some(b => ["payment_intent", "checkout_redirect", "payment_methods"].includes(b.type)), false);
});

test("resuming a pending Stripe checkout issues fresh scoped links without replacing its payment", async () => {
  const previous = process.env.WIDGET_BASE_URL;
  process.env.WIDGET_BASE_URL = "https://widget.example.com";
  try {
    const signed: any[] = [];
    const pending = { id: "original", sessionId: "checkout", method: "card", status: "requires_action", amountCents: 1099, merchantId: "merchant" };
    const adapter = new CheckoutWhatsAppConversationAdapter({} as any, { getSession: async () => session } as any,
      { execute: async () => ({ message: "Confira seu pedido", blocks: [{ type: "checkout_prepared", data: {} }], suggested_next: [] }) } as any,
      { executeForMerchant: async () => ({ name: "Empresa" }) } as any,
      { execute: async () => ({ session_id: "checkout" }), getPaymentCapabilities: async () => ({ card: true, providers: { card: "stripe" } }) } as any,
      { sign: (claims: any) => { signed.push(claims); return `${claims.nonce}.signature`; } } as any,
      undefined, { resolveStorefront: async () => session.cart } as any,
      { execute: async () => assert.fail("resuming a payment must not create a charge") } as any,
      { execute: async () => ({ status: "requires_action" }) } as any);
    (adapter as any).payments = { listForSession: async () => [{ snapshot: () => pending }] };
    (adapter as any).prisma = {
      completedOrder: { findFirst: async () => null },
      whatsAppChannelConfig: { findFirst: async () => ({ whatsappNumber: "5521971191446", credentials: { canonicalChatNumber: "552171191446" } }) },
    };
    let state = { ...initial, checkoutSessionId: "checkout", paymentRevision: 3 };
    const urls: string[] = [];
    for (let i = 0; i < 2; i++) {
      const output = await adapter.respondStore({ merchantId: "merchant", buyer, message: "Finalizar pedido", state, action: { kind: "tool", tool: "checkout", args: {} } });
      state = { ...output.state, stage: "store" };
      assert.equal(output.state.payment?.intentId, "original");
      const redirect = output.blocks.find(b => b.type === "checkout_redirect");
      assert.ok(redirect);
      const url = new URL(String(redirect.data.url));
      assert.equal(url.searchParams.get("paymentRevision"), "3");
      assert.equal(url.searchParams.get("paymentMethod"), "card");
      assert.equal(url.searchParams.get("whatsappNumber"), "552171191446");
      urls.push(url.href);
    }
    assert.notEqual(urls[0], urls[1]);
    assert.ok(signed.every(c => c.whatsappCheckoutSessionId === "checkout" && c.storefrontCartRef === "conversation" && c.expiresAtUnix - c.issuedAtUnix === 900));
  } finally { if (previous === undefined) delete process.env.WIDGET_BASE_URL; else process.env.WIDGET_BASE_URL = previous; }
});

test('opening a product includes its entire published description, gallery, FAQ, testimonials and videos', async () => {
  const full = 'Descrição longa publicada. '.repeat(200);
  const adapter = new CheckoutWhatsAppConversationAdapter({} as any, {} as any,
    { execute: async () => ({ message: 'Detalhes', blocks: [{ type: 'product_card', data: { id:'product', name:'Produto', price:500,
      description:full, image:'https://images.unsplash.com/product.jpg', images:['https://images.unsplash.com/product.jpg'],
      variants:[{id:'variant',price:500,stock:2}] } }], suggested_next:[] }) } as any,
    { executeForMerchant: async () => ({name:'Empresa'}) } as any, undefined, undefined,
    { execute: async (input: any) => {
      assert.deepEqual(input,{merchantId:'merchant',productId:'product'});
      return {blocks:[{type:'paragraph',props:{heading:'Como usar',text:'Instruções completas e publicadas.'},order:0},
        {type:'image',props:{src:'https://images.unsplash.com/product.jpg'},order:1}],
        faqs:[{question:'Pode usar diariamente?',answer:'Siga as instruções publicadas.'}],
        testimonials:[{authorName:'Cliente',rating:5,body:'Depoimento aprovado.'}],
        videos:[{title:'Apresentação',videoUrl:'https://example.com/watch',thumbnailUrl:null}]};
    } } as any);
  const result = await adapter.respondStore({merchantId:'merchant',buyer,message:'Detalhes',state:initial});
  assert.equal((result.blocks[0].data as any).description, full);
  const view = buildMetaUiView(result);
  assert.ok(view.body.includes(full));
  assert.ok(view.body.includes('*Como usar*'));
  assert.ok(view.body.includes('Depoimento aprovado.'));
  assert.ok(view.body.includes('https://example.com/watch'));
  assert.equal(view.media.filter(m=>m.type==='image').length,1,'same image is not sent twice');
  assert.ok(view.choices.some(c=>c.action.kind==='tool' && c.action.tool==='show_content' && String(c.action.args.text).includes('Siga as instruções')));
  assert.ok(view.choices.some(c=>c.action.kind==='tool' && c.action.tool==='add_item_to_cart'));
});
