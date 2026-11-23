import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { RecoveryAttempt } from "../domain/entities/recovery-attempt.entity.js";
import { PrismaRecoveryAttemptRepository } from "../infrastructure/repositories/prisma-recovery-attempt.repository.js";
import { PrismaRecoveryTemplateLifecycleRepository } from "../../whatsapp-templates/infrastructure/repositories/prisma-recovery-template-lifecycle.repository.js";
import { RecoveryFollowUpJob } from "../infrastructure/jobs/recovery-follow-up.job.js";
import { RecoveryScannerJob } from "../infrastructure/jobs/recovery-scanner.job.js";

// This suite cannot connect to a deployment or inherit DATABASE_URL.
const url = "postgresql://recovery_test:recovery_local_test@127.0.0.1:15439/recovery_test";
const firstSentAt = new Date("2026-11-23T15:00:00.000Z");
const hour = 3_600_000;

test("recovery reliability on disposable PostgreSQL", async t => {
  const db = new PrismaClient({ datasources: { db: { url } } });
  const owned: string[] = [];
  const fixtures: string[] = [];
  t.beforeEach(async () => {
    await db.recoveryFollowUp.updateMany({ where: { merchantId: { in: owned }, status: "pending" }, data: { status: "cancelled", reason: "fixture_closed" } });
  });
  const create = async (options: { legacy?: boolean; expiredCart?: boolean; realEligibility?: boolean } = {}) => {
    const merchantId = `recovery-test-${randomUUID()}`;
    owned.push(merchantId);
    const sessionId = randomUUID(), attemptId = `rec_test_${randomUUID()}`, buyerId = `buyer_test_${randomUUID()}`;
    fixtures.push(attemptId);
    const activity = new Date(firstSentAt.getTime() - 5 * 60_000);
    const cart = { items: [{ sku: "item-a", quantity: 1 }], cart_ref: sessionId };
    await db.merchant.create({ data: { id: merchantId, name: "Test Store" } });
    await db.checkoutSession.create({ data: { merchantId, sessionId, globalUserId: buyerId, conversationId: sessionId,
      cart, abandonmentScore: 0.67, triggerAgent: true, createdAt: activity, updatedAt: activity } });
    await db.storefrontCart.create({ data: { merchantId, sessionId, items: cart.items,
      expiresAt: new Date(firstSentAt.getTime() + (options.expiredCart ? -1 : 72 * hour - 5 * 60_000)) } });
    const attempt = new RecoveryAttempt({ id: attemptId, merchantId, sessionId, globalUserId: buyerId,
      abandonmentReason: "hesitation", abandonmentScore: 0.67, strategy: { type: "personalized_cross_sell", suggested_skus: [] },
      channel: "none", sentAt: null, status: "pending", recoveredAt: null, recoveredOrderId: null,
      createdAt: firstSentAt, lastBuyerActivityAt: options.legacy ? null : activity });
    const repository = new PrismaRecoveryAttemptRepository(db);
    assert.equal(await repository.createIfAbsent(attempt), true);
    await repository.save(attempt.withDeliveryMetadata({ providerMessageId: "email-first", fallbackReason: "provider_rate_limited" }).markSent(firstSentAt, "email"));
    const state = { contacts: 0, links: 0, eligible: true, consent: true, strategy: "personalized_cross_sell", outcome: "sent", resumeDuringSend: false,
      acceptGate: null as Promise<void> | null, onSendEntered: null as (() => void) | null };
    const sessions = { getSession: async () => db.checkoutSession.findUnique({ where: { merchantId_sessionId: { merchantId, sessionId } } }) };
    const buyers = { findByGlobalUserId: async () => ({ globalUserId: buyerId, displayName: "Ana", phone: "11999991111", email: "ana@example.test" }) };
    const sender = { execute: async (input: any) => {
      if (state.resumeDuringSend) await db.checkoutSession.update({ where: { merchantId_sessionId: { merchantId, sessionId } }, data: { updatedAt: new Date(firstSentAt.getTime() + hour) } });
      try { await input.assertDispatchAuthorized(); }
      catch { return { channel: "none", status: "skipped", reason: "notification_authority_changed" }; }
      state.onSendEntered?.();
      if (state.acceptGate) await state.acceptGate;
      state.contacts++;
      return { channel: "whatsapp_template", status: state.outcome, messageId: state.outcome === "sent" ? `wamid.${state.contacts}` : "", reason: state.outcome === "uncertain" ? "provider_acceptance_unknown" : undefined };
    } };
    const links = { execute: async () => `https://shop.example.test/recover/${++state.links}` };
    const scanner = new RecoveryScannerJob(sessions as any, {} as any, {} as any, {} as any, {} as any, db, {} as any);
    const job = (database: PrismaClient = db) => new RecoveryFollowUpJob(database, sessions as any, buyers as any,
      { canContact: async () => state.consent } as any, sender as any, links as any,
      { isStillEligible: async (session: any) => state.eligible && (!options.realEligibility || await scanner.isStillEligible(session)) } as any,
      { getConfig: async () => ({ active_strategy: state.strategy }) } as any);
    const steps = () => db.recoveryFollowUp.findMany({ where: { attemptId }, orderBy: { step: "asc" } });
    return { merchantId, sessionId, attemptId, buyerId, activity, attempt, repository, state, job, steps };
  };

  try {
    await t.test("first acceptance atomically persists diagnostics, exactly two due times and cart retention", async () => {
      const f = await create();
      const rows = await f.steps();
      assert.equal(rows.length, 2);
      assert.deepEqual(rows.map(r => r.dueAt.toISOString()), ["2026-11-24T15:00:00.000Z", "2026-11-26T15:00:00.000Z"]);
      assert.equal(rows[1].expiresAt.toISOString(), "2026-11-27T15:00:00.000Z");
      const persisted = await f.repository.findById(f.attemptId);
      assert.deepEqual(persisted?.deliveryMetadata, { providerMessageId: "email-first", fallbackReason: "provider_rate_limited" });
      const cart = await db.storefrontCart.findUniqueOrThrow({ where: { merchantId_sessionId: { merchantId: f.merchantId, sessionId: f.sessionId } } });
      assert.equal(cart.expiresAt.toISOString(), rows[1].expiresAt.toISOString());
      await f.repository.save(persisted!);
      assert.equal((await f.steps()).length, 2);
    });

    await t.test("historical attempts are not backfilled and expired carts are not revived", async () => {
      const legacy = await create({ legacy: true });
      assert.equal((await legacy.steps()).length, 0);
      const expired = await create({ expiredCart: true });
      const cart = await db.storefrontCart.findUniqueOrThrow({ where: { merchantId_sessionId: { merchantId: expired.merchantId, sessionId: expired.sessionId } } });
      assert.ok(cart.expiresAt < firstSentAt);
    });

    await t.test("scheduling failure rolls back the sent transition", async () => {
      const f = await create({ legacy: true });
      const pending = new RecoveryAttempt({ ...f.attempt.props, id: `rec_rollback_${randomUUID()}`, lastBuyerActivityAt: f.activity });
      fixtures.push(pending.id);
      await db.recoveryAttempt.create({ data: { id: pending.id, merchantId: f.merchantId, sessionId: f.sessionId, globalUserId: f.buyerId,
        abandonmentReason: "hesitation", abandonmentScore: 0.67, strategyJson: { type: "personalized_cross_sell" }, channel: "none", status: "pending", createdAt: firstSentAt } });
      const failing = { $transaction: (fn: any) => db.$transaction(tx => fn(new Proxy(tx, { get(target, key) {
        if (key === "recoveryFollowUp") return { createMany: async () => { throw Error("injected scheduling failure"); } };
        return Reflect.get(target, key);
      } }))) };
      await assert.rejects(new PrismaRecoveryAttemptRepository(failing as any).save(pending.markSent(firstSentAt, "email")), /injected scheduling failure/);
      assert.equal((await db.recoveryAttempt.findUniqueOrThrow({ where: { id: pending.id } })).status, "pending");
      assert.equal(await db.recoveryFollowUp.count({ where: { attemptId: pending.id } }), 0);
    });

    await t.test("24h and 72h each send once with fresh links; restarts never produce a fourth contact", async () => {
      const f = await create();
      await f.job().runOnce(new Date(firstSentAt.getTime() + 24 * hour - 1));
      assert.equal(f.state.contacts, 0);
      await f.job().runOnce(new Date(firstSentAt.getTime() + 24 * hour));
      assert.equal(f.state.contacts, 1);
      assert.deepEqual((await f.steps()).map(r => r.status), ["sent", "pending"]);
      await f.job().runOnce(new Date(firstSentAt.getTime() + 72 * hour));
      await f.job().runOnce(new Date(firstSentAt.getTime() + 80 * hour));
      assert.equal(f.state.contacts, 2);
      assert.equal(f.state.links, 2);
      assert.deepEqual((await f.steps()).map(r => r.providerMessageId), ["wamid.1", "wamid.2"]);
    });

    await t.test("two replicas arbitrate a due contact in PostgreSQL", { timeout: 10000 }, async () => {
      const f = await create();
      let release!: () => void, firstEntered!: () => void, secondEntered!: () => void, entered = 0;
      f.state.acceptGate = new Promise(resolve => { release = resolve; });
      const firstReady = new Promise<void>(resolve => { firstEntered = resolve; });
      const secondReady = new Promise<void>(resolve => { secondEntered = resolve; });
      f.state.onSendEntered = () => { if (++entered === 1) firstEntered(); else secondEntered(); };
      let releaseReads!: () => void, reads = 0;
      const bothRead = new Promise<void>(resolve => { releaseReads = resolve; });
      const delegate = new Proxy(db.recoveryFollowUp, { get(target, key) {
        if (key !== "findMany") return Reflect.get(target, key);
        return async (args: any) => {
          const rows = await db.recoveryFollowUp.findMany(args);
          if (++reads === 2) releaseReads();
          await bothRead;
          return rows;
        };
      } });
      const racing = new Proxy(db, { get(target, key) { return key === "recoveryFollowUp" ? delegate : Reflect.get(target, key); } });
      const first = f.job(racing).runOnce(new Date(firstSentAt.getTime() + 24 * hour));
      const second = f.job(racing).runOnce(new Date(firstSentAt.getTime() + 24 * hour));
      await firstReady;
      // The winner holds the simulated provider request open until the other
      // replica either loses its DB claim or incorrectly reaches dispatch.
      await Promise.race([first, second, secondReady]);
      release();
      await Promise.all([first, second]);
      assert.equal(f.state.contacts, 1);
    });

    for (const change of ["purchase", "resume", "consent", "payment", "strategy", "whatsapp_resume", "identity"]) {
      await t.test(`${change} cancels both reminders before contact`, async () => {
        const f = await create();
        if (change === "purchase") await db.recoveryAttempt.update({ where: { id: f.attemptId }, data: { status: "recovered" } });
        if (change === "resume") await db.checkoutSession.update({ where: { merchantId_sessionId: { merchantId: f.merchantId, sessionId: f.sessionId } }, data: { updatedAt: firstSentAt } });
        if (change === "consent") f.state.consent = false;
        if (change === "payment") f.state.eligible = false;
        if (change === "strategy") f.state.strategy = "offer_coupon";
        if (change === "identity") await db.checkoutSession.update({ where: { merchantId_sessionId: { merchantId: f.merchantId, sessionId: f.sessionId } }, data: { globalUserId: "different-buyer" } });
        if (change === "whatsapp_resume") await db.whatsAppSession.create({ data: { merchantId: f.merchantId, buyerPhone: "5511999991111", deviceId: "META_CLOUD:test", lastActivityAt: new Date(firstSentAt.getTime() + hour) } });
        await f.job().runOnce(new Date(firstSentAt.getTime() + 24 * hour));
        assert.equal(f.state.contacts, 0);
        assert.deepEqual((await f.steps()).map(r => r.status), ["cancelled", "cancelled"]);
      });
    }

    await t.test("resuming during provider verification blocks both channels and the later step", async () => {
      const f = await create(); f.state.resumeDuringSend = true;
      await f.job().runOnce(new Date(firstSentAt.getTime() + 24 * hour));
      assert.equal(f.state.contacts, 0);
      assert.deepEqual((await f.steps()).map(r => r.status), ["cancelled", "cancelled"]);
    });

    for (const cause of ["completed_order", "approved_payment", "empty_cart", "new_cart_owner"]) await t.test(`real persisted ${cause} cancels follow-ups without relying on the initial recovery outcome event`, async () => {
      const f = await create({ realEligibility: true });
      if (cause === "completed_order") await db.completedOrder.create({ data: { merchantId: f.merchantId, sessionId: f.sessionId,
        externalOrderId: randomUUID(), orderTotal: 10, currency: "BRL", completedAt: firstSentAt } });
      if (cause === "approved_payment") await db.paymentIntent.create({ data: { id: randomUUID(), merchantId: f.merchantId, sessionId: f.sessionId,
        idempotencyKey: randomUUID(), amountCents: 1000, currency: "BRL", method: "pix", status: "approved" } });
      if (cause === "empty_cart") await db.checkoutSession.update({ where: { merchantId_sessionId: { merchantId: f.merchantId, sessionId: f.sessionId } }, data: { cart: { items: [] } } });
      if (cause === "new_cart_owner") await db.checkoutSession.create({ data: { merchantId: f.merchantId, sessionId: randomUUID(), globalUserId: f.buyerId,
        conversationId: f.sessionId, cart: { cart_ref: f.sessionId, items: [{ sku: "item-a", quantity: 1 }] }, createdAt: firstSentAt, updatedAt: firstSentAt } });
      await f.job().runOnce(new Date(firstSentAt.getTime() + 24 * hour));
      assert.equal(f.state.contacts, 0);
      assert.deepEqual((await f.steps()).map(r => r.status), ["cancelled", "cancelled"]);
    });

    await t.test("ambiguous acceptance holds the original step and cancels further automatic contacts", async () => {
      const f = await create(); f.state.outcome = "uncertain";
      await f.job().runOnce(new Date(firstSentAt.getTime() + 24 * hour));
      await f.job().runOnce(new Date(firstSentAt.getTime() + 72 * hour));
      assert.equal(f.state.contacts, 1);
      assert.deepEqual((await f.steps()).map(r => r.status), ["unknown", "cancelled"]);
    });

    await t.test("a crash after dispatch claim is held without replay on restart", async () => {
      const f = await create(); const [first] = await f.steps();
      await db.recoveryFollowUp.update({ where: { id: first.id }, data: { status: "dispatching" } });
      await f.job().runOnce(new Date(firstSentAt.getTime() + 72 * hour));
      assert.equal(f.state.contacts, 0);
      assert.deepEqual((await f.steps()).map(r => r.status), ["dispatching", "cancelled"]);
    });

    await t.test("an outage skips an expired earlier contact instead of sending two reminders together", async () => {
      const f = await create();
      await f.job().runOnce(new Date(firstSentAt.getTime() + 72 * hour));
      assert.equal(f.state.contacts, 1);
      assert.deepEqual((await f.steps()).map(r => r.status), ["cancelled", "sent"]);
    });

    await t.test("database prevents an unauthorized fourth campaign stage", async () => {
      const f = await create();
      await assert.rejects(db.recoveryFollowUp.create({ data: { merchantId: f.merchantId, sessionId: f.sessionId, attemptId: f.attemptId, step: 3, dueAt: firstSentAt, expiresAt: firstSentAt } }));
    });

    await t.test("disconnected templates cannot starve an active store's approval polling", async () => {
      const active = await create(), disconnected = await create();
      await db.whatsAppChannelConfig.create({ data: { merchantId: active.merchantId, enabled: true, status: "ACTIVE", provider: "META_CLOUD" } });
      await db.postSaleMessageTemplate.createMany({ data: Array.from({ length: 200 }, (_, index) => ({ id: `poll-${randomUUID()}`, merchantId: disconnected.merchantId,
        type: `legacy-${index}`, channel: "whatsapp", name: "Disconnected", body: "Hello", isActive: true, metaNextCheckAt: new Date(0) })) });
      // The same registered type may exist once per tenant. Add enough disconnected
      // tenants with the real type to exceed the old 50-row polling batch.
      const rows = Array.from({ length: 60 }, () => ({ merchantId: `disconnected-${randomUUID()}`, type: "cart_recovery", channel: "whatsapp", name: "Disconnected", body: "Hello", metaNextCheckAt: new Date(0) }));
      await db.postSaleMessageTemplate.createMany({ data: rows });
      await db.postSaleMessageTemplate.create({ data: { merchantId: active.merchantId, type: "cart_recovery", channel: "whatsapp", name: "Active", body: "Hello", metaNextCheckAt: firstSentAt } });
      const repo = new PrismaRecoveryTemplateLifecycleRepository(db);
      const due = await repo.due(firstSentAt);
      assert.equal(due.length, 1);
      assert.equal(due[0].merchantId, active.merchantId);
      await repo.seedMerchantPage();
      assert.equal(await db.postSaleMessageTemplate.count({ where: { merchantId: disconnected.merchantId, type: "cart_recovery" } }), 0);
      await db.postSaleMessageTemplate.deleteMany({ where: { merchantId: { in: rows.map(r => r.merchantId) } } });
    });
  } finally {
    await db.recoveryAttempt.deleteMany({ where: { id: { in: fixtures } } });
    await db.postSaleMessageTemplate.deleteMany({ where: { merchantId: { in: owned } } });
    await db.whatsAppSession.deleteMany({ where: { merchantId: { in: owned } } });
    await db.paymentIntent.deleteMany({ where: { merchantId: { in: owned } } });
    await db.checkoutSession.deleteMany({ where: { merchantId: { in: owned } } });
    await db.storefrontCart.deleteMany({ where: { merchantId: { in: owned } } });
    await db.merchant.deleteMany({ where: { id: { in: owned } } });
    await db.$disconnect();
  }
});
