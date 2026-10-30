import test from "node:test";
import assert from "node:assert/strict";
import { WhatsAppCheckoutIdentityService } from "./whatsapp-checkout-identity.service.js";
import { CheckoutWhatsAppConversationAdapter } from "../../infrastructure/adapters/checkout-whatsapp-conversation.adapter.js";
import { CheckoutBootstrapService } from "../../../checkout/application/services/checkout-bootstrap.service.js";
import { CheckoutShippingService } from "../../../checkout/application/services/checkout-shipping.service.js";
import { InMemoryCheckoutRepository } from "../../../checkout/infrastructure/repositories/in-memory-checkout.repository.js";
import { checkoutSession } from "../../../checkout/__tests__/checkout-test-fixtures.js";
import { ReopenEmbedCheckoutUseCase } from "../../../embed/application/reopen-embed-checkout.use-case.js";
import { CancelPaymentIntentUseCase } from "../../../payment/application/cancel-payment-intent.use-case.js";
import { paymentCartFingerprint } from "../../../checkout/domain/services/payment-cart-fingerprint.js";

const phone = "5511987654321", email = "buyer@example.test";
const address = { zip: "01001000", street: "Rua de teste", number: "10", complement: "", neighborhood: "Centro", city: "São Paulo", state: "SP" };
const account = { globalUserId: "registered", phone, email, displayName: "Cliente Teste", cpf: "52998224725", address };
const proof = { inboxId: "inbox", leaseToken: "lease", deviceId: "META_CLOUD:config", fromNumber: phone };
const input = { merchantId: "merchant", conversationId: "cart", phone, verifiedSender: proof };

function identityFixture() {
  const state: any = { accounts: [account], config: { id: "config" }, conversation: { id: "wa" },
    message: { payload: { provider: "META_CLOUD", fromNumber: phone } }, addresses: [], preference: null };
  const reads: any[] = [];
  const prisma: any = {
    whatsAppChannelConfig: { findFirst: async (query: any) => { reads.push(query); return state.config; } },
    whatsAppWebhookInbox: { findFirst: async (query: any) => { reads.push(query); return state.message; } },
    whatsAppSession: { findFirst: async (query: any) => { reads.push(query); return state.conversation; } },
    buyerAddress: { findMany: async (query: any) => { reads.push(query); return state.addresses; } },
    buyerPreference: { findUnique: async (query: any) => { reads.push(query); return state.preference; } },
  };
  const buyers: any = { findRegisteredByPhones: async (phones: string[], hint?: string) => {
    reads.push({ phones, hint }); return state.accounts.filter((a: any) => !hint || a.email === hint);
  } };
  return { service: new WhatsAppCheckoutIdentityService(buyers, prisma), state, reads };
}

test("verified Meta sender reuses canonical profile without verifying the email or inventing preferences", async () => {
  const f = identityFixture(); const result = await f.service.recognize(input);
  assert.equal(result.status, "recognized"); if (result.status !== "recognized") return;
  assert.equal(result.buyer.globalUserId, "registered"); assert.equal(result.buyer.customer.cpf, account.cpf);
  assert.equal(result.buyer.customer.address_verified, true); assert.equal(result.buyer.customer.phone_verified, true);
  assert.equal(result.buyer.customer.email_verified, false); assert.equal(result.buyer.preferences, undefined);
  assert.equal(f.reads[1].where.leaseToken, "lease"); assert.equal(f.reads[1].where.merchantId, "merchant");
  assert.equal(f.reads[2].where.conversationState.equals, "cart");
});

for (const missing of ["config", "conversation", "message"]) test(`missing ${missing} proof never reads private accounts`, async () => {
  const f = identityFixture(); f.state[missing] = null;
  assert.deepEqual(await f.service.recognize(input), { status: "unrecognized" });
  assert.equal(f.reads.some(read => read.phones), false);
});

test("a supplied phone/global ID cannot authenticate a public checkout without the durable sender proof", async () => {
  const f = identityFixture();
  assert.deepEqual(await f.service.recognize({ ...input, verifiedSender: undefined }), { status: "unrecognized" });
  assert.deepEqual(await f.service.recognize({ ...input, verifiedSender: { ...proof, fromNumber: "5511991111111" } }), { status: "unrecognized" });
  assert.equal(f.reads.length, 0);
});

test("wrong sender in the leased webhook cannot reveal a profile", async () => {
  const f = identityFixture(); f.state.message.payload.fromNumber = "5511991111111";
  assert.deepEqual(await f.service.recognize(input), { status: "unrecognized" });
  assert.equal(f.reads.some(read => read.phones), false);
});

