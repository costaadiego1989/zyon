import { authorityFixture } from '../../application/__tests__/authority-fixture.js';
import { PrismaDailyObservationRepository } from '../prisma-daily-observation.repository.js';
import { DailyObservationEngine } from '../daily-observation.engine.js';
import { ObservationWorker } from '../observation.worker.js';
import type { RecommendationPort, PaidOrderFact } from '../../domain/types.js';

export async function dailyFixture() {
  const f = await authorityFixture(); f.setNow('2026-11-16T03:00:00Z');
  const daily = new PrismaDailyObservationRepository(f.prisma, f.clock);
  let zone = 'America/Sao_Paulo', orders = true, modelCalls = 0;
  const metricReads: Array<{ campaignId: string; since: string; until: string }> = [];
  const originalMetrics = f.provider.metrics;
  f.provider.metrics = async (access, campaign, since, until) => { metricReads.push({ campaignId: campaign.id, since, until }); return { ...await originalMetrics(access, campaign, since, until), timezone: zone, spendCents: since === until ? 1000 : 2000, attributedRevenueCents: 15000, conversations: 3 }; };
  const recommendations: RecommendationPort = { configured: () => true, recommend: async input => { modelCalls++; return { recommendations: input.campaigns.map(({ campaign }) => ({ id: 'model-untrusted-id', campaignId: campaign.id, priority: campaign.draft.priority, hypothesis: 'Testar imagem após rever os dados observados', evidence: {}, proposedAction: 'pause', proposedFields: {}, status: 'pending_review', createdAt: f.clock().toISOString() })), usage: null }; } };
  const attribution = { report: async () => orders ? [{ campaignId: f.campaignId, fact: { merchantId: 'store-a', orderId: 'order-a', paid: true, paidAt: '2026-11-15T12:00:00Z', paidCents: 10000, refundedCents: 0, currency: 'BRL', costCents: null, costCoverage: 'unavailable' } as PaidOrderFact }] : [] };
  let actions = 0;
  const automatic = { recommendation: async (_merchantId: string, id: string) => { actions++; return { proposalId: `proposal-${id}`, executionId: null, status: 'pending_review', reason: 'Revisão individual', error: null }; } };
  const engine = new DailyObservationEngine({ repo: f.repo, daily, commerce: f.commerce, connection: f.service.connection, provider: f.provider, timezone: async () => zone, attribution, recommendations, billing: { ensureEligibility: async () => {} }, automatic, clock: f.clock });
  const worker = new ObservationWorker(f.repo, f.commerce, f.service.connection, f.provider, attribution, recommendations, { ensureEligibility: async () => {} }, { enabled: false }, f.clock, engine);
  return { ...f, daily, engine, worker, metricReads, recommendations, automatic, modelCalls: () => modelCalls, actions: () => actions, timezone: (value: string) => { zone = value; }, orders: (value: boolean) => { orders = value; } };
}
