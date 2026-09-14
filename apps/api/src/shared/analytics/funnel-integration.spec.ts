import test from "node:test";
import assert from "node:assert/strict";
import { createFunnelDatabase } from "../../../tests/funnel-database-fixture.js";
import { GetFunnelUseCase } from "../../modules/checkout/application/use-cases/get-funnel.use-case.js";
import { GetFunnelSessionsUseCase } from "../../modules/checkout/application/use-cases/get-funnel-sessions.use-case.js";
import { GetStorefrontFunnelUseCase } from "../../modules/storefront/application/use-cases/get-storefront-funnel.use-case.js";
import { PrismaStorefrontTelemetryRepository } from "../../modules/storefront/infrastructure/repositories/prisma-storefront-telemetry.repository.js";

test("funnel persistence on disposable PostgreSQL", { skip: process.env.FUNNEL_DB_TESTS !== "1" }, async t => {
  const { db, merchantId, range } = await createFunnelDatabase();
  try {
    const checkout = new GetFunnelUseCase(db);
    const storefront = new GetStorefrontFunnelUseCase(db);
    await t.test("repeated completion and a failed attempt do not inflate paid sessions", async () => {
      const result = await checkout.execute(merchantId, "7d", { range, compare: true });
      assert.equal(result.totalSessions, 2);
      assert.equal(result.overallConversion, 50);
      assert.equal(result.steps.find(s => s.name === "payment_failed")?.count, 1);
      assert.equal(result.steps.find(s => s.name === "coupon_applied")?.count, 0);
      assert.ok(result.transitions.every(t => t.rate >= 0 && t.rate <= 100 && t.dropOff >= 0 && t.dropOff <= 100));
      assert.ok(result.transitions.every(t => !["coupon_applied", "payment_failed"].includes(t.to)));
      assert.equal(result.previous?.totalSessions, 0);
    });
    await t.test("buyer segments include resumed sessions and exclude the other journey and tenant", async () => {
      for (const useCase of [checkout, storefront]) {
        const result = await useCase.execute(merchantId, "7d", { range, breakdown: "buyer_type" });
        assert.equal(result.totalSessions, 2);
        assert.equal(result.breakdowns?.new.steps[0].count, 1);
        assert.equal(result.breakdowns?.returning.steps[0].count, 1);
      }
    });
    await t.test("last payment choice is exclusive, legacy card is normalized, and missing data is visible", async () => {
      const result = await checkout.execute(merchantId, "7d", { range, breakdown: "payment_method" });
      assert.equal(result.breakdowns?.pix.steps[0].count, 0);
      assert.equal(result.breakdowns?.credit_card.steps[0].count, 1);
      assert.equal(result.breakdowns?.credit_card.overallConversion, 100);
      assert.equal(result.breakdowns?.unknown.steps[0].count, 1);
      const devices = await checkout.execute(merchantId, "7d", { range, breakdown: "device" });
      assert.equal(devices.breakdowns?.mobile.steps[0].count, 1);
      assert.equal(devices.breakdowns?.unknown.steps[0].count, 1);
    });
    await t.test("registration is the store terminal and login is a separate outcome", async () => {
      const result = await storefront.execute(merchantId, "7d", { range });
      assert.equal(result.steps[0].count, result.totalSessions);
      assert.equal(result.overallConversion, 50);
      assert.equal(result.steps.find(s => s.name === "login_completed")?.count, 1);
      assert.ok(result.transitions.every(t => t.to !== "login_completed"));
    });
    await t.test("live checkout sessions never include store sessions or other merchants", async () => {
      const result = await new GetFunnelSessionsUseCase(db).execute(merchantId);
      assert.deepEqual(result.sessions.map(s => s.sessionId).sort(), ["chk_open", "chk_paid"]);
    });
    await t.test("telemetry renews last activity and concurrent first events persist", async () => {
      // Experiments are disabled in this fixture; session/event writes use real Prisma.
      const telemetry = new PrismaStorefrontTelemetryRepository({
        checkoutSession: db.checkoutSession, checkoutEvent: db.checkoutEvent,
        promptExperiment: { findFirst: async () => null },
      } as any);
      await db.checkoutSession.update({ where: { merchantId_sessionId: { merchantId, sessionId: "conv_login" } }, data: { updatedAt: new Date("2020-01-01") } });
      const before = Date.now();
      await telemetry.recordEvent({ merchantId, conversationId: "conv_login", event: "login_completed" });
      const updated = await db.checkoutSession.findUniqueOrThrow({ where: { merchantId_sessionId: { merchantId, sessionId: "conv_login" } } });
      assert.ok(updated.updatedAt.getTime() >= before);
      await Promise.all(["checkout_started", "product_viewed", "cart_viewed"].map(event => telemetry.recordEvent({ merchantId, conversationId: "conv_concurrent", event })));
      assert.equal(await db.checkoutSession.count({ where: { merchantId, sessionId: "conv_concurrent" } }), 1);
      assert.equal(await db.checkoutEvent.count({ where: { merchantId, sessionId: "conv_concurrent" } }), 3);
    });
  } finally { await db.$disconnect(); }
});