test("two real accounts require an email once; the hint only selects accounts already matching the verified phone", async () => {
  const f = identityFixture(); f.state.accounts.push({ ...account, globalUserId: "other", email: "other@example.test" });
  assert.equal((await f.service.recognize(input)).status, "ambiguous");
  const result = await f.service.recognize({ ...input, emailHint: " Buyer@Example.Test " });
  assert.equal(result.status, "recognized"); if (result.status === "recognized") assert.equal(result.buyer.globalUserId, "registered");
  f.state.accounts = [{ ...account, phone: "5511991111111" }];
  assert.equal((await f.service.recognize({ ...input, emailHint: email })).status, "unrecognized");
});

test("default saved address wins; unset purchase preferences do not auto-select default cheapest/Pix", async () => {
  const f = identityFixture(); f.state.addresses = [{ ...address, street: "Trabalho", isDefault: false }, { ...address, street: "Casa padrão", complement: null, isDefault: true }];
  f.state.preference = { purchasePreferencesConfigured: false, shippingPreference: "cheapest", paymentPreference: "pix" };
  const result = await f.service.recognize(input); assert.equal(result.status, "recognized"); if (result.status !== "recognized") return;
  assert.equal(result.buyer.customer.address?.street, "Casa padrão"); assert.equal(result.buyer.customer.address?.complement, "");
  assert.equal(result.buyer.preferences, undefined);
  f.state.preference.purchasePreferencesConfigured = true;
  const configured = await f.service.recognize(input);
  if (configured.status === "recognized") assert.deepEqual(configured.buyer.preferences, { shipping: "cheapest", payment: "pix" });
});

test("incomplete registered profile stays incomplete instead of fabricating missing address fields", async () => {
  const f = identityFixture(); f.state.accounts = [{ ...account, cpf: undefined, address: { zip: "01001000" } }];
  const result = await f.service.recognize(input); assert.equal(result.status, "recognized"); if (result.status !== "recognized") return;
  assert.equal(result.buyer.customer.cpf, undefined); assert.equal(result.buyer.customer.address_verified, false);
});

async function recognizedBuyer() {
  const result = await identityFixture().service.recognize(input);
  assert.equal(result.status, "recognized"); if (result.status !== "recognized") throw Error("missing_fixture");
  return result.buyer;
}

test("phone-authenticated bootstrap inserts the canonical profile, keeps email unverified, and rejects scope/rebinding", async () => {
  const repo = new InMemoryCheckoutRepository();
  const bootstrap = new CheckoutBootstrapService(repo, repo);
  const buyer = await recognizedBuyer();
  const request: any = { merchant_id: "merchant", session_id: "checkout", customer: buyer.customer,
    cart: { source: "storefront", cart_ref: "cart", currency: "BRL", total: 3, items: [{ sku: "test", name: "Teste", price: 3, quantity: 1 }] } };
  const result = await bootstrap.bootstrap(request, buyer.globalUserId, true, { trustedWhatsAppBuyer: buyer });
  assert.equal(result.session.customer?.cpf, account.cpf); assert.equal(result.session.customer?.email_verified, false);
  await assert.rejects(bootstrap.bootstrap(request, buyer.globalUserId, true, { trustedWhatsAppBuyer: { ...buyer, merchantId: "another" } }), /binding_mismatch/);
  await assert.rejects(bootstrap.bootstrap(request, "other", true, { trustedWhatsAppBuyer: { ...buyer, globalUserId: "other" } }), /binding_mismatch/);
});

function shippingFixture() {
  const repo = new InMemoryCheckoutRepository(); let calls = 0, payment: any, unavailable = false;
  const session = checkoutSession({ merchantId: "merchant", sessionId: "checkout", globalUserId: "registered", shipping: undefined,
    customer: { ...account, fullName: account.displayName, phone_verified: true, email_verified: false, address_verified: true },
    cart: { source: "storefront", cart_ref: "cart", total: 3, currency: "BRL", items: [{ sku: "test", name: "Teste", price: 3, quantity: 1, productType: "physical" }] } });
  repo.saveSession(session);
  const prisma: any = { paymentIntent: { findFirst: async () => payment }, checkoutSession: { findUnique: async () => repo.getSession("merchant", "checkout") }, crossStoreLineItem: { findFirst: async () => null } };
  const quotes: any = { quoteKey: async () => "fresh", assertNeighborhoodDestination: async () => {}, execute: async (request: any) => {
    calls++; if (unavailable) throw Error("provider_unavailable"); assert.equal(request.destination_zip, address.zip); assert.equal(request.cart_total, 3);
    return { id: "fresh-id", quote_key: "fresh", destination_zip: address.zip, expires_at: new Date(Date.now() + 60_000).toISOString(),
      results: [{ carrier_key: "pac", label: "Correios PAC", price: 1500, eta_days: 6, is_free: false },
        { carrier_key: "sedex", label: "Correios SEDEX", price: 2200, eta_days: 2, is_free: false }] };
  } };
  const service = new CheckoutShippingService(repo, {} as any, quotes, undefined, undefined, prisma);
  return { service, repo, session, calls: () => calls, freeze: () => { payment = { id: "existing" }; }, unavailable: () => { unavailable = true; } };
}

