import test from "node:test";
import assert from "node:assert/strict";
import { revenueLiftPrismaFixture } from "./revenue-lift.prisma-fixture.js";
import { GetRevenueLiftUseCase, GetRevenueLiftTrendUseCase } from "../application/use-cases/get-revenue-lift.use-case.js";
import { RevenueLiftCalculatorService } from "../domain/services/revenue-lift-calculator.service.js";

const runPrisma = process.env.AACP_RUN_PRISMA_TESTS === "1" && Boolean(process.env.DATABASE_URL);

// Real database + repository + calculator + use-cases. Not HTTP/auth/queue proof.
test("Revenue Lift component pipeline with actual Prisma, without fictitious BullMQ or HTTP proof",
  { skip: runPrisma ? false : "Requires the explicit owned disposable legacy Prisma runner." }, async t => {
    const f = await revenueLiftPrismaFixture();
    const at = new Date(); at.setUTCHours(0, 0, 0, 0);
    const calculator = new RevenueLiftCalculatorService();
    const summary = new GetRevenueLiftUseCase(f.repo, calculator), trend = new GetRevenueLiftTrendUseCase(f.repo, calculator);
    try {
      for (const cohort of ["holdout", "treatment"] as const) for (let i = 0; i < 30; i++) {
        const id = cohort + i;
        await f.session(f.merchantId, id, cohort, at, cohort === "treatment" ? 2 : 999);
        await f.order(f.merchantId, id, cohort === "holdout" ? 100 : 150, at);
        if (cohort === "treatment") await f.repo.saveTag(f.tag(f.merchantId, id));
      }
      await f.session(f.otherMerchantId, "treatment0", "treatment", at);
      await f.order(f.otherMerchantId, "treatment0", 9999, at);
      await t.test("measured gross lift is reproducible while partial costs never become net profit or ROI", async () => {
        const result = await summary.execute(f.merchantId, 30);
        assert.deepEqual(result.holdout, { sessions: 30, orders: 30, revenueCents: 300000, avgRevenueCents: 10000 });
        assert.deepEqual(result.treatment, { sessions: 30, orders: 30, revenueCents: 450000, avgRevenueCents: 15000 });
        assert.equal(result.lift.grossLiftPercent, 50);
        assert.equal(result.lift.holdoutProjectedCents, 300000);
        assert.equal(result.estimatedRevenueDifferenceCents, 150000);
        assert.equal(result.recordedAiCostCents, 60);
        assert.equal(result.aiCostCents, null);
        assert.equal(result.lift.netLiftCents, null);
        assert.equal(result.lift.roiPercent, null);
        assert.equal(result.dataQuality.status, "ready");
        assert.equal(result.dataQuality.sources.attributionTags, "partial");
        assert.deepEqual(result.featureBreakout, [{ feature: "cross_sell", orders: 30, revenueCents: 450000 }]);
        assert.deepEqual(await summary.execute(f.merchantId, 30), result);
      });
      await t.test("daily trend is computed from the same actual approved cohort evidence", async () => {
        assert.deepEqual(await trend.execute(f.merchantId, 30), { periodDays: 30, trend: [
          { date: at.toISOString().slice(0, 10), holdoutRevenueCents: 300000, treatmentRevenueCents: 450000,
            holdoutSessions: 30, treatmentSessions: 30, liftPercent: 50 },
        ] });
      });
      await t.test("insufficient foreign cohort cannot manufacture lift, net profit or ROI", async () => {
        const result = await summary.execute(f.otherMerchantId, 30);
        assert.equal(result.holdout.sessions, 0);
        assert.equal(result.treatment.sessions, 1);
        assert.equal(result.dataQuality.status, "insufficient_data");
        assert.deepEqual(result.lift, { holdoutAvgRevenueCents: null, treatmentAvgRevenueCents: null, grossLiftPercent: null,
          holdoutProjectedCents: null, netLiftCents: null, roiPercent: null });
      });
    } finally { await f.dispose(); }
  });
