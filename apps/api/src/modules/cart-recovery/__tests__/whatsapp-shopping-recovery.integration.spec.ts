import assert from "node:assert/strict";
import test, { after, type TestContext } from "node:test";
import { createHash, randomUUID } from "node:crypto";
import { createPrismaClient } from "../../../shared/persistence/prisma-client.js";
import { CheckoutWhatsAppConversationAdapter } from "../../whatsapp-channel/infrastructure/adapters/checkout-whatsapp-conversation.adapter.js";
import { WhatsAppBuyerHubService } from "../../whatsapp-channel/application/services/whatsapp-buyer-hub.service.js";
import { PrismaStorefrontTelemetryRepository } from "../../storefront/infrastructure/repositories/prisma-storefront-telemetry.repository.js";
import { PrismaStorefrontCartRepository } from "../../storefront/infrastructure/repositories/prisma-storefront-cart.repository.js";
import { RecoveryScannerJob } from "../infrastructure/jobs/recovery-scanner.job.js";
import { PrismaCheckoutRepository } from "../../checkout/infrastructure/prisma/prisma-checkout.repository.js";
import { InMemoryRecoveryAttemptRepository } from "../infrastructure/repositories/in-memory-recovery-attempt.repository.js";
import { InMemoryBuyerPurchaseHistoryRepository } from "../../buyer-purchase-history/infrastructure/in-memory-buyer-purchase-history.repository.js";
import { merchantRules } from "../../checkout/__tests__/checkout-test-fixtures.js";

const db = createPrismaClient("postgresql://postgres@127.0.0.1:15565/athom_qa");
after(async () => { await db.$disconnect(); });
const canonicalItems = [{ productId: "qa-product", variantId: "qa-variant", sku: "qa-mouse", name: "QA Mouse", quantity: 1, unitPriceCents: 6990 }];

async function fixture(t: TestContext) {
  t.mock.method(Math, "random", () => 0);
  const merchantId = "qa_athom_shopping_" + randomUUID(), conversationId = randomUUID(), globalUserId = "qa_buyer_" + randomUUID();
  const phone = "5511000000000", deviceId = "META_CLOUD:" + randomUUID(), old = new Date(Date.now() - 601000);
  const cart = { items: canonicalItems };
  await db.merchant.create({ data: { id: merchantId, name: "Owned native shopping QA" } });
  await db.storefrontCart.create({ data: { merchantId, sessionId: conversationId, items: cart.items, total: 6990, expiresAt: new Date(Date.now() + 3600000) } });
  const state = { version: 1, stage: "store", conversationId, history: [], revision: "", previousViews: [], page: 0 };
  const wa = await db.whatsAppSession.create({ data: { merchantId, buyerPhone: phone, deviceId, conversationState: state, status: "active", lastActivityAt: old } });
  t.after(async () => {
    assert.ok(merchantId.startsWith("qa_athom_shopping_"));
    await db.whatsAppWebhookInbox.deleteMany({ where: { merchantId } });
    await db.whatsAppSession.deleteMany({ where: { merchantId } });
    await db.checkoutSession.deleteMany({ where: { merchantId } });
    await db.storefrontCart.deleteMany({ where: { merchantId } });
    await db.merchant.delete({ where: { id: merchantId } });
  });
  const args: any[] = Array(24).fill(undefined);
  args[0] = {}; args[1] = new PrismaCheckoutRepository(db);
  args[2] = { execute: async () => ({ message: "Seu carrinho", blocks: [{ type: "cart_summary", data: { items: cart.items } }], suggested_next: [] }) };
  args[3] = { executeForMerchant: async () => ({ name: "Owned native shopping QA", quickReplies: [] }) };
  args[4] = { execute: async () => { assert.fail("shopping telemetry must not start checkout"); } };
  args[10] = db;
  args[23] = new PrismaStorefrontTelemetryRepository(db, new PrismaStorefrontCartRepository(db));
  const adapter = new (CheckoutWhatsAppConversationAdapter as any)(...args) as CheckoutWhatsAppConversationAdapter;
  const input: any = { merchantId, buyer: { globalUserId, phone }, message: "Ver carrinho", state,
    verifiedSender: { inboxId: randomUUID(), leaseToken: randomUUID(), deviceId, fromNumber: phone } };
  const delegated: any[] = [];
  const scanner = new RecoveryScannerJob(new PrismaCheckoutRepository(db), new InMemoryRecoveryAttemptRepository(),
    { getRules: async () => merchantRules(), updateRules: async () => merchantRules() },
    { getConfig: async () => ({ active_strategy: "offer_coupon", coupon_code: "QA_IDLE" }) } as never,
    new InMemoryBuyerPurchaseHistoryRepository(), db, { execute: async value => { delegated.push(value); return { created: false }; } });
  return { args, merchantId, conversationId, globalUserId, phone, deviceId, old, state, wa, adapter, input, scanner, delegated,
    projection: () => db.checkoutSession.findUnique({ where: { merchantId_sessionId: { merchantId, sessionId: conversationId } } }),
    events: () => db.checkoutEvent.findMany({ where: { merchantId, sessionId: conversationId, eventName: "idle_30_seconds" } }),
    age: async () => { await db.checkoutSession.update({ where: { merchantId_sessionId: { merchantId, sessionId: conversationId } }, data: { updatedAt: old } }); } };
}

