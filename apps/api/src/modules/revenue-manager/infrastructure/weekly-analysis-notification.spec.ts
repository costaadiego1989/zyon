import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { WeeklyAnalysisService } from "./weekly-analysis.service.js";

const environment = { ...process.env };
afterEach(() => { process.env = { ...environment }; });

function fixture() {
  Object.assign(process.env, { REVENUE_WEEKLY_ENABLED: "true", REVENUE_WEEKLY_MERCHANT_IDS: "store-a", REVENUE_WEEKLY_GENERATION_ENABLED: "false" });
  const now = new Date("2026-10-05T06:00:00Z");
  const run = { id: "run-1", merchantId: "store-a", observationId: "observation-1", hypothesisId: null,
    status: "running", reason: null, attempts: 1, leaseToken: 1, asOf: now, leaseUntil: new Date(now.getTime() + 600000) };
  let notice: any = null;
  let generationCalls = 0;
  const schedule = { merchantId: "store-a", timezone: "America/Sao_Paulo", nextDueAt: now, currentRunId: run.id };
  const db: any = {
    merchantRule: { findUnique: async () => ({ autonomousEngineEnabled: true }) },
    revenueManagerObservation: { findFirstOrThrow: async () => ({ dataQualityJson: { status: "ready" } }) },
    revenueManagerHypothesis: { findUnique: async () => null },
    revenueAnalysisRun: { findFirst: async () => run, updateMany: async () => ({ count: 1 }) },
    revenueAnalysisSchedule: { findUnique: async () => schedule, findUniqueOrThrow: async () => schedule, update: async () => schedule },
    merchantNotification: {
      findUnique: async () => notice,
      upsert: async ({ create, update }: any) => { notice = notice ? { ...notice, ...update } : { ...create, read: false }; return notice; },
    },
  };
  db.$transaction = async (callback: any) => callback(db);
  const service = new WeeklyAnalysisService(db, { getEffectivePlan: async () => "scale" } as any, {} as any,
    { execute: async () => { generationCalls++; throw new Error("Unexpected generation"); } } as any);
  service.clock = () => now;
  service.claim = async () => run as any;
  return { service, run, get notice() { return notice; }, get generationCalls() { return generationCalls; } };
}

test("a paused generation emits an explicit status update, not a suggestion", async () => {
  const f = fixture();
  await f.service.process(f.run.id);
  assert.equal(f.generationCalls, 0);
  assert.equal(f.notice.type, "ai_analysis_update");
  assert.equal(f.notice.title, "Geração de sugestões pausada");
  assert.match(f.notice.body, /ainda não tem uma proposta para aprovar/);
  assert.equal(f.notice.metadata.reason, "generation_disabled");
  assert.equal(f.notice.metadata.hypothesisId, undefined);
});

test("repeating the same blocked analysis preserves the merchant's read acknowledgement", async () => {
  const f = fixture();
  await f.service.process(f.run.id);
  f.notice.read = true;
  await f.service.process(f.run.id);
  await f.service.process(f.run.id);
  assert.equal(f.notice.read, true);
  assert.equal(f.generationCalls, 0);
});

test("a real recommendation makes the notification unread and links the persisted proposal", async () => {
  const f = fixture();
  await f.service.process(f.run.id);
  f.notice.read = true;
  await f.service.complete(f.run as any, "recommendations", "proposal-1");
  assert.equal(f.notice.read, false);
  assert.equal(f.notice.metadata.hypothesisId, "proposal-1");
  assert.equal(f.notice.metadata.reason, null);
  assert.match(f.notice.body, /nova proposta está disponível/);
});

test("a completed analysis without sufficient data does not promise a proposal", async () => {
  const f = fixture();
  await f.service.complete(f.run as any, "insufficient_data");
  assert.match(f.notice.body, /sem uma nova proposta/);
  assert.equal(f.notice.metadata.hypothesisId, undefined);
});

test("status exposes current platform generation independently from weekly scheduling", async () => {
  const f = fixture();
  assert.equal((await f.service.status("store-a")).enabled, true);
  assert.equal((await f.service.status("store-a")).generation_enabled, false);
  process.env.REVENUE_WEEKLY_GENERATION_ENABLED = "true";
  assert.equal((await f.service.status("store-a")).generation_enabled, true);
});
