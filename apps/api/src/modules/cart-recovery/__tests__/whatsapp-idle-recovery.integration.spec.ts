import assert from "node:assert/strict";
import test, { after, type TestContext } from "node:test";
import { createHash, randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { createPrismaClient } from "../../../shared/persistence/prisma-client.js";
import { RecoveryScannerJob } from "../infrastructure/jobs/recovery-scanner.job.js";
import { PrismaCheckoutRepository } from "../../checkout/infrastructure/prisma/prisma-checkout.repository.js";
import { InMemoryRecoveryAttemptRepository } from "../infrastructure/repositories/in-memory-recovery-attempt.repository.js";
import { InMemoryBuyerPurchaseHistoryRepository } from "../../buyer-purchase-history/infrastructure/in-memory-buyer-purchase-history.repository.js";
import { CheckoutSettingsEntity } from "../../checkout-settings/domain/entities/checkout-settings.entity.js";
import { PrismaCheckoutSettingsRepository } from "../../checkout-settings/infrastructure/prisma-checkout-settings.repository.js";
import { checkoutSession, merchantRules } from "../../checkout/__tests__/checkout-test-fixtures.js";

// Isolated disposable DB only. Never inherit a remote DATABASE_URL.
const db = createPrismaClient("postgresql://postgres@127.0.0.1:15565/athom_qa");
after(async () => { await db.$disconnect(); });

async function fixture(t: TestContext, options: { idleSeconds?: number; ageSeconds?: number; suppress?: string } = {}) {
  t.mock.method(Math, "random", () => 0);
  const merchantId = "qa_athom_idle_" + randomUUID(), sessionId = "conv_" + randomUUID(), deviceId = "META_CLOUD:" + randomUUID();
  const old = new Date(Date.now() - (options.ageSeconds ?? 600) * 1000), now = new Date();
  const domain = checkoutSession({ merchantId, sessionId, conversationId: sessionId, abandonmentScore: 0.05,
    updatedAt: old.toISOString(), createdAt: old.toISOString() });
  await db.merchant.create({ data: { id: merchantId, name: "Owned idle QA" } });
  t.after(async () => {
    assert.ok(merchantId.startsWith("qa_athom_idle_"));
    await db.whatsAppWebhookInbox.deleteMany({ where: { merchantId } });
    await db.whatsAppSession.deleteMany({ where: { OR: [{ merchantId }, { checkoutSessionId: sessionId }] } });
    await db.paymentIntent.deleteMany({ where: { merchantId } });
    await db.completedOrder.deleteMany({ where: { merchantId } });
    await db.checkoutSession.deleteMany({ where: { merchantId } });
    await db.checkoutSetting.deleteMany({ where: { merchantId } });
    await db.merchant.delete({ where: { id: merchantId } });
  });
  await db.checkoutSession.create({ data: { merchantId, sessionId, globalUserId: domain.globalUserId,
    conversationId: sessionId, cart: JSON.parse(JSON.stringify(options.suppress === "empty_cart" ? { ...domain.cart, items: [] } : domain.cart)),
    abandonmentScore: 0.05, triggerAgent: false, createdAt: old,
    updatedAt: options.suppress === "checkout_activity" ? now : old } });
  const whatsapp = await db.whatsAppSession.create({ data: { merchantId: options.suppress === "foreign_tenant" ? "foreign_" + merchantId : merchantId,
    checkoutSessionId: sessionId, deviceId, buyerPhone: "5511000000000", status: options.suppress === "handoff" ? "handoff" : "active",
    lastActivityAt: options.suppress === "buyer_activity" ? now : old,
    conversationState: { version: 1, stage: "shopping", conversationId: sessionId, checkoutSessionId: sessionId } } });
  if (options.idleSeconds) await new PrismaCheckoutSettingsRepository(db).save(CheckoutSettingsEntity.createDefault({ merchantId })
    .update({ interventionPolicy: { idleSeconds: options.idleSeconds } }).snapshot());
  if (options.suppress === "completed_order") await db.completedOrder.create({ data: { merchantId, sessionId,
    externalOrderId: "qa-order-" + randomUUID(), orderTotal: 300, currency: "BRL", completedAt: now } });
  if (options.suppress === "approved_payment") await db.paymentIntent.create({ data: { id: randomUUID(), merchantId, sessionId,
    idempotencyKey: randomUUID(), amountCents: 30000, currency: "BRL", method: "pix", status: "approved" } });
  if (["pending_message", "processing_message"].includes(options.suppress ?? "")) {
    const streamKey = createHash("sha256").update(JSON.stringify([merchantId, deviceId.slice(11), "message", whatsapp.buyerPhone])).digest("hex");
    await db.whatsAppWebhookInbox.create({ data: { dedupKey: randomUUID(), eventId: randomUUID(), kind: "message",
      merchantId, configId: deviceId.slice(11), deviceId, streamKey, payload: {}, payloadHash: "synthetic-owned-qa",
      status: options.suppress === "pending_message" ? "pending" : "processing" } });
  }
  const delegated: any[] = [];
  const scannerWith = (database: PrismaClient) => new RecoveryScannerJob(new PrismaCheckoutRepository(database), new InMemoryRecoveryAttemptRepository(),
    { getRules: async () => merchantRules(), updateRules: async () => merchantRules() },
    { getConfig: async () => ({ active_strategy: "offer_coupon", coupon_code: "QA_IDLE" }) } as never,
    new InMemoryBuyerPurchaseHistoryRepository(), database,
    { execute: async input => { delegated.push(input); return { created: false }; } });
  const scanner = scannerWith(db);
  return { merchantId, sessionId, old, whatsapp, scanner, scannerWith, delegated,
    events: () => db.checkoutEvent.findMany({ where: { merchantId, sessionId, eventName: "idle_30_seconds" } }),
    session: () => db.checkoutSession.findUniqueOrThrow({ where: { merchantId_sessionId: { merchantId, sessionId } } }) };
}

test("Meta silence qualifies its scoped cart without resetting the activity clock", async t => {
  const f = await fixture(t); await f.scanner.scan();
  const session = await f.session(), events = await f.events();
  assert.equal(events.length, 1);
  assert.equal(session.abandonmentScore, 0.05 + 0.55);
  assert.equal(session.triggerAgent, true);
  assert.equal(session.updatedAt.toISOString(), f.old.toISOString());
  assert.equal((events[0].metadata as any).source, "whatsapp_idle");
  assert.equal(f.delegated.length, 1);
  assert.equal(f.delegated[0].merchantId, f.merchantId);
  assert.equal(f.delegated[0].sessionId, f.sessionId);
});

test("concurrent Meta idle scans persist one signal for the same activity period", async t => {
  const f = await fixture(t); await Promise.all([f.scanner.scan(), f.scanner.scan()]); await f.scanner.scan();
  assert.equal((await f.events()).length, 1);
  assert.equal((await f.session()).abandonmentScore, 0.05 + 0.55);
});

test("saved Meta idle duration qualifies601 seconds but rejects400 seconds", async t => {
  const f = await fixture(t, { idleSeconds: 600, ageSeconds: 400 }); await f.scanner.scan();
  assert.equal((await f.events()).length, 0); assert.equal(f.delegated.length, 0);
  const older = new Date(Date.now() - 601000);
  await db.whatsAppSession.update({ where: { id: f.whatsapp.id }, data: { lastActivityAt: older } });
  await db.checkoutSession.update({ where: { merchantId_sessionId: { merchantId: f.merchantId, sessionId: f.sessionId } }, data: { updatedAt: older } });
  await f.scanner.scan(); assert.equal((await f.events()).length, 1);
});

for (const suppress of ["buyer_activity", "checkout_activity", "empty_cart", "foreign_tenant", "handoff", "completed_order", "approved_payment", "pending_message", "processing_message"])
  test("Meta idle suppresses " + suppress, async t => {
    const f = await fixture(t, { suppress }); await f.scanner.scan();
    assert.equal((await f.events()).length, 0);
    assert.equal((await f.session()).triggerAgent, false);
    assert.equal(f.delegated.length, 0);
  });

for (const change of ["resume", "handoff"])
  test("Meta dispatch revalidates current " + change + " after qualification", async t => {
    const f = await fixture(t); await f.scanner.scan(); assert.equal(f.delegated.length, 1);
    await db.whatsAppSession.update({ where: { id: f.whatsapp.id }, data: change === "resume" ? { lastActivityAt: new Date() } : { status: "handoff", lastActivityAt: f.old } });
    await f.scanner.scan(); assert.equal(f.delegated.length, 1);
  });

test("Meta idle lookup failure preserves existing measured recoveries", async t => {
  const f = await fixture(t);
  await db.checkoutSession.update({ where: { merchantId_sessionId: { merchantId: f.merchantId, sessionId: f.sessionId } },
    data: { triggerAgent: true, abandonmentScore: 0.8 } });
  await db.checkoutEvent.create({ data: { merchantId: f.merchantId, sessionId: f.sessionId,
    eventName: "shipping_objection_detected", occurredAt: f.old } });
  const unavailable = new Proxy(db, { get(target, key) {
    if (key === "$queryRaw") return async () => { throw Error("synthetic WhatsApp measurement unavailable"); };
    const value = Reflect.get(target, key); return typeof value === "function" ? value.bind(target) : value;
  } });
  await f.scannerWith(unavailable).scan();
  assert.equal(f.delegated.length, 1);
});

for (const backlog of ["completed_orders", "longer_policy"])
  test("Meta candidate limit does not starve eligible carts behind " + backlog, async t => {
    const f = await fixture(t);
    if (backlog === "longer_policy") {
      const slow = await fixture(t, { idleSeconds: 3600, ageSeconds: 1200 });
      await db.whatsAppSession.createMany({ data: Array.from({ length: 99 }, () => ({ merchantId: slow.merchantId,
        checkoutSessionId: slow.sessionId, deviceId: "META_CLOUD:" + randomUUID(), buyerPhone: "5511000000000",
        status: "active", lastActivityAt: slow.old })) });
    } else {
      const old = new Date(Date.now() - 1200000);
      const sessions = Array.from({ length: 100 }, () => "conv_closed_" + randomUUID());
      await db.checkoutSession.createMany({ data: sessions.map(sessionId => ({ merchantId: f.merchantId, sessionId,
        conversationId: sessionId, globalUserId: "qa-user", cart: { items: [{ sku: "qa", quantity: 1 }], total: 1 },
        abandonmentScore: 0.05, triggerAgent: false, createdAt: old, updatedAt: old })) });
      await db.whatsAppSession.createMany({ data: sessions.map(checkoutSessionId => ({ merchantId: f.merchantId,
        checkoutSessionId, deviceId: "META_CLOUD:" + randomUUID(), buyerPhone: "5511000000000", status: "active", lastActivityAt: old })) });
      await db.completedOrder.createMany({ data: sessions.map(sessionId => ({ merchantId: f.merchantId, sessionId,
        externalOrderId: randomUUID(), orderTotal: 1, currency: "BRL", completedAt: old })) });
    }
    await f.scanner.scan();
    assert.equal((await f.events()).length, 1);
  });
