import test, { before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";
import { CheckoutChatRequestService } from "./checkout-chat-request.service.js";
import { PrismaCheckoutRepository } from "./prisma-checkout.repository.js";
import { PaymentIntentEntity, type PaymentMethod } from "../../../payment/domain/payment-intent.entity.js";
import { PrismaPaymentRepository } from "../../../payment/infrastructure/prisma-payment.repository.js";
import { ResumePaymentCreationService } from "../../../payment/application/resume-payment-creation.service.js";
import { paymentCartFingerprint } from "../../domain/services/payment-cart-fingerprint.js";
import type { CheckoutSession, ChatMessageRequest } from "@zyon/shared-types";
import { DEFAULT_MERCHANT_RULES } from "@zyon/shared-types";
import { ChatResponseBuilder } from "../../application/services/chat-response.builder.js";
import { SafeAuthorizedOffer } from "../../domain/types/safe-authorized-offer.js";
import { registerTenantMiddleware } from "../../../../shared/persistence/tenant.middleware.js";

const url = new URL(process.env.CHECKOUT_CHAT_TEST_DATABASE_URL ?? "postgresql://invalid/disabled");
const enabled = url.hostname === "127.0.0.1" && url.port === "5557" && url.pathname === "/revenue_recovery_final_0924";
const prisma = new PrismaClient({ datasources: { db: { url: url.toString() } } });
const chat = new CheckoutChatRequestService(prisma), repo = new PrismaCheckoutRepository(prisma), payments = new PrismaPaymentRepository(prisma);
const env = { ...process.env }, originalFetch = globalThis.fetch;
before(async () => { if (enabled) await prisma.$connect(); });
after(async () => { await prisma.$disconnect(); process.env = env; globalThis.fetch = originalFetch; });
beforeEach(async () => {
  if (!enabled) return;
  process.env = { ...env, CHECKOUT_CHAT_REQUESTS_ENABLED: "true", CHECKOUT_CHAT_REQUEST_MERCHANT_IDS: "store,other",
    CHECKOUT_CHAT_PAYMENT_RECOVERY_ENABLED: "true", CHECKOUT_CHAT_RECOVERY_MERCHANT_IDS: "store" };
  globalThis.fetch = (async () => { throw new Error("EXTERNAL_NETWORK_FORBIDDEN"); }) as typeof fetch;
  await prisma.$executeRawUnsafe("TRUNCATE checkout_sessions, payment_intents CASCADE");
});
const integration = (name: string, fn: () => Promise<void>) => test(name, { skip: !enabled, timeout: 30_000 }, fn);
const input = (): ChatMessageRequest => ({ merchant_id: "store", session_id: "session", conversation_id: "conversation",
  message_id: "message_payment_0001", user_message: "PIX" });
const response = () => ({ message: "Acompanhe o pagamento.", objection: "unknown" as const, actions: [], turns: [] });
const noop = async () => {};
async function seed(merchantId = "store") {
  const now = new Date().toISOString();
  await repo.saveSession({ merchantId, sessionId: "session", conversationId: "conversation", globalUserId: "buyer",
    cart: { currency: "BRL", total: 100, items: [{ sku: "one", name: "Item", price: 100, quantity: 1 }] },
    customer: { fullName: "Buyer Fixture", email: "fixture@example.invalid", email_verified: true, cpf: "12345678909",
      phone: "11999998888", address_verified: true, address: { zip: "01001000", street: "Fixture", number: "1", complement: "", city: "SP", state: "SP" } },
    shipping: { customerPrice: 0, realCost: 0, region: "SP" }, abandonmentScore: 0, triggerAgent: false,
    chatHistory: [], createdAt: now, updatedAt: now });
}
async function recordSelection(request: ChatMessageRequest, claim: any, method: PaymentMethod) {
  return repo.appendChatExchange({ merchantId: request.merchant_id, sessionId: request.session_id, claim,
    expectedSession: await repo.getSession(request.merchant_id, request.session_id),
    selectedPaymentMethod: method === "card" ? "credit_card" : method,
    buyer: { role: "buyer", text: request.user_message, occurredAt: new Date().toISOString() },
    agent: { role: "agent", text: response().message, occurredAt: new Date().toISOString() } });
}
async function financial(session: CheckoutSession, requestId: string, method: PaymentMethod, fail = false) {
  const intent = PaymentIntentEntity.create({ merchantId: session.merchantId, sessionId: session.sessionId,
    idempotencyKey: `chat:${requestId}`, amountCents: 10000, currency: "BRL", method,
    amountBreakdown: { version: 1, currency: "BRL", itemsSubtotalCents: 10000, discountCents: 0, shippingCents: 0,
      platformFeeCents: 0, totalCents: 10000, cartFingerprint: paymentCartFingerprint(session) } });
  intent.prepareCreation({ merchantId: session.merchantId, sessionId: session.sessionId, intentId: intent.id,
    amountCents: 10000, currency: "BRL", method, providerIdempotencyKey: requestId });
  await payments.saveIntent({ intent });
  let creates = 0, recoveries = 0;
  const provider = {
    async createPayment() { creates++; if (fail) throw new Error("lost provider response"); return result(); },
    async recoverPayment() { recoveries++; return result(); },
  };
  const result = () => ({ providerPaymentId: `provider_${intent.id}`, buyerFacingPayload: {
    qrCodeCopyPaste: "fixture-pix", clientSecret: "fixture-secret", stripePublishableKey: "pk_test_fixture",
    invoiceUrl: "https://example.invalid/pay", privateField: "must-not-leak",
    transfers: [{ kind: "merchant", destinationAddress: "fixture", amountAtomic: "1", amountDisplay: "1", privateField: "must-not-leak" }],
  } });
  const resume = new ResumePaymentCreationService(payments, provider as any);
  await resume.execute(intent).catch(error => { if (!fail) throw error; });
  return { intent, resume, counts: () => ({ creates, recoveries }) };
}
async function interrupted(method: PaymentMethod = "pix", fail = false) {
  await seed(); let f!: Awaited<ReturnType<typeof financial>>;
  await assert.rejects(chat.run(input(), noop, async (request, claim) => {
    const session = await recordSelection(request, claim, method);
    f = await financial(session, claim!.requestId, method, fail);
    throw new Error("lost chat response");
  }));
  return f;
}

for (const method of ["pix", "card", "boleto", "crypto"] as const) integration(`recovers persisted ${method} without creating or consulting a provider`, async () => {
  const f = await interrupted(method);
  assert.equal((await chat.readState("store", "session")).payment_intent_id, undefined);
  await assert.rejects(chat.readPayment("store", "session", f.intent.id));
  const results = await Promise.all(Array.from({ length: 6 }, () => chat.reconcile(input())));
  assert.ok(results.every(result => result.chat_request.status === "reconciled"));
  assert.equal(await prisma.checkoutChatPaymentResolution.count(), 1);
  const state = await chat.readState("store", "session");
  assert.equal(state.payment_intent_id, f.intent.id); assert.equal(state.active_request, undefined);
  assert.equal(JSON.stringify(state).includes("fixture-secret"), false);
  const payment = await chat.readPayment("store", "session", f.intent.id);
  assert.equal(payment.method, method); assert.equal(payment.status, "requires_action");
  assert.equal(payment.buyerFacing?.clientSecret, "fixture-secret");
  assert.equal(JSON.stringify(payment).includes("must-not-leak"), false);
  assert.equal((payment as any).creation, undefined);
  assert.deepEqual(f.counts(), { creates: 1, recoveries: 0 });
  assert.equal(await prisma.paymentIntent.count(), 1);
  await assert.rejects(prisma.checkoutChatPaymentResolution.updateMany({ data: { paymentStatus: "approved" } }), /IMMUTABLE/);
  await assert.rejects(prisma.checkoutChatPaymentResolution.deleteMany(), /IMMUTABLE/);
});

integration("uncertain provider creation stays blocked until the financial service recovers the same intent", async () => {
  const f = await interrupted("pix", true);
  await assert.rejects(chat.reconcile(input()));
  assert.equal(await prisma.checkoutChatPaymentResolution.count(), 0);
  const current = (await payments.getIntentById("store", f.intent.id))!;
  assert.equal(current.snapshot().creation?.state, "uncertain");
  await f.resume.execute(current);
  await chat.reconcile(input());
  assert.deepEqual(f.counts(), { creates: 1, recoveries: 1 });
  assert.equal(await prisma.paymentIntent.count(), 1);
});

integration("normal completion publishes a reference; an incomplete financial result cannot complete chat", async () => {
  await seed(); let id = "";
  await chat.run(input(), noop, async (request, claim) => {
    const session = await recordSelection(request, claim, "pix");
    id = (await financial(session, claim!.requestId, "pix")).intent.id;
    return response();
  });
  assert.equal((await chat.readState("store", "session")).payment_intent_id, id);
  assert.equal(await prisma.checkoutChatPaymentResolution.count(), 0);
  await prisma.$executeRawUnsafe("TRUNCATE checkout_sessions, payment_intents CASCADE"); await seed();
  await assert.rejects(chat.run(input(), noop, async (request, claim) => {
    const session = await recordSelection(request, claim, "pix");
    await financial(session, claim!.requestId, "pix", true);
    return response();
  }));
  assert.equal((await prisma.checkoutChatRequest.findFirstOrThrow()).status, "unknown");
});

integration("recovery fences the original worker before it returns a stale success", async () => {
  await seed();
  let release!: () => void, entered!: () => void;
  const gate = new Promise<void>(r => { release = r; }), ready = new Promise<void>(r => { entered = r; });
  const result = chat.run(input(), noop, async (request, claim) => {
    const session = await recordSelection(request, claim, "pix");
    await financial(session, claim!.requestId, "pix"); entered(); await gate; return response();
  });
  const assertion = assert.rejects(result, (error: any) => error.getResponse?.().code === "CHAT_MESSAGE_RECONCILED");
  await ready;
  try { await chat.reconcile(input()); } finally { release(); }
  await assertion;
  assert.equal((await prisma.checkoutChatRequest.findFirstOrThrow()).status, "reconciled");
});

for (const changed of ["cart", "customer", "shipping", "paymentMethod", "conversationId"] as const) integration(`changed ${changed} prevents payment replay`, async () => {
  const f = await interrupted();
  const session = (await repo.getSession("store", "session"))!;
  const values = { cart: { ...session.cart, total: 200 }, customer: { ...session.customer, fullName: "Changed" },
    shipping: { ...session.shipping!, customerPrice: 10 }, paymentMethod: "boleto", conversationId: "different" };
  await prisma.checkoutSession.updateMany({ where: { merchantId: "store" }, data: { [changed]: values[changed] } });
  await assert.rejects(chat.reconcile(input()));
  await assert.rejects(chat.readPayment("store", "session", f.intent.id));
  assert.equal(await prisma.checkoutChatPaymentResolution.count(), 0);
});

integration("tenant, session and intent references are bound and credentials stay protected after flag rollback", async () => {
  const f = await interrupted(); await seed("other");
  await assert.rejects(chat.reconcile({ ...input(), merchant_id: "other" }));
  await assert.rejects(chat.readPayment("other", "session", f.intent.id));
  process.env.CHECKOUT_CHAT_RECOVERY_MERCHANT_IDS = "*";
  await assert.rejects(chat.reconcile(input()));
  process.env.CHECKOUT_CHAT_RECOVERY_MERCHANT_IDS = "store";
  await chat.reconcile(input());
  const scoped = registerTenantMiddleware(prisma, { get: () => ({ merchantId: "other" }) } as any);
  assert.equal(await scoped.checkoutChatPaymentResolution.count({ where: { merchantId: "store" } }), 0);
  await scoped.$transaction(async tx => {
    assert.equal(await tx.checkoutChatPaymentResolution.count({ where: { merchantId: "store" } }), 0);
  });
  process.env.CHECKOUT_CHAT_PAYMENT_RECOVERY_ENABLED = "false";
  assert.equal((await chat.readPayment("store", "session", f.intent.id)).id, f.intent.id);
  await assert.rejects(chat.readPayment("store", "different", f.intent.id));
  await assert.rejects(chat.readPayment("store", "session", "forged"));
});

integration("resolution insertion without the terminal receipt rolls back, and forged version is rejected", async () => {
  const f = await interrupted(), row = await prisma.checkoutChatRequest.findFirstOrThrow();
  const payment = await prisma.paymentIntent.findFirstOrThrow();
  const proof = { requestId: row.id, merchantId: row.merchantId, sessionId: row.sessionId, paymentIntentId: f.intent.id,
    paymentVersion: payment.version, paymentStatus: payment.status, previousStatus: row.status,
    previousFinishedAt: row.finishedAt, resolvedAt: new Date() };
  await assert.rejects(prisma.checkoutChatPaymentResolution.create({ data: { ...proof, paymentVersion: 999 } }), /EVIDENCE_REQUIRED/);
  await assert.rejects(prisma.checkoutChatPaymentResolution.create({ data: proof }), /NOT_APPLIED/);
  assert.equal(await prisma.checkoutChatPaymentResolution.count(), 0);
  assert.equal((await prisma.checkoutChatRequest.findFirstOrThrow()).status, "unknown");
});

integration("historical exchanges without payment proof never gain recovery when the flag is enabled", async () => {
  process.env.CHECKOUT_CHAT_PAYMENT_RECOVERY_ENABLED = "false";
  await interrupted(); process.env.CHECKOUT_CHAT_PAYMENT_RECOVERY_ENABLED = "true";
  assert.equal((await prisma.checkoutChatExchange.findFirstOrThrow()).paymentMethod, null);
  await assert.rejects(chat.reconcile(input()));
  assert.equal((await chat.readState("store", "session")).payment_intent_id, undefined);
});

integration("a newer payment without recovery proof prevents resurfacing an older charge after flag rollback", async () => {
  const f = await interrupted(); await chat.reconcile(input());
  process.env.CHECKOUT_CHAT_PAYMENT_RECOVERY_ENABLED = "false";
  // Simulate an independent financial caller: no new bound chat exchange.
  await financial((await repo.getSession("store", "session"))!, "another-financial-caller", "pix");
  assert.equal(await prisma.paymentIntent.count(), 2);
  assert.equal((await chat.readState("store", "session")).payment_intent_id, undefined);
  await assert.rejects(chat.readPayment("store", "session", f.intent.id));
});

for (const invalid of ["fingerprint", "idempotency", "currency", "provider", "creation", "amount"] as const) integration(`financial ${invalid} mismatch cannot release chat`, async () => {
  const f = await interrupted(), payment = await prisma.paymentIntent.findFirstOrThrow();
  const patches = { fingerprint: { amountBreakdown: { ...payment.amountBreakdown as object, cartFingerprint: "0".repeat(64) } },
    idempotency: { idempotencyKey: "unrelated" }, currency: { currency: "USD" }, provider: { providerPaymentId: null },
    creation: { creation: { ...payment.creation as object, state: "uncertain" } }, amount: { amountCents: 20000 } };
  await prisma.paymentIntent.update({ where: { id: f.intent.id }, data: patches[invalid] });
  await assert.rejects(chat.reconcile(input()));
  assert.equal((await prisma.checkoutChatRequest.findFirstOrThrow()).status, "unknown");
  assert.equal(await prisma.checkoutChatPaymentResolution.count(), 0);
});

integration("a recovered receipt cannot expose credentials after a customer changes the purchase", async () => {
  const f = await interrupted(); await chat.reconcile(input());
  await prisma.checkoutSession.updateMany({ where: { merchantId: "store" }, data: { globalUserId: "another-buyer" } });
  assert.equal((await chat.readState("store", "session")).payment_intent_id, undefined);
  await assert.rejects(chat.readPayment("store", "session", f.intent.id));
});

integration("the production builder and financial recovery service share the exact chat payment identity", async () => {
  await seed(); let f!: Awaited<ReturnType<typeof financial>>;
  const builder = new ChatResponseBuilder(repo, undefined, { async execute(request: any) {
    const session = (await repo.getSession("store", "session"))!;
    assert.equal(session.paymentMethod, "pix");
    const row = await prisma.checkoutChatRequest.findFirstOrThrow();
    assert.equal(request.idempotency_key, `chat:${row.id}`);
    f = await financial(session, row.id, "pix");
    throw new Error("lost after persisted financial completion");
  } } as any);
  await assert.rejects(chat.run(input(), noop, async (request, claim) => builder.build({ merchantId: "store", sessionId: "session",
    session: (await repo.getSession("store", "session"))!, reply: { message: response().message, objection: "unknown" },
    safeMessage: response().message, userMessage: request.user_message, offer: SafeAuthorizedOffer.noOffer("store", "session"),
    merchant: { id: "store" }, rules: DEFAULT_MERCHANT_RULES, stage: "payment", previousStage: "payment", missingFields: [],
    isHoldout: false, preSearchedProducts: [], chatRequest: claim,
  })));
  await chat.reconcile(input());
  assert.equal((await chat.readPayment("store", "session", f.intent.id)).status, "requires_action");
  assert.deepEqual(f.counts(), { creates: 1, recoveries: 0 });
  assert.equal((await repo.getSession("store", "session"))!.chatHistory.length, 2);
});
