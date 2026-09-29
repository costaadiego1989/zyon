import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { SharedStrategyLearningService } from "./shared-strategy-learning.service.js";
import { aggregateSharedStrategyLearning, type SharedLearningTarget } from "../domain/shared-strategy-learning.js";
import type { HypothesisGenerationRequest } from "../domain/ports/hypothesis-generator.port.js";

const environment = { ...process.env };
afterEach(() => { process.env = { ...environment }; });
const at = new Date("2030-09-10T00:00:00Z");
function fixture() {
  Object.assign(process.env, { REVENUE_SHARED_LEARNING_ENABLED: "true", REVENUE_SHARED_LEARNING_MERCHANT_IDS: "target,a,b,c,d,e",
    REVENUE_SHARED_LEARNING_MIN_MERCHANTS: "5" });
  const request = { merchant_id: "target", analysis_context: { runId: "run", leaseToken: 3 },
    observation: { id: "observation", abandonment: { abandoned_at_shipping: 100, abandoned_at_payment: 50 } },
    checkout_baseline: { definition: "checkout-chat-baseline-v1", provider: { name: "test" } },
    measurement_planning: { asOf: at.toISOString(), policy: { durationDays: 7, conversionWindowHours: 24, minimumEffectBps: 200 },
      baseline: { sessions: 100_000, conversions: 10_000 } } } as HypothesisGenerationRequest;
  const merchant = { storeCategory: "fashion", ownerIds: ["target-owner"] };
  const target = { merchantId: "target", ...merchant, baseline: request.checkout_baseline,
    planning: request.measurement_planning, abandonment: request.observation.abandonment } as SharedLearningTarget;
  const run: any = { id: "run", asOf: at, observationId: "observation", sharedLearningJson: null };
  const evidence: any[] = [];
  const writes: any[] = [], queries: Array<{ sql: string; values: unknown[] }> = [], reads: any[] = [];
  let revision: any = { id: "revision" }, admitted = true;
  const tx: any = {
    $queryRaw: async (parts: TemplateStringsArray, ...values: unknown[]) => {
      const sql = parts.join("?"); queries.push({ sql, values });
      if (sql.includes("FOR UPDATE")) return [{ id: "run" }];
      if (sql.includes("FROM strategy_executions")) return evidence;
      return [merchant];
    },
    revenueAnalysisRun: { findFirst: async (args: any) => { reads.push(args); return run; },
      updateMany: async (args: any) => { writes.push(args); if (admitted) run.sharedLearningJson = args.data.sharedLearningJson; return { count: admitted ? 1 : 0 }; } },
    revenueStrategyRevision: { findFirst: async () => revision },
  };
  const prisma = { $transaction: async (callback: any) => callback(tx) } as any;
  return { service: new SharedStrategyLearningService(prisma), request, run, target, evidence, writes, queries, reads,
    setRevision: (value: any) => { revision = value; }, expire: () => { admitted = false; } };
}

test("disabled, non-opted-in and non-weekly requests do not query other stores", async () => {
  const f = fixture(); process.env.REVENUE_SHARED_LEARNING_ENABLED = "false";
  assert.equal(await f.service.prepare(f.request), undefined);
  process.env.REVENUE_SHARED_LEARNING_ENABLED = "true";
  process.env.REVENUE_SHARED_LEARNING_MERCHANT_IDS = "*";
  assert.equal(await f.service.prepare(f.request), undefined);
  process.env.REVENUE_SHARED_LEARNING_MERCHANT_IDS = "target,a,b,c,d,e";
  assert.equal(await f.service.prepare({ ...f.request, analysis_context: undefined }), undefined);
  assert.equal(f.queries.length, 0);
});

test("weekly preparation reads only explicit sources and freezes a snapshot once with lease fencing", async () => {
  const f = fixture();
  const first = await f.service.prepare(f.request);
  const second = await f.service.prepare(f.request);
  assert.deepEqual(first, second);
  assert.equal(f.writes.length, 1);
  assert.equal(f.writes[0].where.merchantId, "target");
  assert.equal(f.writes[0].where.leaseToken, 3);
  const scans = f.queries.filter(q => q.sql.includes("FROM strategy_executions"));
  assert.equal(scans.length, 1);
  assert.match(scans[0].sql, /merchant_id IN/);
  assert.match(scans[0].sql, /ORDER BY collected_at DESC, id DESC LIMIT 1/);
  assert.doesNotMatch(scans[0].sql, /state.*=.*positive/);
  assert.match(scans[0].sql, /collected_at <=/);
  assert.deepEqual(f.run.sharedLearningJson.lessons, []);
});

test("expired lease cannot persist context and stale observation cannot read cross-store evidence", async () => {
  const f = fixture(); f.expire();
  await assert.rejects(() => f.service.prepare(f.request), /analysis_lease_lost/);
  const other = fixture(); other.run.observationId = "different";
  await assert.rejects(() => other.service.prepare(other.request), /analysis_lease_lost/);
  assert.equal(other.queries.length, 1);
});

test("revisions reuse frozen evidence but never collect new lessons or write a snapshot", async () => {
  const f = fixture();
  f.request.analysis_context!.revisionId = "revision";
  assert.equal(await f.service.prepare(f.request), undefined);
  f.run.sharedLearningJson = aggregateSharedStrategyLearning(f.target, [], at);
  assert.deepEqual(await f.service.prepare(f.request), f.run.sharedLearningJson);
  assert.equal(f.writes.length, 0);
  assert.equal(f.queries.some(q => q.sql.includes("FROM strategy_executions")), false);
  assert.equal(f.reads[0].where.status, "completed");
  f.setRevision(null);
  await assert.rejects(() => f.service.prepare(f.request), /revision_lease_lost/);
});

test("frozen malformed, source-bearing or incompatible snapshots block before the model", async () => {
  const f = fixture();
  f.run.sharedLearningJson = { ...aggregateSharedStrategyLearning(f.target, [], at), secret: "source text" };
  await assert.rejects(() => f.service.prepare(f.request), /SHARED_LEARNING_INVALID_SNAPSHOT/);
  f.run.sharedLearningJson = { ...aggregateSharedStrategyLearning(f.target, [], at), contextHash: "0".repeat(64) };
  await assert.rejects(() => f.service.prepare(f.request), /SHARED_LEARNING_CONTEXT_CHANGED/);
});

test("an over-limit source scan fails closed to local-only planning instead of selecting a biased subset", async () => {
  const f = fixture();
  f.evidence.push(...Array.from({ length: 2_001 }, () => ({ invalid: true })));
  const snapshot = await f.service.prepare(f.request);
  assert.deepEqual(snapshot?.lessons, []);
  assert.equal(f.writes.length, 1);
});
