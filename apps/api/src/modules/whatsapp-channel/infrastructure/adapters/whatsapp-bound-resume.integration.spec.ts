import "reflect-metadata";
import test, { after, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createPrismaClient } from "../../../../shared/persistence/prisma-client.js";
import { PrismaCheckoutRepository } from "../../../checkout/infrastructure/prisma/prisma-checkout.repository.js";
import { PrismaPaymentRepository } from "../../../payment/infrastructure/prisma-payment.repository.js";
import { PrismaWhatsAppSessionRepository } from "../repositories/prisma-whatsapp-session.repository.js";
import { RouteToSessionUseCase } from "../../application/use-cases/route-to-session.use-case.js";
import { WhatsAppCheckoutIdentityService } from "../../application/services/whatsapp-checkout-identity.service.js";
import { CheckoutWhatsAppConversationAdapter } from "./checkout-whatsapp-conversation.adapter.js";
import { RecoveryScannerJob } from "../../../cart-recovery/infrastructure/jobs/recovery-scanner.job.js";
import { checkoutSession } from "../../../checkout/__tests__/checkout-test-fixtures.js";
import { buildMetaUiView } from "../../domain/ui/meta-ui-renderer.js";

const db = createPrismaClient("postgresql://postgres@127.0.0.1:15565/athom_qa");
after(async () => db.$disconnect());

