import assert from "node:assert/strict";
import test, { before, after } from "node:test";
import { createFiscalFixture } from "../../../../tests/fiscal-fixture.js";
import { arrangeIssuance } from "../../../../tests/fiscal-issuance-harness.js";
import { FiscalWorker } from "./fiscal.worker.js";
let f: Awaited<ReturnType<typeof createFiscalFixture>>;
before(async () => { f = await createFiscalFixture(); }, { timeout: 120000 });
after(async () => { await f?.close(); });
const stock = { binding: async () => { throw new Error("not used"); }, withEffect: async <T>(_scope: unknown, _id: string, work: () => Promise<T>) => work(), release: async () => {} };
const recovery = { run: async () => {} };
test("FISCAL-31 worker construction and module import do not dispatch or query a provider", async () => {
  const a = await arrangeIssuance(f); new FiscalWorker(f.prisma, a.service, recovery, stock); assert.equal(a.calls.length, 0); assert.equal((await a.current()).attempts, 0); assert.equal(await f.prisma.fiscalProviderStageReceipt.count({ where: { intentId: a.sale.intent.id } }), 0);
});
test("FISCAL-31 restart consumes the original persisted reference and never repeats an uncertain submit", async () => {
  const a = await arrangeIssuance(f); a.setBehavior("timeout"); await new FiscalWorker(f.prisma, a.service, recovery, stock).runOnce(a.scope);
  await f.prisma.fiscalIntent.update({ where: { id: a.sale.intent.id }, data: { nextAttemptAt: new Date(0) } }); a.setRemote("absent"); await new FiscalWorker(f.prisma, a.service, recovery, stock).runOnce(a.scope);
  assert.equal(a.writes().length, 1); assert.equal((await a.current()).stableReference, a.sale.intent.stableReference); assert.equal((await a.current()).state, "reconciliation_required"); assert.equal((await a.current()).attempts, 2);
});
test("FISCAL-28 two worker instances claim and submit one queued sale once", async () => {
  const a = await arrangeIssuance(f); const first = new FiscalWorker(f.prisma, a.service, recovery, stock), second = new FiscalWorker(f.prisma, a.service, recovery, stock);
  const result = await Promise.all([first.runOnce(a.scope), second.runOnce(a.scope)]); assert.equal(result.filter(Boolean).length, 1); assert.equal(a.writes().length, 1); assert.equal((await a.current()).attempts, 1);
});
test("FISCAL-36 worker leaves a persisted provider Retry-After untouched and performs zero early IO", async () => {
  const a = await arrangeIssuance(f); a.setBehavior("429"); const worker = new FiscalWorker(f.prisma, a.service, recovery, stock); await worker.runOnce(a.scope); const future = (await a.current()).nextAttemptAt;
  assert.equal(await worker.runOnce(a.scope), false); assert.equal(a.writes().length, 1); assert.equal((await a.current()).nextAttemptAt.toISOString(), future.toISOString());
});
test("FISCAL-64 expired running lease cannot overwrite a replacement claim", async () => {
  const a = await arrangeIssuance(f); const processor = { run: async (claim: any) => { await f.prisma.fiscalIntent.update({ where: { id: claim.id }, data: { leaseUntil: new Date(0) } }); await a.repo.claim(a.scope, new Date(), 60000); throw new Error("private provider error"); } };
  await new FiscalWorker(f.prisma, processor, recovery, stock).runOnce(a.scope); const current = await a.current(); assert.equal(current.attempts, 2); assert.notEqual(current.leaseToken, null); assert.equal(current.lastErrorCode, null); assert.equal(a.writes().length, 0);
});
test("FISCAL-36 unexpected processor failure persists redacted bounded backoff without changing original identity", async () => {
  const a = await arrangeIssuance(f); const before = Date.now(); await new FiscalWorker(f.prisma, { run: async () => { throw new Error("token and buyer private"); } }, recovery, stock).runOnce(a.scope);
  const intent = await a.current(); assert.equal(intent.state, "queued"); assert.equal(intent.lastErrorCode, "fiscal_worker_unavailable"); assert.ok(intent.nextAttemptAt.getTime() >= before + 1000); assert.equal(intent.leaseToken, null); assert.equal(intent.stableReference, a.sale.intent.stableReference);
  assert.ok(!JSON.stringify(await a.repo.history(a.scope, intent.id)).includes("token and buyer private"));
});
test("FISCAL-40 authorized recovery is separately claimed without emission or fiscal regression", async () => {
  const a = await arrangeIssuance(f); await f.prisma.fiscalIntent.update({ where: { id: a.sale.intent.id }, data: { state: "authorized" } }); let called = false;
  await new FiscalWorker(f.prisma, { run: async () => { throw new Error("must not issue"); } }, { run: async claim => { called = true; assert.equal(claim.state, "authorized"); const session = await a.store.open(claim); assert.equal(await session.journal.check(session.context.identity), false); assert.equal(await session.journal.begin({ identity: session.context.identity, stage: "invoice.submit", reference: claim.stableReference, outcome: "started" }), false); } }, stock).runOnce(a.scope);
  assert.equal(called, true); assert.equal((await a.current()).state, "authorized"); assert.equal((await a.current()).version, a.sale.intent.version); assert.equal(a.writes().length, 0);
});
test("FISCAL-40 disabled/action-required and historical sales are not dispatched by a generic worker turn", async () => {
  for (const state of ["awaiting_payment", "not_eligible_before_activation", "suppressed", "action_required", "rejected"]) { const a = await arrangeIssuance(f); await f.prisma.fiscalIntent.update({ where: { id: a.sale.intent.id }, data: { state } }); assert.equal(await new FiscalWorker(f.prisma, a.service, recovery, stock).runOnce(a.scope), false); assert.equal(a.calls.length, 0); }
});
test("FISCAL-64 release consumer uses the trusted committed scope and repeats release only", async () => {
  const a = await arrangeIssuance(f); let calls = 0; const consumer = new FiscalWorker(f.prisma, a.service, recovery, { ...stock, release: async (scope, id, evidence) => { assert.deepEqual(scope, a.scope); assert.equal(id, a.sale.intent.id); assert.equal(evidence, "event_original"); calls++; } });
  const payload = { intentId: a.sale.intent.id, environment: a.scope.environment, evidenceEventId: "event_original" }; await consumer.handleStockRelease(a.scope.merchantId, payload); await consumer.handleStockRelease(a.scope.merchantId, payload);
  assert.equal(calls, 2); assert.equal(a.writes().length, 0); await assert.rejects(consumer.handleStockRelease(a.scope.merchantId, { ...payload, environment: "foreign" }), /release_request_invalid/);
});

test("FISCAL-31 expired started journal survives a crash before HTTP and recovery does not submit", async () => {
  const a = await arrangeIssuance(f); const claim = await a.claim(); const session = await a.store.open(claim!);
  const payment = (await import("../domain/fiscal-payment-evidence.port.js")).admitFiscalPaymentEvidence(a.sale.snapshot, a.evidence);
  const body = a.factory.build(session.context, new Date().toISOString(), payment); await session.freeze(body, a.evidence);
  await session.journal.begin({ identity: session.context.identity, stage: "invoice.submit", reference: claim!.stableReference, payloadHash: "a".repeat(64), outcome: "started" });
  await f.prisma.fiscalIntent.update({ where: { id: claim!.id }, data: { leaseUntil: new Date(0), nextAttemptAt: new Date(0) } });
  await new FiscalWorker(f.prisma, a.service, recovery, stock).runOnce(a.scope);
  assert.equal(a.writes().length, 0); assert.equal((await a.current()).state, "reconciliation_required"); assert.equal((await a.current()).stableReference, claim!.stableReference);
  assert.equal((await f.prisma.fiscalProviderStageReceipt.findFirstOrThrow({ where: { intentId: claim!.id } })).outcome, "started");
});
