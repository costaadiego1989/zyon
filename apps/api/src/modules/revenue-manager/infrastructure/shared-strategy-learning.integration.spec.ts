import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Prisma, PrismaClient } from "@prisma/client";
import { DEFAULT_MERCHANT_RULES } from "@zyon/shared-types";
import { captureCheckoutChatBaseline, checkoutBaselineReference, checkoutContractHash } from "../../checkout/domain/services/checkout-chat-baseline.js";
import { SharedStrategyLearningService } from "./shared-strategy-learning.service.js";
import { measurementPlanning } from "../domain/strategy-measurement.js";
import { ObservationEntity } from "../domain/entities/observation.entity.js";
import { PrismaObservationRepository } from "./prisma-observation.repository.js";
import type { HypothesisGenerationRequest } from "../domain/ports/hypothesis-generator.port.js";

// Unique fixtures only; no TRUNCATE and no modifications to other test data.
const url = new URL(process.env.REVENUE_STRATEGY_TEST_DATABASE_URL ?? "postgresql://invalid/disabled");
const enabled = url.hostname === "127.0.0.1" && url.port === "5557"
  && ["/revenue_strategy_0924", "/revenue_release_0928"].includes(url.pathname);
const prisma = new PrismaClient({ datasources: { db: { url: url.toString() } } });
const environment = { ...process.env };
before(async () => { if (enabled) await prisma.$connect(); });
after(async () => { await prisma.$disconnect(); process.env = environment; });
const integration = (name: string, fn: () => Promise<void>) => test(name, { skip: !enabled }, fn);

async function fixture() {
  const id = `sharing-${randomUUID()}`, now = new Date(), day = 86_400_000;
  await prisma.merchant.create({ data: { id, name: "Private learning fixture", storeCategory: "fashion",
    users: { create: { email: `${id}@example.invalid`, role: "owner" } } } });
  const observation = ObservationEntity.create({ merchant_id: id, observation_window_start: new Date(now.getTime() - 7 * day), observation_window_end: now,
    funnel: { total_sessions: 1000, started_checkout: 1000, reached_shipping: 700, reached_payment: 400, completed_order: 100, conversion_rate: .1 },
    abandonment: { abandoned_at_shipping: 300, abandoned_at_payment: 200, abandonment_rate: .9, top_abandonment_objection: "unknown" },
    objections: { shipping_cost_count: 0, price_count: 0, trust_count: 0, payment_count: 0, unknown_count: 900 },
    cross_sell: { suggestions_shown: 0, suggestions_accepted: 0, acceptance_rate: 0, top_suggested_skus: [] },
    cohorts: { returning_customers_rate: 0, new_customers_rate: 1, high_discount_sensitivity_rate: null, low_discount_sensitivity_rate: null },
    revenue: { total_revenue_cents: 10_000, total_orders: 100, avg_order_value_cents: 100 }, ai_costs_cents: 0 });
  await new PrismaObservationRepository(prisma).save(observation);
  const run = await prisma.revenueAnalysisRun.create({ data: { merchantId: id, cycle: 1, status: "running", leaseToken: 1,
    leaseUntil: new Date(now.getTime() + 60_000), observationId: observation.id, asOf: now } });
  const baseline = captureCheckoutChatBaseline({ merchantId: id, merchantName: "Fixture", rules: { normal: [], paymentFailed: [] },
    settingsHash: "fixture", policyHash: checkoutContractHash(DEFAULT_MERCHANT_RULES) }, {
    REVENUE_CHECKOUT_CONTRACT_ENABLED: "true", CHECKOUT_BEHAVIOR_REVISION: "a".repeat(40), CHECKOUT_LLM_PROVIDER: "openai", OPENAI_API_KEY: "fixture" })!;
  const planning = measurementPlanning({ merchantId: id, runId: run.id, asOf: now.toISOString(), capturedAt: now.toISOString(),
    policy: { durationDays: 7, conversionWindowHours: 24, minimumEffectBps: 500 },
    baseline: { sessions: 1000, conversions: 100, windowStart: new Date(now.getTime() - 29 * day).toISOString(), windowEnd: new Date(now.getTime() - day).toISOString() } });
  const request: HypothesisGenerationRequest = { merchant_id: id, analysis_context: { runId: run.id, leaseToken: 1 },
    checkout_baseline: baseline, current_prompt: checkoutBaselineReference(baseline), measurement_planning: planning, observation: observation.snapshot(),
    past_lessons: [], constraints: { max_discount_percent: 5, allow_free_shipping: false, max_running_experiments: 1, merchant_rules: DEFAULT_MERCHANT_RULES } };
  Object.assign(process.env, { REVENUE_SHARED_LEARNING_ENABLED: "true", REVENUE_SHARED_LEARNING_MIN_MERCHANTS: "5",
    REVENUE_SHARED_LEARNING_MERCHANT_IDS: [id, ...Array.from({ length: 5 }, (_, i) => `${id}-source-${i}`)].join(",") });
  return { id, run, request, service: new SharedStrategyLearningService(prisma) };
}

integration("PostgreSQL source query and concurrent prepare freeze the same privacy-safe weekly snapshot", async () => {
  const f = await fixture();
  const [a, b] = await Promise.all([f.service.prepare(f.request), f.service.prepare(f.request)]);
  assert.deepEqual(a, b);
  assert.equal(a?.definition, "shared-strategy-learning-v1");
  assert.deepEqual(a?.lessons, []);
  assert.equal(JSON.stringify(a).includes(f.id), false);
  assert.deepEqual((await prisma.revenueAnalysisRun.findUniqueOrThrow({ where: { id: f.run.id } })).sharedLearningJson, a);
  assert.equal(await prisma.revenueAiReservation.count({ where: { merchantId: f.id } }), 0);
  assert.equal(await prisma.strategyExecution.count({ where: { merchantId: f.id } }), 0);
});

integration("PostgreSQL rejects snapshot replacement, removal, run retargeting and deletion", async () => {
  const f = await fixture(); await f.service.prepare(f.request);
  for (const data of [{ sharedLearningJson: Prisma.DbNull }, { sharedLearningJson: { definition: "shared-strategy-learning-v1", lessons: [] } },
    { observationId: "different" }, { asOf: new Date(f.run.asOf!.getTime() + 1) }, { merchantId: "different" }]) {
    await assert.rejects(prisma.revenueAnalysisRun.update({ where: { id: f.run.id }, data }), /SHARED_LEARNING_IMMUTABLE/);
  }
  await assert.rejects(prisma.revenueAnalysisRun.delete({ where: { id: f.run.id } }), /SHARED_LEARNING_IMMUTABLE/);
});

integration("PostgreSQL lease and merchant boundaries prevent stale or cross-store snapshot capture", async () => {
  const f = await fixture();
  await assert.rejects(() => f.service.prepare({ ...f.request, analysis_context: { runId: f.run.id, leaseToken: 2 } }), /analysis_lease_lost/);
  process.env.REVENUE_SHARED_LEARNING_MERCHANT_IDS += ",different";
  await assert.rejects(() => f.service.prepare({ ...f.request, merchant_id: "different" }), /analysis_lease_lost/);
  assert.equal((await prisma.revenueAnalysisRun.findUniqueOrThrow({ where: { id: f.run.id } })).sharedLearningJson, null);
});
