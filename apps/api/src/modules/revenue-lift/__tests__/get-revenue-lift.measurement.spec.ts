import test from "node:test";
import assert from "node:assert/strict";
import { GetRevenueLiftUseCase } from "../application/use-cases/get-revenue-lift.use-case.js";
import { RevenueLiftCalculatorService } from "../domain/services/revenue-lift-calculator.service.js";

function createRepository(holdoutSessions: number, treatmentSessions: number, holdoutRevenueCents: number) {
  return {
    async aggregateByCohort() {
      return {
        holdout: { sessions: holdoutSessions, orders: holdoutRevenueCents > 0 ? 1 : 0, totalRevenueCents: holdoutRevenueCents, totalAiCostCents: 0 },
        treatment: { sessions: treatmentSessions, orders: 20, totalRevenueCents: 200000, totalAiCostCents: 5000 },
      };
    },
    async getFeatureBreakout() { return []; },
  };
}

test("GetRevenueLiftUseCase withholds lift when either cohort lacks a measured sample", async () => {
  const useCase = new GetRevenueLiftUseCase(
    createRepository(29, 600, 10000) as never,
    new RevenueLiftCalculatorService(),
  );

  const result = await useCase.execute("merchant_a", 30);

  assert.equal(result.dataQuality.status, "insufficient_data");
  assert.deepEqual(result.dataQuality.missingMetrics, ["holdout_session_sample"]);
  assert.equal(result.lift.grossLiftPercent, null);
  assert.equal(result.lift.netLiftCents, null);
});

test("GetRevenueLiftUseCase exposes lift only from the session and approved-order population", async () => {
  const useCase = new GetRevenueLiftUseCase(
    createRepository(30, 600, 10000) as never,
    new RevenueLiftCalculatorService(),
  );

  const result = await useCase.execute("merchant_a", 30);

  assert.equal(result.dataQuality.status, "ready");
  assert.equal(result.holdout.sessions, 30);
  assert.equal(result.treatment.sessions, 600);
  assert.equal(result.lift.holdoutAvgRevenueCents, 10000 / 30);
  assert.ok(result.lift.grossLiftPercent !== null);
});
