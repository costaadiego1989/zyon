import test from "node:test";
import assert from "node:assert/strict";
import { DailyObservationScheduler, DailyObservationWorker } from "./daily-observation.job.js";
import { DiscountRuleHypothesisService } from "../../domain/services/discount-rule-hypothesis.service.js";
import { HypothesisEntity } from "../../domain/entities/hypothesis.entity.js";

function worker(prisma: Record<string, unknown>) {
  return new DailyObservationWorker(
    prisma as never,
    { execute: async () => ({ is_new: false }) } as never,
    { execute: async () => ({}) } as never,
    { execute: async () => ({ status: "created" }) } as never,
    { generate: () => null } as never,
    { save: async () => {} } as never,
  );
}

test("merchant-triggered observation propagates a database failure for BullMQ retry", async () => {
  const instance = worker({
    merchant: { findMany: async () => { throw new Error("database unavailable"); } },
  });

  await assert.rejects(
    instance.runObservationCycle("merchant-a"),
    /database unavailable/,
  );
});

test("merchant-triggered observation rejects an unknown merchant instead of reporting a false success", async () => {
  const instance = worker({
    merchant: { findMany: async () => [] },
  });

  await assert.rejects(
    instance.runObservationCycle("merchant-a"),
    /REVENUE_MANAGER_MERCHANT_NOT_FOUND/,
  );
});

test("manual strategy jobs use a BullMQ-valid identifier and retry transient failures", async () => {
  const scheduler = new DailyObservationScheduler();
  let options: Record<string, unknown> | undefined;
  (scheduler as any).queue = {
    add: async (_name: string, _data: unknown, jobOptions: Record<string, unknown>) => {
      options = jobOptions;
      return { id: jobOptions.jobId };
    },
  };

  const jobId = await scheduler.enqueueMerchantRun("merchant-a");

  assert.ok(!jobId.includes(":"));
  assert.equal(options?.attempts, 3);
  assert.deepEqual(options?.backoff, { type: "exponential", delay: 1_000 });
});

test("discount worker persists an unactivated simulation and deduplicates using the same store observation", async () => {
  const saved: HypothesisEntity[] = [];
  const instance = new DailyObservationWorker({ merchantRule: { findUnique: async () => ({
    autonomousEngineEnabled: true, maxDiscountPercent: 20, minimumMarginPercent: 35,
  }) } } as never, {} as never, {} as never, {} as never, new DiscountRuleHypothesisService(),
  { findByObservation: async (id: string) => saved.filter(h => h.observation_id === id), save: async (h: HypothesisEntity) => { saved.push(h); } } as any);
  (instance as any).loadCohortStats = async () => [{ intent: "price_sensitive", sampleSize: 30, conversionRate: .05,
    carts: Array.from({ length: 30 }, () => ({ currency: "BRL", total: 100, items: [{ sku: "sku", price: 100, cost: 40, quantity: 1 }] })) }];
  await (instance as any).generateDiscountRuleHypothesis("store", "observation");
  await (instance as any).generateDiscountRuleHypothesis("store", "observation");
  assert.equal(saved.length, 1);
  assert.equal(saved[0].status, "pending_review"); assert.equal(saved[0].approval_strategy, "manual");
  assert.equal(saved[0].discount_rule_json?.enabled, false);
  assert.equal(saved[0].snapshot().discount_simulation?.sampleSize, 30);
  assert.equal(saved[0].expected_lift_percent, 0);
  await (instance as any).generateDiscountRuleHypothesis("other-store", "observation");
  await (instance as any).generateDiscountRuleHypothesis("store", "next-observation");
  assert.equal(saved.length, 3);
});