async function fixture(t: TestContext) {
  const merchantId = "qa_bound_resume_" + randomUUID(), cartRef = randomUUID(), phone = "5511000000000";
  await db.merchant.create({ data: { id: merchantId, name: "Bound resume QA" } });
  t.after(async () => {
    assert.ok(merchantId.startsWith("qa_bound_resume_"));
    await db.whatsAppWebhookInbox.deleteMany({ where: { merchantId } });
    await db.paymentIntent.deleteMany({ where: { merchantId } });
    await db.whatsAppSession.deleteMany({ where: { merchantId } });
    await db.checkoutSession.deleteMany({ where: { merchantId } });
    await db.storefrontCart.deleteMany({ where: { merchantId } });
    await db.buyerIdentity.deleteMany({ where: { merchantId } });
    await db.merchant.delete({ where: { id: merchantId } });
  });
  const config = await db.whatsAppChannelConfig.create({ data: { merchantId, enabled: true, status: "ACTIVE", provider: "META_CLOUD" } });
  const deviceId = "META_CLOUD:" + config.id, leaseToken = randomUUID();
  const session = checkoutSession({ merchantId, sessionId: randomUUID(), conversationId: randomUUID(), globalUserId: "original-guest",
    cart: { currency: "BRL", total: 139.8, cart_ref: cartRef, items: [{ sku: "mouse", name: "Mouse", quantity: 2, price: 69.9, type: "digital" }] },
    customer: { fullName: "QA Buyer", email: "qa@example.test", email_verified: true, phone, phone_verified: true }, shipping: undefined });
  const sessions = new PrismaCheckoutRepository(db);
  await sessions.saveSession(session);
  await db.storefrontCart.create({ data: { merchantId, sessionId: cartRef, items: [{ productId: "mouse", variantId: "white", sku: "mouse", name: "Mouse", quantity: 2, unitPriceCents: 6990 }], total: 13980, expiresAt: new Date(Date.now() + 48 * 3600_000) } });
  await db.buyerIdentity.create({ data: { merchantId, identityKey: "phone:" + phone, globalUserId: "phone-only-identity" } });
  await db.whatsAppSession.create({ data: { merchantId, deviceId, buyerPhone: phone, checkoutSessionId: session.sessionId,
    status: "active", lastActivityAt: new Date(Date.now() - 25 * 3600_000),
    conversationState: { version: 1, conversationId: cartRef, stage: "checkout", checkoutSessionId: session.sessionId, history: [] } } });
  const intent = await db.paymentIntent.create({ data: { id: randomUUID(), merchantId, sessionId: session.sessionId,
    idempotencyKey: randomUUID(), amountCents: 13980, currency: "BRL", method: "pix", status: "pending", buyerFacing: { qrCodeCopyPaste: "ORIGINAL-LOCAL-PIX" } } });
  const inbox = await db.whatsAppWebhookInbox.create({ data: { dedupKey: randomUUID(), eventId: randomUUID(), kind: "message",
    merchantId, configId: config.id, deviceId, streamKey: randomUUID(), payload: { provider: "META_CLOUD", fromNumber: phone },
    payloadHash: "qa", status: "processing", leaseToken, leaseExpiresAt: new Date(Date.now() + 300_000) } });
  const before = await db.checkoutSession.findUniqueOrThrow({ where: { merchantId_sessionId: { merchantId, sessionId: session.sessionId } } });
  const scanner = new RecoveryScannerJob(sessions, {} as any, {} as any, {} as any, {} as any, db, {} as any);
  // No queued input was present when the old conversation first became eligible.
  await db.whatsAppWebhookInbox.update({ where: { id: inbox.id }, data: { status: "processed" } });
  assert.equal(await (scanner as any).isStillEligible(session), true);
  await db.whatsAppWebhookInbox.update({ where: { id: inbox.id }, data: { status: "processing" } });
  const route = new RouteToSessionUseCase(new PrismaWhatsAppSessionRepository(db), db);
  const routed = await route.execute({ merchantId, deviceId, fromNumber: phone });
  const state = routed.whatsappSession.conversationState!;
  assert.equal(state.checkoutSessionId, session.sessionId); assert.equal(state.recoveredCheckout, true);
  const forbidden = async () => { assert.fail("resumption cannot create, cancel, or replace checkout/payment"); };
  const args: any[] = [];
  args[0] = { execute: forbidden }; args[1] = sessions;
  args[2] = { execute: async () => ({ message: "Finalizar", blocks: [{ type: "checkout_prepared", data: {} }], suggested_next: [] }) };
  args[3] = { executeForMerchant: async () => ({ name: "QA", agentTone: "direct" }) };
  args[4] = { execute: forbidden }; args[7] = { resolveStorefront: forbidden }; args[8] = { execute: forbidden };
  args[9] = { execute: async () => ({ status: "pending" }) }; args[10] = db;
  args[11] = new WhatsAppCheckoutIdentityService({ findRegisteredByPhones: async () => [] } as any, db);
  args[13] = { execute: forbidden }; args[15] = new PrismaPaymentRepository(db);
  const adapter = new (CheckoutWhatsAppConversationAdapter as any)(...args) as CheckoutWhatsAppConversationAdapter;
  const input = { merchantId, buyer: { globalUserId: "phone-only-identity", phone }, message: "Finalizar compra", state,
    action: { kind: "tool" as const, tool: "checkout", args: {} }, verifiedSender: { inboxId: inbox.id, leaseToken, deviceId, fromNumber: phone } };
  const unchanged = async () => {
    assert.deepEqual(await db.checkoutSession.findUniqueOrThrow({ where: { id: before.id } }), before);
    assert.deepEqual(await db.paymentIntent.findUniqueOrThrow({ where: { id: intent.id } }), intent);
    assert.equal(await db.checkoutSession.count({ where: { merchantId } }), 1);
    assert.equal(await db.paymentIntent.count({ where: { merchantId } }), 1);
    assert.equal(await db.completedOrder.count({ where: { merchantId } }), 0);
  };
  return { merchantId, config, inbox, session, intent, input, adapter, unchanged, scanner };
}

