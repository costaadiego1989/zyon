import { randomUUID } from "node:crypto";
import type { MetaAdsCampaign, MetaAdsMetrics, MetaAdsRecommendation } from "@zyon/shared-types";
import type { MetaAdsRepository, CommerceContextPort, MetaAdsProviderPort, RecommendationPort, AttributedPurchase, TextModelUsage, Clock } from "../domain/types.js";
import { requireEntitlement } from "../domain/offer.js";
import { buildMetrics, assessData } from "../domain/analytics.js";
import type { ConnectionService } from "../application/connection.service.js";
import type { BillingService } from "../application/billing.service.js";
import { recommendationEvidence, validSuggestion } from "./recommendation.adapter.js";
import type { DailyObservationEngine } from './daily-observation.engine.js';

type PurchaseReport = Pick<AttributedPurchase, "campaignId" | "fact">;
export class ObservationWorker {
  private timer: ReturnType<typeof setInterval> | undefined;
  private active: Promise<void> | undefined;
  private admissionTimer: ReturnType<typeof setInterval> | undefined;
  private stopping = false;
  constructor(private readonly repo: MetaAdsRepository, private readonly commerce: Pick<CommerceContextPort, "getPlan">,
    private readonly connection: Pick<ConnectionService, "access">, private readonly provider: Pick<MetaAdsProviderPort, "metrics">,
    private readonly attribution: { report(merchantId: string, since: string, until: string, timezone?: string): Promise<PurchaseReport[]> }, private readonly recommendations: RecommendationPort,
    private readonly billing: Pick<BillingService, "ensureEligibility">, private readonly config: { enabled: boolean; pageSize?: number }, private readonly clock: Clock = () => new Date(), private readonly daily?: DailyObservationEngine) {}
  onModuleInit(): void {
    if (!this.config.enabled) return;
    if (this.daily) {
      const admit = () => { void this.daily!.admitDue().then(() => this.drain()).catch(() => undefined); };
      this.admissionTimer = setInterval(admit, 30000); this.admissionTimer.unref();
      this.timer = setInterval(() => { void this.drain(); }, 3000); this.timer.unref(); admit(); return;
    }
    this.timer = setInterval(() => { void this.drain(); }, 60000); this.timer.unref(); void this.drain();
  }
  async onModuleDestroy(): Promise<void> { this.stopping = true; clearInterval(this.timer); clearInterval(this.admissionTimer); await this.active; await this.daily?.stop(); }
  drain(): Promise<void> { if (this.stopping) return Promise.resolve(); return this.active ??= (this.daily ? this.daily.drain() : this.run()).catch(() => undefined).finally(() => { this.active = undefined; }); }
  async run(): Promise<void> {
    if (this.daily) { await this.daily.admitDue(); await this.daily.drain(); return; }
    const size = Math.max(1, Math.min(100, this.config.pageSize ?? 100)); let after: string | undefined;
    while (!this.stopping) {
      const stores = await this.repo.listStoreIds(size, after); if (!stores.length) break;
      for (const merchantId of stores) {
        try { await this.observe(merchantId); } catch { /* A store outage must not stop the next tenant or expose provider errors. */ }
      }
      if (stores.length < size) break; after = stores.at(-1);
    }
  }
  private async observe(merchantId: string): Promise<void> {
    await this.billing.ensureEligibility(merchantId);
    const plan = await this.commerce.getPlan(merchantId); const state = await this.repo.read(merchantId);
    try { requireEntitlement(plan, state, this.clock()); } catch { return; }
    const day = this.clock().toISOString().slice(0, 10); const key = `daily-observation:${day}`;
    const claimed = await this.repo.mutate(merchantId, [key], (_current, records) => records.has(key) ? { result: false } : { result: true, records: [{ key, kind: "observation", payload: { status: "started", day }, createdAt: this.clock().toISOString() }] });
    if (!claimed) return;
    const until = day; const since = new Date(Date.parse(`${day}T00:00:00Z`) - 14 * 86400000).toISOString().slice(0, 10);
    const measured: Array<{ campaign: MetaAdsCampaign; metrics: MetaAdsMetrics }> = [];
    for (const campaign of Object.values(state.campaigns)) {
      if (!campaign.managed || !campaign.createdByAgent || !campaign.remoteCampaignId) continue;
      const origin = (await this.repo.getRecord<{ source: string; campaignId: string }>(merchantId, `campaign-origin:${campaign.id}`))?.payload;
      if (origin?.source !== "agent" || origin.campaignId !== campaign.id) continue;
      try {
        const access = await this.connection.access(merchantId);
        if (access.accountId !== campaign.remoteAccountId) throw new Error("account_changed");
        const remote = await this.provider.metrics(access, campaign, since, until);
        const purchases = remote.timezone === "unknown" ? [] : await this.attribution.report(merchantId, since, until, remote.timezone);
        const metrics = buildMetrics({ campaignId: campaign.id, remote, orders: purchases.filter(row => row.campaignId === campaign.id).map(row => row.fact), updatedAt: this.clock().toISOString() });
        if (remote.timezone === "unknown") { metrics.confirmedRevenueCents = null; metrics.notes.push("attribution_timezone_unavailable"); }
        await this.repo.mutate(merchantId, [], current => { current.metrics[campaign.id] = metrics; if (current.connection.epoch === access.connectionEpoch) current.connection.clientConversationId = access.clientConversationId; return { result: null }; });
        measured.push({ campaign, metrics });
      } catch {
        await this.repo.mutate(merchantId, [], current => { const previous = current.metrics[campaign.id]; if (previous) { previous.stale = true; if (!previous.notes.includes("meta_metrics_unavailable")) previous.notes.push("meta_metrics_unavailable"); } return { result: null }; });
      }
    }
    const pending: MetaAdsRecommendation[] = [];
    const available = measured.filter(row => {
      const assessment = assessData(row.campaign.draft.priority, row.metrics);
      if (assessment.status === "available") return true;
      pending.push({ id: randomUUID(), campaignId: row.campaign.id, priority: row.campaign.draft.priority, hypothesis: `Aguardando dados: ${assessment.missing.join(", ")}`, evidence: recommendationEvidence(row.metrics), proposedAction: null, proposedFields: {}, status: "awaiting_data", createdAt: this.clock().toISOString() }); return false;
    });
    if (available.length && this.recommendations.configured?.() !== false) {
      const currentPlan = await this.commerce.getPlan(merchantId);
      try { requireEntitlement(currentPlan, await this.repo.read(merchantId), this.clock()); } catch { return; }
      const attempt = `daily-analysis-attempt:${day}`;
      await this.repo.mutate(merchantId, [], () => ({ result: null, records: [{ key: attempt, kind: "usage", payload: { component: "daily_analysis", outcome: "sending", usage: null }, createdAt: this.clock().toISOString() }] }));
      let usage: TextModelUsage | null = null;
      try {
        const result = await this.recommendations.recommend({ merchantId, campaigns: available }); usage = result.usage;
        for (const suggestion of result.recommendations) {
          const row = available.find(value => value.campaign.id === suggestion.campaignId);
          if (!row || !validSuggestion(suggestion, row.campaign)) continue;
          pending.push({ id: randomUUID(), campaignId: row.campaign.id, priority: row.campaign.draft.priority, hypothesis: suggestion.hypothesis,
            evidence: recommendationEvidence(row.metrics), proposedAction: suggestion.proposedAction, proposedFields: suggestion.proposedFields, status: "pending_review", createdAt: this.clock().toISOString() });
        }
      } catch { /* Measurements remain available even when analysis fails. */ }
      const safeUsage = usage ? { provider: usage.provider, model: usage.model, providerRequestId: usage.providerRequestId, inputTokens: usage.inputTokens, cachedInputTokens: usage.cachedInputTokens, outputTokens: usage.outputTokens, costMicros: usage.costMicros, currency: usage.currency, costStatus: usage.costStatus } : null;
      await this.repo.mutate(merchantId, [], () => ({ result: null, records: [{ key: `daily-analysis-result:${day}`, kind: "usage", payload: { component: "daily_analysis", outcome: usage ? "completed" : "unreported", usage: safeUsage, correctsUsageKey: attempt }, createdAt: this.clock().toISOString() }] }));
    }
    await this.repo.mutate(merchantId, [], current => { for (const suggestion of pending) current.recommendations[suggestion.id] = suggestion; return { result: null, records: [{ key: `daily-observation-result:${day}`, kind: "observation", payload: { status: "completed", measuredCampaigns: measured.length, suggestions: pending.length }, createdAt: this.clock().toISOString() }] }; });
  }
}
