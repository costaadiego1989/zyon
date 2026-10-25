import test from "node:test";
import assert from "node:assert/strict";
import { requiresWeeklyReview } from "./weekly-experiment-governance.js";
import { PromoteWinnerUseCase } from "./use-cases/promote-winner.use-case.js";
import { AutoPromoteWorker } from "../infrastructure/jobs/auto-promote.job.js";
import { RecordStrategyLessonUseCase } from "../../revenue-manager/application/use-cases/record-strategy-lesson.use-case.js";
import { StrategyFeedbackWorker } from "../../revenue-manager/infrastructure/workers/strategy-feedback.worker.js";
import { InMemoryDomainEventBus } from "../../../shared/events/in-memory-domain-event-bus.js";

test("weekly ownership survives disabled flags and stays scoped to the merchant", async (t) => {
  const enabled = process.env.REVENUE_WEEKLY_ENABLED;
  const merchants = process.env.REVENUE_WEEKLY_MERCHANT_IDS;
  t.after(() => {
    if (enabled === undefined) delete process.env.REVENUE_WEEKLY_ENABLED; else process.env.REVENUE_WEEKLY_ENABLED = enabled;
    if (merchants === undefined) delete process.env.REVENUE_WEEKLY_MERCHANT_IDS; else process.env.REVENUE_WEEKLY_MERCHANT_IDS = merchants;
  });
  process.env.REVENUE_WEEKLY_ENABLED = "false";
  const prisma = { revenueAnalysisSchedule: { findUnique: async ({ where }: any) => where.merchantId === "migrated" ? { merchantId: "migrated" } : null } } as any;
  assert.equal(await requiresWeeklyReview(prisma, "migrated"), true);
  assert.equal(await requiresWeeklyReview(prisma, "legacy"), false);
  process.env.REVENUE_WEEKLY_ENABLED = "true";
  process.env.REVENUE_WEEKLY_MERCHANT_IDS = "new-store";
  assert.equal(await requiresWeeklyReview({} as any, "new-store"), true);
  assert.equal(await requiresWeeklyReview(prisma, "legacy"), false);
});

test("legacy promotion and lesson writing are refused before effects for migrated stores", async () => {
  const prisma = { revenueAnalysisSchedule: { findUnique: async () => ({ merchantId: "migrated" }) } } as any;
  // Missing effect methods intentionally fail if the guard is bypassed.
  const promote = new PromoteWinnerUseCase(prisma, {} as any, {} as any);
  await assert.rejects(promote.execute("experiment", "migrated", "variant"), (err: any) => err.getStatus() === 409 && err.message === "EXPERIMENT_REVIEW_PLAN_REQUIRED");
  const record = new RecordStrategyLessonUseCase(prisma, {} as any, {} as any);
  await assert.rejects(record.execute({ merchant_id: "migrated", hypothesis_id: "hypothesis", experiment_id: "experiment" }), /EXPERIMENT_REVIEW_PLAN_REQUIRED/);
});

test("a legacy statistically winning result cannot auto-promote a weekly store", async () => {
  const prisma = {
    revenueAnalysisSchedule: { findUnique: async () => ({ merchantId: "migrated" }) },
    promptExperiment: { findMany: async () => [{ id: "experiment", merchantId: "migrated", variants: [
      { id: "control", name: "Control", results: Array.from({ length: 200 }, () => ({ converted: false })) },
      { id: "challenger", name: "Challenger", results: Array.from({ length: 200 }, () => ({ converted: true })) },
    ] }] },
  } as any;
  let promoted = 0;
  const worker = new AutoPromoteWorker(prisma, {} as any, { execute: async () => { promoted++; } } as any, {} as any);
  assert.equal(await worker.evaluateAndPromote(), 0);
  assert.equal(promoted, 0);
  prisma.revenueAnalysisSchedule.findUnique = async () => { throw new Error("database_unavailable"); };
  assert.equal(await worker.evaluateAndPromote(), 0);
  assert.equal(promoted, 0);
});

test("weekly completion delivery is acknowledged without teaching a fabricated win", async () => {
  const bus = new InMemoryDomainEventBus();
  const prisma = { revenueAnalysisSchedule: { findUnique: async () => ({ merchantId: "migrated" }) },
    revenueManagerHypothesis: { findFirst: async () => ({ id: "hypothesis" }) } } as any;
  const worker = new StrategyFeedbackWorker(bus, {} as any, prisma);
  worker.onModuleInit();
  await bus.publish({ eventType: "experiment.completed", merchantId: "migrated", payload: { experiment_id: "experiment" } });
});
