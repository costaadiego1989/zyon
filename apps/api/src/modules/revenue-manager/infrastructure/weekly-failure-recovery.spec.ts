import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { WeeklyAnalysisService } from "./weekly-analysis.service.js";
import { WEEK_MS } from "../domain/weekly-analysis-policy.js";

const environment = { ...process.env };
afterEach(() => { process.env = { ...environment }; });

function fixture() {
  Object.assign(process.env, { REVENUE_WEEKLY_ENABLED: "true", REVENUE_WEEKLY_GENERATION_ENABLED: "true",
    REVENUE_WEEKLY_MERCHANT_IDS: "store-a" });
  const now = new Date("2026-10-05T06:00:00Z");
  const run: any = { id: "failed-run", merchantId: "store-a", cycle: 1, status: "running", attempts: 3,
    leaseToken: 3, leaseUntil: new Date(now.getTime() + 600000), asOf: now, createdAt: now,
    observationId: "observed", hypothesisId: null };
  const schedule: any = { merchantId: "store-a", timezone: "America/Sao_Paulo", currentRunId: run.id, cycle: 1,
    nextDueAt: now, lastSuccessfulAt: null };
  let writes = 0, notices = 0, generationCalls = 0, changed = 1;
  const db: any = {
    $queryRaw: async () => [], merchantRule: { findUnique: async () => ({ autonomousEngineEnabled: true }) },
    revenueManagerObservation: { findFirstOrThrow: async () => ({ dataQualityJson: { status: "ready" } }) },
    revenueManagerHypothesis: { findUnique: async () => null }, promptExperiment: { count: async () => 0 },
    revenueAnalysisRun: { findUniqueOrThrow: async () => run, findUnique: async () => run,
      update: async ({ data }: any) => { Object.assign(run, data); return run; },
      updateMany: async ({ data }: any) => { if (changed) Object.assign(run, data); return { count: changed }; },
      create: async ({ data }: any) => { writes++; return { id: "next-run", ...data }; } },
    revenueAnalysisSchedule: { findUniqueOrThrow: async () => schedule, findUnique: async () => schedule,
      update: async ({ data }: any) => { Object.assign(schedule, data); return schedule; },
      updateMany: async ({ where, data }: any) => { assert.equal(where.currentRunId, run.id); Object.assign(schedule, data); return { count: 1 }; } },
    merchantNotification: { findUnique: async () => null, upsert: async () => { notices++; } },
  };
  db.$transaction = async (callback: any) => callback(db);
  const service = new WeeklyAnalysisService(db, { getEffectivePlan: async () => "scale" } as any, {} as any,
    { execute: async () => { generationCalls++; throw new Error("Publication failed"); } } as any);
  service.clock = () => now;
  service.pendingDecisions = async () => 0;
  service.claim = async () => run;
  return { service, run, schedule, now, get writes() { return writes; }, get notices() { return notices; },
    get generationCalls() { return generationCalls; }, loseLease: () => { changed = 0; } };
}

test("exhausted analysis waits a week without claiming success or resetting attempts", async () => {
  const f = fixture();
  await f.service.process(f.run.id);
  assert.equal(f.run.status, "failed");
  assert.equal(f.run.attempts, 3);
  assert.equal(f.run.reason, "analysis_processing_failed");
  assert.equal(f.schedule.lastSuccessfulAt, null);
  assert.ok(f.schedule.nextDueAt.getTime() >= f.now.getTime() + WEEK_MS);
  assert.equal(f.generationCalls, 1);
  assert.equal(f.notices, 1);
});

test("a failed legacy run cannot start another paid cycle during the same week", async () => {
  const f = fixture();
  f.run.status = "failed";
  await (f.service as any).ensureRun("store-a", new Date(f.now.getTime() + 86400000));
  assert.equal(f.writes, 0);
  assert.equal(f.schedule.currentRunId, f.run.id);
});

test("the next weekly cycle can proceed after a terminal failure and preserves the old run", async () => {
  const f = fixture();
  f.run.status = "failed";
  await (f.service as any).ensureRun("store-a", new Date(f.now.getTime() + WEEK_MS));
  assert.equal(f.writes, 1);
  assert.equal(f.schedule.cycle, 2);
  assert.equal(f.schedule.currentRunId, "next-run");
  assert.equal(f.run.status, "failed");
  assert.equal(f.run.attempts, 3);
  assert.equal(f.generationCalls, 0);
});

test("a worker that lost its lease cannot postpone the weekly schedule or notify", async () => {
  const f = fixture();
  f.loseLease();
  await f.service.process(f.run.id);
  assert.equal(f.schedule.nextDueAt, f.now);
  assert.equal(f.notices, 0);
});

test("recovering an expired lease at the attempt cap waits a week without generation", async () => {
  const f = fixture();
  f.run.leaseUntil = new Date(f.now.getTime() - 1);
  f.run.retryAt = f.now;
  f.service.claim = WeeklyAnalysisService.prototype.claim;
  process.env.REVENUE_ANALYSIS_DAILY_LIMIT = "6";
  assert.equal(await f.service.claim(f.run.id, f.now), null);
  assert.equal(f.run.status, "failed");
  assert.equal(f.run.reason, "attempt_limit");
  assert.equal(f.run.attempts, 3);
  assert.ok(f.schedule.nextDueAt.getTime() >= f.now.getTime() + WEEK_MS);
  assert.equal(f.generationCalls, 0);
});