for (const preference of [undefined, "cheapest", "fastest"] as const) test(`returning delivery with ${preference ?? "no preference"} uses live quotes and preserves explicit choice`, async () => {
  const f = shippingFixture(); const result = await f.service.prepareReturningBuyer(f.session, preference);
  assert.equal(f.calls(), 1); assert.equal(result.shippingOptions?.length, 2);
  assert.equal(result.shipping?.customerPrice, preference === "cheapest" ? 15 : preference === "fastest" ? 22 : undefined);
  assert.equal(result.shipping?.quoteId, preference ? "fresh-id" : undefined);
  assert.equal(result.paymentMethod, undefined, "preparation never submits a charge");
});

test("existing payment freezes delivery", async () => {
  const f = shippingFixture(); f.freeze();
  assert.equal(await f.service.prepareReturningBuyer(f.session, "cheapest"), f.session); assert.equal(f.calls(), 0);
});

test("quote failure does not invent a purchasable delivery price", async () => {
  const f = shippingFixture(); f.unavailable();
  const result = await f.service.prepareReturningBuyer(f.session, "cheapest");
  assert.equal(result.shipping, undefined); assert.equal(result.shippingOptions?.length ?? 0, 0); assert.equal(result.paymentMethod, undefined);
});

test("an expired quote is requoted before applying the preference", async () => {
  const f = shippingFixture(); const stale = { ...f.session, shippingOptions: [{ customerPrice: 0, realCost: 0,
    quoteId: "old", quoteKey: "old", expiresAt: "2000-01-01T00:00:00Z", carrier: "Correios", method: "PAC" }] };
  f.repo.saveSession(stale);
  const result = await f.service.prepareReturningBuyer(stale, "cheapest");
  assert.equal(result.shipping?.quoteId, "fresh-id"); assert.equal(result.shipping?.customerPrice, 15);
});

test("authenticated phone checkout edits use the same owner, merchant, cart and phone", async () => {
  const buyer = await recognizedBuyer(); let cancellations = 0;
  const bound = checkoutSession({ merchantId: "merchant", sessionId: "checkout", globalUserId: buyer.globalUserId,
    cart: { source: "storefront", cart_ref: "cart", currency: "BRL", items: [], total: 0 }, customer: buyer.customer });
  const repo: any = { getSession: async () => bound, assertBuyerEditAllowed: async () => {}, reopenForBuyerEdit: async () => bound };
  const useCase = new ReopenEmbedCheckoutUseCase(repo, { execute: async () => { cancellations++; } } as any, { platformFeeBrl: .99 });
  await useCase.execute("merchant", "checkout", "payment", buyer); assert.equal(cancellations, 1);
  await assert.rejects(useCase.execute("merchant", "checkout", "payment", { ...buyer, conversationId: "another" }), /buyer_mismatch/);
  assert.equal(cancellations, 1);
  const cancel = new CancelPaymentIntentUseCase({} as any, repo, {} as any);
  await assert.rejects(cancel.execute({ merchantId: "merchant", sessionId: "checkout", intentId: "intent", idempotencyKey: "key",
    buyer: { ...buyer, merchantId: "another" } }), /buyer_mismatch/);
});