test("AC3/AC5 renewed checkout continuation preserves exact purchase/payment and canonical edit controls", async t => {
  const f = await fixture(t);
  const response = await f.adapter.respondStore(f.input);
  assert.equal(response.state.checkoutSessionId, f.session.sessionId);
  assert.equal(response.state.checkoutConversationId, f.session.conversationId);
  assert.equal(response.state.stage, "checkout");
  assert.deepEqual(response.state.payment, { intentId: f.intent.id, sessionId: f.session.sessionId, status: "pending", amount_cents: 13980,
    method: "pix", copy_paste: "ORIGINAL-LOCAL-PIX", ticket_url: undefined });
  const summary = response.blocks.find(b => b.type === "checkout_summary");
  assert.ok(summary); assert.match(JSON.stringify(summary.data), /Mouse/); assert.match(JSON.stringify(summary.data), /139\.8/);
  const view = buildMetaUiView(response);
  assert.ok(view.choices.some(c => c.action.kind === "tool" && c.action.tool === "edit_checkout"), JSON.stringify({blocks:response.blocks, choices:view.choices}));
  await f.unchanged();
  await db.whatsAppWebhookInbox.update({ where: { id: f.inbox.id }, data: { status: "processed" } });
  assert.equal(await (f.scanner as any).isStillEligible(f.session), false);
  await db.whatsAppWebhookInbox.update({ where: { id: f.inbox.id }, data: { status: "processing" } });
  // Explicit resume within checkout also uses persistence without a new start.
  const again = await f.adapter.respondStore({ ...f.input, state: response.state, action: { kind: "tool", tool: "show_checkout", args: {} } });
  assert.equal(again.state.payment?.intentId, f.intent.id); await f.unchanged();
});

for (const variant of ["missing_proof", "lease", "expired_lease", "processed", "sender", "payload", "config", "merchant", "phone", "cart", "checkout_conversation"])
  test("AC4 recovered checkout rejects invalid " + variant + " before exposing or replacing the purchase", async t => {
    const f = await fixture(t), input: any = structuredClone(f.input);
    if (variant === "missing_proof") delete input.verifiedSender;
    if (variant === "lease") input.verifiedSender.leaseToken = randomUUID();
    if (variant === "expired_lease") await db.whatsAppWebhookInbox.update({ where: { id: f.inbox.id }, data: { leaseExpiresAt: new Date(0) } });
    if (variant === "processed") await db.whatsAppWebhookInbox.update({ where: { id: f.inbox.id }, data: { status: "processed" } });
    if (variant === "sender") input.verifiedSender.fromNumber = "5511999999999";
    if (variant === "payload") await db.whatsAppWebhookInbox.update({ where: { id: f.inbox.id }, data: { payload: { provider: "BUBBLEWHATS", fromNumber: input.buyer.phone } } });
    if (variant === "config") await db.whatsAppChannelConfig.update({ where: { id: f.config.id }, data: { enabled: false } });
    if (variant === "merchant") input.merchantId = "other-merchant";
    if (variant === "phone") input.buyer.phone = "5511999999999";
    if (variant === "cart") input.state.conversationId = randomUUID();
    if (variant === "checkout_conversation") input.state.checkoutConversationId = randomUUID();
    await assert.rejects(f.adapter.respondStore(input), /whatsapp_recovered_checkout_owner_required/);
    await f.unchanged();
  });

for (const variant of ["reassigned", "expired", "deleted", "empty"])
  test("AC4 canonical cart " + variant + " after renewal cannot expose the recovered purchase", async t => {
    const f = await fixture(t), where = { merchantId_sessionId: { merchantId: f.merchantId, sessionId: f.input.state.conversationId } };
    if (variant === "reassigned") {
      const foreign = "qa_bound_resume_" + randomUUID();
      await db.merchant.create({ data: { id: foreign, name: "Foreign QA" } });
      t.after(() => db.merchant.delete({ where: { id: foreign } }));
      await db.storefrontCart.update({ where, data: { merchantId: foreign } });
    }
    if (variant === "expired") await db.storefrontCart.update({ where, data: { expiresAt: new Date() } });
    if (variant === "deleted") await db.storefrontCart.delete({ where });
    if (variant === "empty") await db.storefrontCart.update({ where, data: { items: [] } });
    await assert.rejects(f.adapter.respondStore(f.input), /whatsapp_recovered_checkout_owner_required/);
    await f.unchanged();
  });
