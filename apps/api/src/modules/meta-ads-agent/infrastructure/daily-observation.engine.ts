import type { MetaAdsCampaign, MetaAdsMetrics, MetaAdsRecommendation, MetaAdsDailyReport } from '@zyon/shared-types';
import { MetaAdsError, type MetaAdsRepository, type CommerceContextPort, type MetaAdsProviderPort, type RecommendationPort, type AttributedPurchase, type MetaAccess, type Clock } from '../domain/types.js';
import { requireEntitlement, stableDigest } from '../domain/offer.js';
import { buildMetrics, assessData } from '../domain/analytics.js';
import { closedObservationDays } from '../domain/daily-observation-calendar.js';
import type { DailyObservationRepository, DailyLease } from '../domain/daily-observation.port.js';
import type { ConnectionService } from '../application/connection.service.js';
import type { BillingService } from '../application/billing.service.js';
import type { AutomaticCampaignWorker, AutomaticOutcome } from './automatic-campaign.worker.js';
import { recommendationEvidence, validSuggestion } from './recommendation.adapter.js';
import type {CampaignSalesQueryService} from '../application/campaign-sales-query.service.js';

interface Dependencies {
  repo: MetaAdsRepository; daily: DailyObservationRepository; commerce: Pick<CommerceContextPort, 'getPlan'>;
  connection: Pick<ConnectionService, 'access'>; provider: Pick<MetaAdsProviderPort, 'metrics'> & Partial<Pick<MetaAdsProviderPort,'snapshot'>>; timezone: (access: MetaAccess) => Promise<string>;
  attribution: { report(merchantId: string, since: string, until: string, timezone?: string): Promise<Array<Pick<AttributedPurchase, 'campaignId' | 'fact'>>> };
  recommendations: RecommendationPort; billing: Pick<BillingService, 'ensureEligibility'>;
  automatic: Pick<AutomaticCampaignWorker, 'recommendation'>; clock?: Clock;
  sales?:Pick<CampaignSalesQueryService,'sales'>;
}
interface Progress {
  campaigns: Record<string, { daily?: MetaAdsMetrics; rolling?: MetaAdsMetrics; error?: string }>;
  recommendations: MetaAdsRecommendation[]; actions: Record<string, AutomaticOutcome>;
}
export class DailyObservationEngine {
  private readonly clock: Clock;
  private admitting: Promise<void> | undefined;
  private collecting: Promise<void> | undefined;
  private stopping = false;
  constructor(private readonly deps: Dependencies) { this.clock = deps.clock ?? (() => new Date()); }
  admitDue(): Promise<void> { if (this.stopping) return Promise.resolve(); return this.admitting ??= this.admit().finally(() => { this.admitting = undefined; }); }
  drain(): Promise<void> { if (this.stopping) return Promise.resolve(); return this.collecting ??= this.collect().finally(() => { this.collecting = undefined; }); }
  async stop(): Promise<void> { this.stopping = true; await Promise.allSettled([this.admitting, this.collecting]); }
  private async observeAudience(merchantId:string,campaign:MetaAdsCampaign):Promise<void>{
    const read=this.deps.provider.snapshot?.bind(this.deps.provider);if(!read||!campaign.remoteAdSetId)return;
    try{
      const access=await this.deps.connection.access(merchantId);if(access.accountId!==campaign.remoteAccountId)return;
      const snapshot=await read(access,campaign);if(snapshot.campaignId!==campaign.remoteCampaignId||snapshot.adSetId!==campaign.remoteAdSetId)return;
      const targeting=snapshot.targeting as {geo_locations?:{countries?:unknown};age_min?:unknown;age_max?:unknown;targeting_automation?:{advantage_audience?:unknown}},countries=targeting.geo_locations?.countries;
      if(!Array.isArray(countries)||!countries.length||countries.length>50||countries.some(c=>typeof c!=='string'||!(/^[A-Z]{2}$/).test(c)))return;
      const minimumAge=Number.isSafeInteger(targeting.age_min)&&Number(targeting.age_min)>=13&&Number(targeting.age_min)<=65?Number(targeting.age_min):null;
      const maximumAge=Number.isSafeInteger(targeting.age_max)&&Number(targeting.age_max)>=13&&Number(targeting.age_max)<=65&&(minimumAge===null||Number(targeting.age_max)>=minimumAge)?Number(targeting.age_max):null;
      const auto=targeting.targeting_automation?.advantage_audience;
      await this.deps.repo.mutate(merchantId,[],state=>{const current=state.campaigns[campaign.id];if(state.connection.epoch!==access.connectionEpoch||state.connection.account?.id!==access.accountId||!current?.managed||current.remoteCampaignId!==snapshot.campaignId||current.remoteAdSetId!==snapshot.adSetId)return{result:null};state.audienceSnapshots??={};state.audienceSnapshots[campaign.id]={source:'verified',countries:[...new Set(countries as string[])],minimumAge,maximumAge,automatic:auto===1||auto===true?true:auto===0||auto===false?false:null,checkedAt:this.clock().toISOString()};return{result:null};});
    }catch{/* Missing audience metadata never discards separately confirmed measurements. */}
  }
  private async admit(): Promise<void> {
    let after: string | undefined;
    while (!this.stopping) {
      const stores = await this.deps.repo.listStoreIds(100, after); if (!stores.length) return;
      await Promise.allSettled(stores.map(async merchantId => {
        await this.deps.billing.ensureEligibility(merchantId);
        const state = await this.deps.repo.read(merchantId); requireEntitlement(await this.deps.commerce.getPlan(merchantId), state, this.clock());
        const access = await this.deps.connection.access(merchantId), accountId = access.accountId!;
        const timezone = await this.deps.timezone(access);
        const current = await this.deps.repo.read(merchantId);
        if (current.connection.epoch !== access.connectionEpoch || current.connection.account?.id !== accountId) return;
        const last = await this.deps.daily.latestDay(merchantId, accountId, timezone);
        for (const day of closedObservationDays(this.clock(), timezone, last ?? undefined)) await this.deps.daily.admit({ merchantId, accountId, ...day });
      }));
      if (stores.length < 100) return; after = stores.at(-1);
    }
  }
  private async collect(): Promise<void> {
    for (const job of await this.deps.daily.pending()) {
      if (this.stopping) return;
      const lease = await this.deps.daily.claim(job.merchantId, job.id); if (!lease) continue;
      const heartbeat = setInterval(() => { void this.deps.daily.heartbeat(lease).catch(() => undefined); }, 20000); heartbeat.unref();
      try { await this.observe(lease); } catch { /* Checkpoints survive; expired work is recovered under a new fence. */ }
      finally { clearInterval(heartbeat); }
    }
  }
  private async observe(initial: DailyLease): Promise<void> {
    let lease = initial; const merchantId = lease.merchantId;
    const raw = lease.progress as Partial<Progress>;
    const progress: Progress = { campaigns: raw.campaigns ?? {}, recommendations: raw.recommendations ?? [], actions: raw.actions ?? {} };
    const save = async () => { lease = await this.deps.daily.checkpoint(lease, { progress: progress as unknown as Record<string, unknown> }); };
    const state = await this.deps.repo.read(merchantId);
    const report: MetaAdsDailyReport = lease.report ?? { id: lease.id, accountId: lease.accountId, localDay: lease.localDay, timezone: lease.timezone, since: lease.since, until: lease.until, status: 'collecting', analysisStatus: 'pending', collectedAt: null, updatedAt: this.clock().toISOString(), campaigns: [], notes: ['observed_attribution_not_causal_uplift'] };
    if (state.connection.account?.id !== lease.accountId) {
      report.status = 'partial'; report.analysisStatus = 'unavailable'; report.updatedAt = this.clock().toISOString(); report.notes.push('meta_account_changed');
      await this.deps.daily.checkpoint(lease, { report, analysisStatus: 'unavailable' }); await this.deps.daily.finish(lease, 'completed'); return;
    }
    requireEntitlement(await this.deps.commerce.getPlan(merchantId), state, this.clock());
    const campaigns: MetaAdsCampaign[] = [];
    for (const campaign of Object.values(state.campaigns)) {
      if (!campaign.managed || !campaign.createdByAgent || !campaign.remoteCampaignId || campaign.remoteAccountId !== lease.accountId) continue;
      const origin = (await this.deps.repo.getRecord<{ source: string; campaignId: string }>(merchantId, `campaign-origin:${campaign.id}`))?.payload;
      if (origin?.source === 'agent' && origin.campaignId === campaign.id) campaigns.push(campaign);
    }
    for (const campaign of campaigns) {
      await this.observeAudience(merchantId,campaign);
      const entry = progress.campaigns[campaign.id] ??= {};
      try {
        for (const period of ['daily', 'rolling'] as const) {
          if (entry[period]&&entry[period]!.confirmedOrdersStatus!=='unavailable') continue;
          await this.deps.daily.heartbeat(lease);
          const access = await this.deps.connection.access(merchantId);
          if (access.accountId !== lease.accountId) throw new MetaAdsError('meta_connection_changed', 409);
          const since = period === 'daily' ? lease.since : lease.analysisSince, until = lease.until;
          let metrics=entry[period];
          if(!metrics){
            const remote = await this.deps.provider.metrics(access, campaign, since, until);
            if (remote.timezone !== lease.timezone) throw new MetaAdsError('meta_timezone_unavailable', 409);
            const purchases = await this.deps.attribution.report(merchantId, since, until, lease.timezone);
            metrics = buildMetrics({ campaignId: campaign.id, remote, orders: purchases.filter(p => p.campaignId === campaign.id).map(p => p.fact), updatedAt: this.clock().toISOString() });
          }
          if(this.deps.sales){
            let canonical;try{canonical=await this.deps.sales.sales(merchantId,campaign.id,{since,until,page:1});}catch{/* A failed sales read does not discard confirmed Meta measurements. */}
            const available=canonical?.status==='available'&&canonical.currency===metrics.currency;
            const samePaidCohort=available&&canonical!.paidOrders===metrics.paidOrders&&canonical!.confirmedRevenueCents===metrics.confirmedRevenueCents;
            metrics.confirmedOrdersStatus=available?'available':'unavailable';
            metrics.confirmedRevenueCents=available?canonical!.confirmedRevenueCents:null;
            metrics.paidOrders=available?canonical!.paidOrders!:0;
            metrics.source=available?'meta_reported+zyon_reconciled':'meta_reported';
            metrics.costPerPurchaseCents=available&&metrics.paidOrders>0&&metrics.spendCents!==null?Math.round(metrics.spendCents/metrics.paidOrders):null;
            // Refunds and a changed paid cohort invalidate the old contribution estimate.
            if(!samePaidCohort){metrics.contributionCents=null;metrics.costCoverage='unavailable';}
            metrics.notes=metrics.notes.filter(n=>n!=='confirmed_orders_unavailable');
            if(!available)metrics.notes.push('confirmed_orders_unavailable');
            metrics.updatedAt=this.clock().toISOString();
          }
          await this.deps.repo.mutate(merchantId, [], current => {
            if (current.connection.epoch !== access.connectionEpoch || current.connection.account?.id !== lease.accountId) throw new MetaAdsError('meta_connection_changed', 409);
            if (period === 'rolling') current.metrics[campaign.id] = metrics;
            current.connection.clientConversationId = access.clientConversationId; return { result: null };
          });
          entry[period] = metrics; delete entry.error; await save();
        }
      } catch {
        entry.error = 'meta_metrics_unavailable'; await save();
        await this.deps.repo.mutate(merchantId, [], current => { const previous = current.metrics[campaign.id]; if (previous) { previous.stale = true; if (!previous.notes.includes('meta_metrics_unavailable')) previous.notes.push('meta_metrics_unavailable'); } return { result: null }; });
      }
    }
    const complete = campaigns.every(c => progress.campaigns[c.id]?.daily && progress.campaigns[c.id]?.rolling&&progress.campaigns[c.id].daily!.confirmedOrdersStatus!=='unavailable'&&progress.campaigns[c.id].rolling!.confirmedOrdersStatus!=='unavailable');
    const available = campaigns.flatMap(campaign => { const metrics = progress.campaigns[campaign.id]?.rolling; return metrics && assessData(campaign.draft.priority, metrics).status === 'available' ? [{ campaign, metrics }] : []; });
    if (complete && lease.analysisStatus === 'sending' && !this.deps.recommendations.durable) lease = await this.deps.daily.checkpoint(lease, { analysisStatus: 'unknown' });
    if (complete && ['pending', 'sending'].includes(lease.analysisStatus)) {
      if (!available.length) lease = await this.deps.daily.checkpoint(lease, { analysisStatus: 'awaiting_data' });
      else if (this.deps.recommendations.configured?.() === false) lease = await this.deps.daily.checkpoint(lease, { analysisStatus: 'unavailable' });
      else {
        requireEntitlement(await this.deps.commerce.getPlan(merchantId), await this.deps.repo.read(merchantId), this.clock());
        lease = await this.deps.daily.checkpoint(lease, { analysisStatus: 'sending' });
        const attemptKey = `daily-analysis-attempt:${lease.id}`;
        await this.deps.repo.mutate(merchantId, [attemptKey], (_current, records) => ({ result: null, records: records.has(attemptKey) ? [] : [{ key: attemptKey, kind: 'usage', payload: { component: 'daily_analysis', outcome: 'sending', usage: null }, createdAt: this.clock().toISOString() }] }));
        try {
          const result = await this.deps.recommendations.recommend({ merchantId, analysisKey: `meta-daily-${stableDigest({ merchantId, accountId: lease.accountId, day: lease.localDay })}`, campaigns: available });
          const usage = result.usage;
          const safeUsage = usage && /^[a-z0-9_-]{1,50}$/i.test(usage.provider) && /^[a-z0-9:/._-]{1,160}$/i.test(usage.model) ? {
            provider: usage.provider, model: usage.model, providerRequestId: usage.providerRequestId && /^[a-z0-9_.:-]{1,200}$/i.test(usage.providerRequestId) ? usage.providerRequestId : null,
            inputTokens: Number.isSafeInteger(usage.inputTokens) && usage.inputTokens! >= 0 ? usage.inputTokens : null,
            cachedInputTokens: Number.isSafeInteger(usage.cachedInputTokens) && usage.cachedInputTokens! >= 0 ? usage.cachedInputTokens : null,
            outputTokens: Number.isSafeInteger(usage.outputTokens) && usage.outputTokens! >= 0 ? usage.outputTokens : null,
            costMicros: /^\d{1,24}$/.test(usage.costMicros ?? '') ? usage.costMicros : null, currency: /^[A-Z]{3}$/.test(usage.currency ?? '') ? usage.currency : null,
            costStatus: ['estimated', 'provider_reported'].includes(usage.costStatus) ? usage.costStatus : 'unpriced' } : null;
          const resultKey = `daily-analysis-result:${lease.id}`;
          await this.deps.repo.mutate(merchantId, [resultKey], (_current, records) => ({ result: null, records: records.has(resultKey) ? [] : [{ key: resultKey, kind: 'usage', payload: { component: 'daily_analysis', outcome: 'completed', usage: safeUsage, correctsUsageKey: attemptKey }, createdAt: this.clock().toISOString() }] }));
          const seen = new Set<string>();
          for (const suggestion of result.recommendations) {
            const row = available.find(r => r.campaign.id === suggestion.campaignId);
            if (!row || seen.has(row.campaign.id) || !validSuggestion(suggestion, row.campaign)) continue; seen.add(row.campaign.id);
            progress.recommendations.push({ ...suggestion, id: `daily-rec-${stableDigest({ accountId: lease.accountId, day: lease.localDay, campaignId: row.campaign.id, kind: suggestion.proposedAction })}`, priority: row.campaign.draft.priority, evidence: recommendationEvidence(row.metrics), status: 'pending_review', createdAt: this.clock().toISOString() });
          }
          lease = await this.deps.daily.checkpoint(lease, { progress: progress as unknown as Record<string, unknown>, analysisStatus: 'completed' });
        } catch (error) {
          const code = (error as { code?: string }).code;
          lease = await this.deps.daily.checkpoint(lease, { analysisStatus: code === 'assistant_outcome_unknown' || code === 'assistant_operation_already_dispatched' ? 'unknown' : 'unavailable' });
        }
      }
    }
    for (const campaign of campaigns) {
      const metrics = progress.campaigns[campaign.id]?.rolling; if (!metrics || assessData(campaign.draft.priority, metrics).status === 'available') continue;
      if (!progress.recommendations.some(r => r.campaignId === campaign.id)) progress.recommendations.push({ id: `daily-await-${stableDigest({ accountId: lease.accountId, day: lease.localDay, campaignId: campaign.id })}`, campaignId: campaign.id, priority: campaign.draft.priority, hypothesis: `Aguardando dados: ${assessData(campaign.draft.priority, metrics).missing.join(', ')}`, evidence: recommendationEvidence(metrics), proposedAction: null, proposedFields: {}, status: 'awaiting_data', createdAt: this.clock().toISOString() });
    }
    await this.deps.repo.mutate(merchantId, [], current => { for (const r of progress.recommendations) current.recommendations[r.id] ??= r; return { result: null }; });
    for (const recommendation of progress.recommendations) if (recommendation.proposedAction && (!progress.actions[recommendation.id] || progress.actions[recommendation.id].status === 'generation_pending') && lease.analysisStatus === 'completed') {
      await this.deps.daily.heartbeat(lease);
      try { progress.actions[recommendation.id] = await this.deps.automatic.recommendation(merchantId, recommendation.id); }
      catch (error) { const code = (error as { code?: string }).code; progress.actions[recommendation.id] = { proposalId: '', executionId: null, status: 'blocked', reason: recommendation.hypothesis, error: typeof code === 'string' && /^(automatic_|authorization_|meta_|campaign_|recommendation_|image_|credit_)[a-z0-9_]{1,80}$/.test(code) ? code : 'automatic_action_unavailable' }; }
      await save();
    }
    report.campaigns = campaigns.map(campaign => {
      const entry = progress.campaigns[campaign.id], metrics = entry?.daily ?? null, rolling = entry?.rolling;
      const assessment = rolling ? assessData(campaign.draft.priority, rolling) : { status: 'awaiting_data' as const, missing: ['rolling_metrics'] };
      const recommendations = progress.recommendations.filter(r => r.campaignId === campaign.id);
      return { campaignId: campaign.id, metrics, status: !metrics || !rolling||metrics.confirmedOrdersStatus==='unavailable'||rolling.confirmedOrdersStatus==='unavailable' ? 'unavailable' : assessment.status, missing: assessment.missing, recommendations,
        actions: recommendations.flatMap(r => progress.actions[r.id] ? [progress.actions[r.id]] : []) };
    });
    const actionsPending = Object.values(progress.actions).some(action => action.status === 'generation_pending');
    report.status = complete && !actionsPending ? 'completed' : 'partial'; report.analysisStatus = lease.analysisStatus === 'sending' ? 'pending' : lease.analysisStatus;
    report.updatedAt = this.clock().toISOString(); report.collectedAt = report.campaigns.some(c => c.metrics) ? report.updatedAt : null;
    await this.deps.daily.checkpoint(lease, { progress: progress as unknown as Record<string, unknown>, report });
    await this.deps.daily.finish(lease, complete && !actionsPending ? 'completed' : 'partial');
  }
}