test("registered cart recognition reaches payment through canonical checkout/shipping with no OTP or payment submission", async () => {
  const buyer = await recognizedBuyer(); buyer.preferences = { shipping: "cheapest", payment: "pix" };
  let current: any, context: any; let createPayments = 0, chats = 0;
  const args: any[] = [];
  args[0] = { execute: async () => { chats++; throw Error("unexpected_chat"); } };
  args[1] = { getSession: async () => current };
  args[2] = { execute: async () => ({ message: "Finalizando", blocks: [{ type: "checkout_prepared", data: {} }], suggested_next: [] }) };
  args[3] = { executeForMerchant: async () => ({ name: "Loja de teste" }) };
  args[4] = { execute: async (request: any, trusted: any) => {
    context = trusted;
    current = checkoutSession({ merchantId: "merchant", sessionId: request.session_id, globalUserId: buyer.globalUserId,
      customer: buyer.customer, shipping: undefined, cart: { currency: "BRL", source: "storefront", cart_ref: "cart", total: 3,
        items: [{ sku: "test", name: "Teste", price: 3, quantity: 1, productType: "physical" }] } });
    return { session_id: current.sessionId, conversation_id: "conversation", experience: {} };
  }, getPaymentCapabilities: async () => ({ pix: true, card: true }) };
  args[7] = { resolveStorefront: async () => ({ items: [{ sku: "test", quantity: 1 }], total: 3 }) };
  args[8] = { execute: async () => { createPayments++; } };
  args[11] = { recognize: async () => ({ status: "recognized", buyer }) };
  args[18] = { prepareReturningBuyer: async (session: any, preference: string) => {
    assert.equal(preference, "cheapest"); current = { ...session, shipping: { customerPrice: 15, realCost: 15, carrier: "Correios", method: "PAC", deliveryDays: 6 } }; return current;
  } };
  const adapter: CheckoutWhatsAppConversationAdapter = Reflect.construct(CheckoutWhatsAppConversationAdapter, args);
  const result = await adapter.respondStore({ ...input, buyer: { globalUserId: "guest", phone }, message: "Finalizar compra",
    action: { kind: "tool", tool: "checkout", args: {} }, state: { version: 1, conversationId: "cart", stage: "store", history: [], revision: "", page: 0, previousViews: [] } });
  assert.equal(context.trustedWhatsAppBuyer.globalUserId, "registered"); assert.equal(context.trustedBuyer, undefined);
  assert.equal(result.blocks.some(block => block.type === "payment_methods"), true);
  assert.equal(result.blocks.some(block => block.type === "checkout_redirect"), false);
  assert.match(result.agentMessage, /Cadastro reconhecido/); assert.equal(chats, 0); assert.equal(createPayments, 0);
});

test("recognition after a guest Pix already exists does not replace its checkout or submit a new payment", async () => {
  const buyer = await recognizedBuyer(); const args: any[] = [];
  const old = checkoutSession({ merchantId: "merchant", sessionId: "guest-checkout", globalUserId: "guest",
    customer: buyer.customer, cart: { currency: "BRL", source: "storefront", cart_ref: "cart", total: 3,
      items: [{ sku: "test", name: "Teste", price: 3, quantity: 1 }] } });
  args[0] = {}; args[1] = { getSession: async () => old };
  args[2] = { execute: async () => ({ message: "Finalizando", blocks: [{ type: "checkout_prepared", data: {} }], suggested_next: [] }) };
  args[3] = { executeForMerchant: async () => ({ name: "Loja de teste" }) };
  args[4] = { execute: async () => { assert.fail("existing guest payment must not be replaced"); } };
  args[7] = { resolveStorefront: async () => old.cart };
  args[8] = { execute: async () => { assert.fail("must not submit another charge"); } };
  args[10] = { paymentIntent: { findFirst: async () => ({ id: "existing-pix" }) } };
  args[11] = { recognize: async () => ({ status: "recognized", buyer }) };
  const adapter: CheckoutWhatsAppConversationAdapter = Reflect.construct(CheckoutWhatsAppConversationAdapter, args);
  const result = await adapter.respondStore({ ...input, buyer: { globalUserId: "guest", phone }, message: "Finalizar compra",
    action: { kind: "tool", tool: "checkout", args: {} }, state: { version: 1, conversationId: "cart", checkoutSessionId: old.sessionId,
      stage: "store", history: [], revision: "", page: 0, previousViews: [] } });
  assert.equal(result.state.checkoutSessionId, old.sessionId); assert.match(result.agentMessage, /Pagamento já iniciado/);
});

