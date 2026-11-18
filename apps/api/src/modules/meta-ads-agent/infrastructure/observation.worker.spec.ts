import assert from "node:assert/strict";
import { test } from "node:test";
import type { MetaAdsCampaign, MetaAdsMetrics } from "@zyon/shared-types";
import type { MetaAccess, RecommendationPort, PaidOrderFact } from "../domain/types.js";
import { applicationFixture } from "../application/__tests__/fixture.js";
import { ObservationWorker } from "./observation.worker.js";
import { dailyFixture } from './__tests__/daily-fixture.js';

test('ADAS-41 daily admission reaches all due stores before a heavy campaign collection starts', async () => {
  const f = await dailyFixture(); try {
    f.setNow('2026-11-16T02:59:59Z'); await f.engine.admitDue(); assert.equal((await f.daily.list('store-a', '100'))[0].localDay, '2026-11-14');
    f.setNow('2026-11-16T03:00:00Z'); await f.engine.admitDue(); const rows = await f.daily.list('store-a', '100'); assert.equal(rows[0].localDay, '2026-11-15'); assert.equal(rows[0].createdAt, f.clock().toISOString()); assert.equal(f.metricReads.length, 0);
    assert.equal(rows[0].eligibleAt, f.clock().toISOString()); assert.equal((await f.daily.pending()).length, 2);
  } finally { await f.close(); }
});
test('ADAS-42 two collectors and replay produce one logical report and one confirmed analysis', async () => {
  const f = await dailyFixture(); try {
    await Promise.all([f.worker.run(), f.worker.run()]); await f.worker.run();
    const rows = await f.daily.list('store-a', '100'); assert.equal(rows.length, 1); assert.equal(rows[0].status, 'completed'); assert.equal(rows[0].report!.analysisStatus, 'completed');
    assert.equal(f.modelCalls(), 1); assert.equal(f.metricReads.length, 2); assert.equal(f.actions(), 1);
  } finally { await f.close(); }
});
test('ADAS-43 partial collection keeps confirmed stages and retries only missing metrics', async () => {
  const f = await dailyFixture(); try {
    const metrics = f.provider.metrics; let unavailable = true;
    f.provider.metrics = async (...args) => { if (args[2] !== args[3] && unavailable) throw new Error('429 secret'); return metrics(...args); };
    await f.worker.run(); let run = (await f.daily.list('store-a', '100'))[0];
    assert.equal(run.status, 'partial'); assert.equal(run.report!.campaigns[0].metrics!.spendCents, 1000); assert.equal(run.report!.analysisStatus, 'pending'); assert.equal(f.modelCalls(), 0);
    unavailable = false; f.setNow('2026-11-16T03:01:00Z'); await f.worker.run(); run = (await f.daily.list('store-a', '100'))[0];
    assert.equal(run.status, 'completed'); assert.equal(f.metricReads.filter(r => r.since === r.until).length, 1); assert.equal(f.modelCalls(), 1); assert.equal(JSON.stringify(run.report).includes('secret'), false);
  } finally { await f.close(); }
});
test('ADAS-44 closed report distinguishes media spend Meta attribution confirmed sales and conversations', async () => {
  const f = await dailyFixture(); try {
    await f.worker.run(); const report = (await f.daily.list('store-a', '100'))[0].report!, metrics = report.campaigns[0].metrics!;
    assert.equal(report.localDay, '2026-11-15'); assert.equal(report.timezone, 'America/Sao_Paulo'); assert.equal(report.since, '2026-11-15'); assert.equal(report.until, '2026-11-15'); assert.equal(report.collectedAt, f.clock().toISOString());
    assert.equal(metrics.spendCents, 1000); assert.equal(metrics.attributedRevenueCents, 15000); assert.equal(metrics.confirmedRevenueCents, 10000); assert.equal(metrics.paidOrders, 1); assert.equal(metrics.conversations, 3);
    assert.equal((await f.repo.read('store-a')).metrics[f.campaignId].spendCents, 2000); assert.equal(report.campaigns[0].recommendations[0].evidence.spendCents, 2000);
  } finally { await f.close(); }
});
test('ADAS-45 insufficient confirmed samples publish measurements but never buy analysis or optimize', async () => {
  const f = await dailyFixture(); try {
    f.orders(false); await f.worker.run(); const report = (await f.daily.list('store-a', '100'))[0].report!;
    assert.equal(report.analysisStatus, 'awaiting_data'); assert.equal(report.campaigns[0].status, 'awaiting_data'); assert.ok(report.campaigns[0].missing.includes('confirmed_purchases'));
    assert.equal(f.modelCalls(), 0); assert.equal(f.actions(), 0); assert.equal(report.campaigns[0].recommendations[0].proposedAction, null);
  } finally { await f.close(); }
});
test('ADAS-46 consolidated analysis uses rolling evidence and each campaign selected priority', async () => {
  const f = await dailyFixture(); try {
    await f.worker.run(); const report = (await f.daily.list('store-a', '100'))[0].report!, recommendation = report.campaigns[0].recommendations[0];
    assert.equal(recommendation.priority, 'roas'); assert.equal(recommendation.evidence.since, '2026-11-02'); assert.equal(recommendation.evidence.until, '2026-11-15'); assert.equal(recommendation.evidence.confirmedRevenueCents, 10000);
    assert.equal(recommendation.hypothesis, 'Testar imagem após rever os dados observados'); assert.notEqual(recommendation.id, 'model-untrusted-id'); assert.equal(report.campaigns[0].actions[0].status, 'pending_review');
  } finally { await f.close(); }
});
test('ADAS-50 a recovered sent non-durable analysis remains unknown and never calls the paid provider again', async () => {
  const f = await dailyFixture(); try {
    await f.engine.admitDue(); const run = (await f.daily.list('store-a', '100'))[0], lease = (await f.daily.claim('store-a', run.id))!;
    await f.daily.checkpoint(lease, { analysisStatus: 'sending', progress: { campaigns: {}, actions: {}, recommendations: [] } }); f.setNow('2026-11-16T03:03:00Z');
    await f.engine.drain(); const report = (await f.daily.read('store-a', run.id)).report!; assert.equal(report.analysisStatus, 'unknown'); assert.equal(f.modelCalls(), 0); assert.equal(f.actions(), 0);
  } finally { await f.close(); }
});
test('ADAS-43 unavailable Meta metrics preserve prior timestamp as stale without inventing zero values', async () => {
  const f = await dailyFixture(); try {
    await f.worker.run(); const previous = (await f.repo.read('store-a')).metrics[f.campaignId]; f.setNow('2026-11-17T03:00:00Z');
    f.provider.metrics = async () => { throw new Error('provider secret'); }; await f.worker.run();
    const report = (await f.daily.list('store-a', '100'))[0].report!, current = (await f.repo.read('store-a')).metrics[f.campaignId];
    assert.equal(report.status, 'partial'); assert.equal(report.campaigns[0].metrics, null); assert.equal(report.campaigns[0].status, 'unavailable'); assert.equal(current.spendCents, previous.spendCents); assert.equal(current.updatedAt, previous.updatedAt); assert.equal(current.stale, true);
  } finally { await f.close(); }
});
test('ADAS-42 account changes close pending old scope without fetching or optimizing the new account through it', async () => {
  const f = await dailyFixture(); try {
    await f.engine.admitDue(); const run = (await f.daily.list('store-a', '100'))[0];
    await f.repo.mutate('store-a', [], state => { state.connection.account = { id: '200', name: 'Outra conta' }; state.connection.epoch++; return { result: null }; });
    await f.engine.drain(); const old = await f.daily.read('store-a', run.id); assert.equal(old.status, 'completed'); assert.ok(old.report!.notes.includes('meta_account_changed')); assert.equal(f.metricReads.length, 0); assert.equal(f.actions(), 0);
  } finally { await f.close(); }
});

