import test from "node:test";
import assert from "node:assert/strict";
import { revenueLiftPrismaFixture } from "./revenue-lift.prisma-fixture.js";

const runPrisma = process.env.AACP_RUN_PRISMA_TESTS === "1" && Boolean(process.env.DATABASE_URL);

test("Revenue Lift actual repository: approved revenue, dates, tenants and attribution idempotency",
  { skip: runPrisma ? false : "Requires the explicit owned disposable legacy Prisma runner." }, async t => {
    const f = await revenueLiftPrismaFixture();
    const at = new Date("2026-01-02T12:00:00.000Z"), from = new Date("2026-01-01T00:00:00.000Z"), to = new Date("2026-01-04T00:00:00.000Z");
    try {
      await f.session(f.merchantId, "holdout", "holdout", at);
      await f.order(f.merchantId, "holdout", 100, at);
      await f.session(f.merchantId, "treatment", "treatment", at);
      await f.order(f.merchantId, "treatment", 150, at);
      await f.session(f.merchantId, "no-order", "treatment", at);
      await f.session(f.merchantId, "declined", "treatment", at);
      await f.order(f.merchantId, "declined", 9999, at, "cancelled");
      await f.session(f.merchantId, "outside", "treatment", new Date("2026-01-10T12:00:00.000Z"));
      await f.order(f.merchantId, "outside", 9999, at);
      await f.session(f.merchantId, "unassigned", "unassigned", at);
      await f.order(f.merchantId, "unassigned", 9999, at);
      // Same session and order identifiers in another tenant must never join.
      await f.session(f.otherMerchantId, "treatment", "treatment", at);
      await f.order(f.otherMerchantId, "treatment", 9999, at);
      await t.test("cohort aggregation excludes other tenants, outside dates and unapproved orders", async () => {
        assert.deepEqual(await f.repo.aggregateByCohort(f.merchantId, from, to), {
          holdout: { sessions: 1, orders: 1, totalRevenueCents: 10000, totalAiCostCents: 0 },
          treatment: { sessions: 3, orders: 1, totalRevenueCents: 15000, totalAiCostCents: 15 },
        });
        assert.deepEqual(await f.repo.aggregateByCohort("synthetic-missing-merchant", from, to), {
          holdout: { sessions: 0, orders: 0, totalRevenueCents: 0, totalAiCostCents: 0 },
          treatment: { sessions: 0, orders: 0, totalRevenueCents: 0, totalAiCostCents: 0 },
        });
      });
      await t.test("tag upsert is idempotent and cannot replace an existing order attribution", async () => {
        const input = f.tag(f.merchantId, "treatment");
        await f.repo.saveTag(input);
        const before = await f.prisma.attributionTag.findMany({ where: { merchantId: f.merchantId } });
        await f.repo.saveTag({ ...input, orderValueCents: 99999, negotiationApplied: true });
        assert.deepEqual(await f.prisma.attributionTag.findMany({ where: { merchantId: f.merchantId } }), before);
        assert.equal(before.length, 1);
        await f.repo.saveTag({ ...input, merchantId: f.otherMerchantId, negotiationApplied: true });
        assert.equal(await f.prisma.attributionTag.count({ where: { orderId: input.orderId } }), 2);
      });
      await t.test("feature breakout uses approved order values and complete merchant joins", async () => {
        await f.repo.saveTag(f.tag(f.merchantId, "declined"));
        assert.deepEqual(await f.repo.getFeatureBreakout(f.merchantId, from, to), [
          { feature: "cross_sell", orders: 1, revenueCents: 15000 },
        ]);
        assert.deepEqual(await f.repo.getFeatureBreakout(f.otherMerchantId, from, to), [
          { feature: "negotiation", orders: 1, revenueCents: 999900 },
        ]);
      });
      await t.test("daily trend includes zero-order sessions without foreign or unapproved revenue", async () => {
        assert.deepEqual(await f.repo.getDailyTrend(f.merchantId, from, to), [
          { date: "2026-01-02", holdoutRevenueCents: 10000, treatmentRevenueCents: 15000, holdoutSessions: 1, treatmentSessions: 3 },
        ]);
      });
      await t.test("recovery marking is tenant-scoped and a missing tag remains absent", async () => {
        await f.repo.markCartRecovery(f.otherMerchantId, "synthetic-order-treatment");
        assert.equal((await f.prisma.attributionTag.findUnique({ where: { merchantId_orderId: { merchantId: f.merchantId, orderId: "synthetic-order-treatment" } } }))?.cartRecoveryApplied, false);
        await f.repo.markCartRecovery(f.merchantId, "synthetic-missing-order");
        assert.equal(await f.prisma.attributionTag.count({ where: { merchantId: f.merchantId } }), 2);
        await f.repo.markCartRecovery(f.merchantId, "synthetic-order-treatment");
        assert.equal((await f.prisma.attributionTag.findUnique({ where: { merchantId_orderId: { merchantId: f.merchantId, orderId: "synthetic-order-treatment" } } }))?.cartRecoveryApplied, true);
      });
    } finally { await f.dispose(); }
  });