test("verified native shopping projects the canonical cart without starting or binding a checkout", async t => {
  const f = await fixture(t), response = await f.adapter.respondStore(f.input), p = await f.projection();
  assert.ok(p); assert.equal(p.globalUserId, f.globalUserId); assert.equal(p.sessionId, f.conversationId);
  assert.deepEqual((p.cart as any).items, canonicalItems);
  assert.equal(response.state.stage, "store"); assert.equal(response.state.checkoutSessionId, undefined);
  assert.equal((await db.whatsAppSession.findUniqueOrThrow({ where: { id: f.wa.id } })).checkoutSessionId, null);
  assert.equal(await db.paymentIntent.count({ where: { merchantId: f.merchantId } }), 0);
  assert.equal(await db.campaignContactConsent.count({ where: { merchantId: f.merchantId } }), 0);
});

test("recognized native shopper is retained in both storefront routing and recovery persistence", async t => {
  const f = await fixture(t), recognizedId = "qa_verified_" + randomUUID(), routedIds: string[] = [];
  (f.adapter as any).checkoutIdentity = { recognize: async () => ({ status: "recognized", buyer: {
    merchantId: f.merchantId, conversationId: f.conversationId, globalUserId: recognizedId,
    customer: { fullName: "Owned recognized buyer", phone: f.phone, phone_verified: true, email: "owned@example.test", email_verified: true },
  } }) };
  f.args[2].execute = async (input: any) => { routedIds.push(input.global_user_id); return { message: "Canonical cart", blocks: [], suggested_next: [] }; };
  await f.adapter.respondStore(f.input);
  assert.deepEqual(routedIds, [recognizedId]);
  assert.equal((await f.projection())!.globalUserId, recognizedId);
});

test("recognized protected hub reply retains its resolved account in recovery persistence", async t => {
  const f = await fixture(t), recognizedId = "qa_verified_hub_" + randomUUID();
  const account = { globalUserId: recognizedId, phone: f.phone, displayName: "Owned hub buyer", email: "owned@example.test" };
  const identity = { recognize: async () => ({ status: "recognized", owner: {
    merchantId: f.merchantId, conversationId: f.conversationId, phone: f.phone }, buyer: {
      merchantId: f.merchantId, conversationId: f.conversationId, globalUserId: recognizedId, customer: { phone: f.phone } } }) };
  (f.adapter as any).buyerHub = new WhatsAppBuyerHubService(identity as any,
    { findByGlobalUserId: async (id: string) => id === recognizedId ? account : null } as any, {} as any);
  const response = await f.adapter.respondStore({ ...f.input, message: "/dados" });
  assert.match(response.agentMessage, /Owned hub buyer/);
  assert.equal((await f.projection())!.globalUserId, recognizedId);
});

for (const variant of ["missing_proof", "foreign_phone", "other_provider", "expired", "missing_cart", "bound_checkout"]) {
  test(`native shopping does not project ${variant}`, async t => {
    const f = await fixture(t);
    if (variant === "missing_proof") delete f.input.verifiedSender;
    if (variant === "foreign_phone") f.input.verifiedSender.fromNumber = "5511999999999";
    if (variant === "other_provider") f.input.verifiedSender.deviceId = "BUBBLEWHATS:config";
    if (variant === "expired") await db.storefrontCart.updateMany({ where: { merchantId: f.merchantId }, data: { expiresAt: new Date(0) } });
    if (variant === "missing_cart") await db.storefrontCart.deleteMany({ where: { merchantId: f.merchantId } });
    if (variant === "bound_checkout") f.input.state.checkoutSessionId = "bound";
    await f.adapter.respondStore(f.input); assert.equal(await f.projection(), null);
  });
}

test("unbound native shopping silence qualifies once and preserves activity", async t => {
  const f = await fixture(t); await f.adapter.respondStore(f.input); await f.age();
  await Promise.all([f.scanner.scan(), f.scanner.scan()]);
  const p = await f.projection(); assert.ok(p); assert.equal(p.triggerAgent, true);
  assert.equal(p.updatedAt.toISOString(), f.old.toISOString()); assert.equal((await f.events()).length, 1);
  assert.equal(f.delegated.length, 2); assert.equal(f.delegated[0].sessionId, f.conversationId);
});

for (const variant of ["empty", "expired", "handoff", "pending", "superseded_checkout"]) {
  test(`unbound native shopping suppresses ${variant} before dispatch`, async t => {
    const f = await fixture(t); await f.adapter.respondStore(f.input); await f.age();
    if (variant === "empty") await db.storefrontCart.updateMany({ where: { merchantId: f.merchantId }, data: { items: [] } });
    if (variant === "expired") await db.storefrontCart.updateMany({ where: { merchantId: f.merchantId }, data: { expiresAt: new Date(0) } });
    if (variant === "handoff") await db.whatsAppSession.update({ where: { id: f.wa.id }, data: { status: "handoff" } });
    if (variant === "pending") await db.whatsAppWebhookInbox.create({ data: { dedupKey: randomUUID(), eventId: randomUUID(), kind: "message", merchantId: f.merchantId,
      configId: f.deviceId.slice(11), deviceId: f.deviceId, streamKey: createHash("sha256").update(JSON.stringify([f.merchantId, f.deviceId.slice(11), "message", f.phone])).digest("hex"), payload: {}, payloadHash: "owned", status: "pending" } });
    if (variant === "superseded_checkout") await db.whatsAppSession.update({ where: { id: f.wa.id }, data: { checkoutSessionId: "new-checkout" } });
    await f.scanner.scan(); assert.equal(f.delegated.length, 0);
    await db.checkoutSession.update({ where: { merchantId_sessionId: { merchantId: f.merchantId, sessionId: f.conversationId } }, data: { triggerAgent: true, abandonmentScore: 0.8 } });
    await f.scanner.scan(); assert.equal(f.delegated.length, 0);
  });
}