test('ADAS-47 pending creative generation resumes the action without repeating collection or paid analysis', async () => {
  const f = await dailyFixture(); try {
    let ready = false;
    f.automatic.recommendation = async () => ({ proposalId: ready ? 'proposal-creative' : '', executionId: null, status: ready ? 'active_unconfirmed' : 'generation_pending', reason: 'Nova imagem validada', error: null });
    await f.worker.run(); let run = (await f.daily.list('store-a', '100'))[0]; assert.equal(run.status, 'partial'); assert.equal(run.report!.campaigns[0].actions[0].status, 'generation_pending'); assert.equal(run.report!.analysisStatus, 'completed');
    ready = true; f.setNow('2026-11-16T03:01:00Z'); await f.worker.run(); run = (await f.daily.list('store-a', '100'))[0];
    assert.equal(run.status, 'completed'); assert.equal(run.report!.campaigns[0].actions[0].proposalId, 'proposal-creative'); assert.equal(run.report!.campaigns[0].actions[0].status, 'active_unconfirmed'); assert.equal(f.metricReads.length, 2); assert.equal(f.modelCalls(), 1);
  } finally { await f.close(); }
});
async function fixture() {
  const f = await applicationFixture(); let modelCalls = 0;
  const campaign: MetaAdsCampaign = { id: "campaign-a", draft: { name: "Campanha", destination: "store", priority: "roas", variantIds: [], mediaIds: [], budget: { amountCents: 2000, currency: "BRL", cadence: "daily", startsAt: "2026-11-15T12:00:00Z", endsAt: null }, headline: "", primaryText: "", country: "BR" }, products: [], createdByAgent: true, managed: true, remoteCampaignId: "200", remoteAdSetId: "300", remoteAdIds: ["500"], remoteAccountId: "100", status: "active_unconfirmed", createdAt: f.clock().toISOString(), updatedAt: f.clock().toISOString() };
  await f.repo.mutate("store-a", [], state => { state.campaigns[campaign.id] = campaign; return { result: null, records: [{ key: `campaign-origin:${campaign.id}`, kind: "audit", payload: { source: "agent", campaignId: campaign.id }, createdAt: f.clock().toISOString() }] }; });
  const access: MetaAccess = { merchantId: "store-a", accessToken: "secret", connectionEpoch: 1, clientConversationId: "AbCdEfGhIjKlMnOpQr12", accountId: "100", pageId: "110", datasetId: "120", catalogId: null, whatsappId: null };
  let orders: Array<{ campaignId: string; fact: PaidOrderFact }> = [{ campaignId: campaign.id, fact: { merchantId: "store-a", orderId: "order-a", sessionId: "session-a", paid: true, paidAt: "2026-11-13T12:00:00Z", currency: "BRL", paidCents: 10000, refundedCents: 0, costCents: null, costCoverage: "unavailable" } }];
  const recommendation: RecommendationPort = { recommend: async input => { modelCalls++; return { recommendations: input.campaigns.map(({ campaign: item }) => ({ id: "recommendation-a", campaignId: item.id, priority: item.draft.priority, hypothesis: "Testar outra imagem para comparar o custo por compra", evidence: {}, proposedAction: "creative", proposedFields: {}, status: "pending_review", createdAt: f.clock().toISOString() })), usage: null }; } };
  const connection = { access: async () => access }; let cancellations = 0;
  const worker = new ObservationWorker(f.repo, f.commerce, connection, f.provider, { report: async () => orders }, recommendation, { ensureEligibility: async () => { cancellations++; } }, { enabled: false, pageSize: 1 }, f.clock);
  return { ...f, campaign, worker, recommendation, modelCalls: () => modelCalls, cancellations: () => cancellations, setOrders: (value: typeof orders) => { orders = value; } };
}
test("MGA-61 metrics and update time persist even when AI returns no recommendation or fails", async () => {
  const f = await fixture(); try { f.recommendation.recommend = async () => { throw new Error("model unavailable secret"); }; await f.worker.run(); const state = await f.repo.read("store-a"); assert.equal(state.metrics["campaign-a"].spendCents, 2000); assert.equal(state.metrics["campaign-a"].confirmedRevenueCents, 10000); assert.equal(state.metrics["campaign-a"].updatedAt, f.clock().toISOString()); assert.equal(state.metrics["campaign-a"].stale, false); assert.equal(Object.keys(state.recommendations).length, 0); assert.equal(f.calls.includes("execute"), false); assert.equal(f.calls.includes("prepare"), false); const costs = await f.repo.listRecords("store-a", "usage"); assert.ok(costs.length > 0); assert.equal(JSON.stringify(costs).includes("secret"), false); } finally { await f.close(); }
});
test("MGA-62 suggestions identify priority, server evidence, hypothesis and pending proposed action", async () => {
  const f = await fixture(); try { await f.worker.run(); const state = await f.repo.read("store-a"); const suggestion = Object.values(state.recommendations)[0]; assert.equal(suggestion.priority, "roas"); assert.equal(suggestion.evidence.spendCents, 2000); assert.equal(suggestion.evidence.confirmedRevenueCents, 10000); assert.equal(suggestion.hypothesis, "Testar outra imagem para comparar o custo por compra"); assert.equal(suggestion.proposedAction, "creative"); assert.deepEqual(suggestion.proposedFields, {}); assert.equal(suggestion.status, "pending_review"); assert.equal(Object.keys(state.proposals).length, 0); assert.equal(f.calls.includes("execute"), false); } finally { await f.close(); }
});
test("MGA-68 Meta failures preserve previous metrics and timestamp with stale indication", async () => {
  const f = await fixture(); try { await f.worker.run(); const previous = (await f.repo.read("store-a")).metrics["campaign-a"]; f.setNow("2026-11-15T12:00:00Z"); f.provider.metrics = async () => { throw new Error("429 credential"); }; await f.worker.run(); const current = (await f.repo.read("store-a")).metrics["campaign-a"]; assert.equal(current.spendCents, previous.spendCents); assert.equal(current.confirmedRevenueCents, previous.confirmedRevenueCents); assert.equal(current.updatedAt, previous.updatedAt); assert.equal(current.stale, true); assert.ok(current.notes.includes("meta_metrics_unavailable")); assert.equal(f.modelCalls(), 1); } finally { await f.close(); }
});
test("daily observation is once per store under concurrency and paginates beyond the first store", async () => {
  const f = await fixture(); try { await f.repo.mutate("store-b", [], state => { state.subscription = null; return { result: null }; }); await Promise.all([f.worker.run(), f.worker.run()]); await f.worker.run(); assert.equal(f.modelCalls(), 1); assert.equal(f.cancellations(), 6); const records = await f.repo.listRecords("store-a", "observation"); assert.equal(records.filter(row => row.key.startsWith("daily-observation:")).length, 1); assert.equal((await f.repo.read("store-b")).metrics["campaign-a"], undefined); } finally { await f.close(); }
});
test("insufficient data avoids paid AI and an expired addon never changes external campaigns", async () => {
  const f = await fixture(); try { f.setOrders([]); await f.worker.run(); const suggestion = Object.values((await f.repo.read("store-a")).recommendations)[0]; assert.equal(suggestion.status, "awaiting_data"); assert.equal(suggestion.proposedAction, null); assert.equal(f.modelCalls(), 0); f.setNow("2026-12-02T12:00:00Z"); await f.worker.run(); assert.equal(f.modelCalls(), 0); assert.equal(f.calls.includes("execute"), false); assert.equal((await f.repo.read("store-a")).campaigns["campaign-a"].status, "active_unconfirmed"); } finally { await f.close(); }
});
test("entitlement ending while metrics are being read blocks the subsequent paid analysis", async () => {
  const f = await fixture(); try { const original = f.provider.metrics; f.provider.metrics = async (...args) => { const result = await original(...args); f.setNow("2026-12-02T12:00:00Z"); return result; }; await f.worker.run(); assert.equal(f.modelCalls(), 0); assert.equal((await f.repo.read("store-a")).metrics["campaign-a"].spendCents, 2000); assert.equal(f.calls.includes("execute"), false); } finally { await f.close(); }
});