test("verified sender may edit its original guest payment without reassigning it to a registered account", async () => {
  const f = identityFixture(); f.state.accounts = [];
  const recognition = await f.service.recognize(input);
  assert.equal(recognition.status, "unrecognized"); assert.equal(recognition.owner?.phone, phone);
  const old = checkoutSession({ merchantId: "merchant", sessionId: "guest-checkout", globalUserId: "guest",
    customer: { ...account, fullName: account.displayName, phone_verified: true, email_verified: false, address_verified: true },
    cart: { currency: "BRL", source: "storefront", cart_ref: "cart", total: 3, items: [{ sku: "test", name: "Teste", price: 3, quantity: 1 }] } });
  const args: any[] = []; let edits = 0;
  args[0] = {}; args[1] = { getSession: async () => old }; args[2] = {};
  args[3] = { executeForMerchant: async () => ({ name: "Loja de teste" }) };
  args[4] = { getPaymentCapabilities: async () => ({ pix: true }) };
  args[11] = { recognize: async () => recognition };
  args[13] = { execute: async (_mid: string, _sid: string, _section: string, owner: any) => {
    assert.equal(owner.globalUserId, "guest"); assert.equal(owner.customer.email_verified, false);
    assert.equal(owner.customer.cpf, undefined); edits++;
    return { experience: { stage: "payment", items: [], copy: { quick_replies: [] } } };
  } };
  const adapter: CheckoutWhatsAppConversationAdapter = Reflect.construct(CheckoutWhatsAppConversationAdapter, args);
  const result = await adapter.respondStore({ ...input, buyer: { globalUserId: "guest", phone }, message: "Trocar pagamento",
    action: { kind: "tool", tool: "edit_checkout", args: { section: "payment", fingerprint: paymentCartFingerprint(old) } },
    state: { version: 1, conversationId: "cart", checkoutSessionId: old.sessionId, stage: "checkout", history: [], revision: "", page: 0, previousViews: [] } });
  assert.equal(edits, 1); assert.equal(result.state.checkoutSessionId, old.sessionId);
});

for (const stage of ["payment", "shipping", "data_collection"] as const) test(`store FAQ uses merchant RAG while ${stage} is pending`, async () => {
  const stored = checkoutSession({ merchantId: "merchant", sessionId: "checkout", customer: { ...account,
    fullName: account.displayName, phone_verified: true, email_verified: false, address_verified: true,
    ...(stage === "data_collection" ? { cpf: undefined } : {}) },
    ...(stage === "shipping" ? { shipping: undefined } : {}),
    cart: { source: "storefront", cart_ref: "cart", currency: "BRL", total: 3,
      items: [{ sku: "test", name: "Teste", quantity: 1, price: 3, productType: "physical" }] } });
  let reads = 0;
  const adapter = new CheckoutWhatsAppConversationAdapter({ execute: async () => { assert.fail("store FAQ cannot fall into generic checkout narration"); } } as any,
    { getSession: async () => stored } as any,
    { execute: async (request: any) => { reads++; assert.equal(request.cart_id, "cart");
      return { message: "A loja não publicou essa política na base consultada.", blocks: [], suggested_next: [] }; } } as any,
    { executeForMerchant: async () => ({ name: "Loja" }) } as any);
  const question = stage === "data_collection" ? "FAQ" : "Qual é a política de trocas e devoluções da loja? Não altere meu pedido.";
  const result = await adapter.respondStore({ merchantId: "merchant", buyer: { globalUserId: "guest", phone }, message: question,
    state: { version: 1, conversationId: "cart", checkoutSessionId: "checkout", stage: "checkout", history: [], revision: "", page: 0, previousViews: [] } });
  assert.equal(reads, 1); assert.equal(result.state.checkoutSessionId, "checkout"); assert.equal(result.state.stage, "store");
  assert.match(result.agentMessage, /não publicou/); assert.equal(result.blocks.some(block => block.type === "payment_intent"), false);
});

test("native shipping choice remains in checkout after store questions were separated", async () => {
  const stored = checkoutSession({ merchantId: "merchant", sessionId: "checkout", shipping: undefined,
    customer: { ...account, fullName: account.displayName, phone_verified: true, address_verified: true },
    cart: { source: "storefront", cart_ref: "cart", currency: "BRL", total: 3,
      items: [{ sku: "test", name: "Teste", quantity: 1, price: 3, productType: "physical" }] } });
  let selections = 0;
  const adapter = new CheckoutWhatsAppConversationAdapter({ execute: async () => { selections++; return { message: "Frete escolhido", actions: [] }; } } as any,
    { getSession: async () => stored } as any, { execute: async () => { assert.fail("explicit shipping choice belongs to canonical checkout"); } } as any,
    { executeForMerchant: async () => ({ name: "Loja" }) } as any);
  await adapter.respondStore({ merchantId: "merchant", buyer: { globalUserId: "guest", phone }, message: "Escolho o frete Correios SEDEX",
    state: { version: 1, conversationId: "cart", checkoutSessionId: "checkout", stage: "checkout", history: [], revision: "", page: 0, previousViews: [] } });
  assert.equal(selections, 1);
});
