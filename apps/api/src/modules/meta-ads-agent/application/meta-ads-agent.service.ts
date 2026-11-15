import type { MetaAdsOverview, MetaAdsProposal, MetaAdsCampaign } from "@zyon/shared-types";
import { MetaAdsError, type MetaAdsRepository, type CommerceContextPort, type MetaAdsProviderPort } from "../domain/types.js";
import { buildMetrics } from "../domain/analytics.js";
import type { MetaAdsEnvironment } from "../domain/offer.js";
import type { BillingService } from "./billing.service.js";
import type { ConnectionService } from "./connection.service.js";
import type { CampaignService } from "./campaign.service.js";
import type { GenerationService } from "./generation.service.js";
import type { ProposalService } from "./proposal.service.js";
import type { ExecutionService } from "./execution.service.js";
export function publicProposal(value: MetaAdsProposal): MetaAdsProposal {
  return { id: value.id, campaignId: value.campaignId, kind: value.kind, status: value.status, before: value.before, after: value.after, digest: value.digest, connectionEpoch: value.connectionEpoch, reasoning: value.reasoning, createdAt: value.createdAt, approvedAt: value.approvedAt, approvedBy: value.approvedBy, executionId: value.executionId };
}
export class MetaAdsAgentService {
  constructor(readonly repo: MetaAdsRepository, readonly commerce: CommerceContextPort, readonly billing: BillingService, readonly connection: ConnectionService,
    readonly campaigns: CampaignService, readonly generations: GenerationService, readonly proposals: ProposalService, readonly executions: ExecutionService,
    readonly provider: MetaAdsProviderPort, readonly env: MetaAdsEnvironment) {}
  async analyzeExisting(merchantId: string, remoteId: string, since: string, until: string) {
    await this.billing.requireAccess(merchantId);
    if (!/^\d+$/.test(remoteId) || !/^\d{4}-\d{2}-\d{2}$/.test(since ?? "") || !/^\d{4}-\d{2}-\d{2}$/.test(until ?? "") || !Number.isFinite(Date.parse(since)) || !Number.isFinite(Date.parse(until)) || Date.parse(until) < Date.parse(since) || Date.parse(until) - Date.parse(since) > 366 * 86400000) throw new MetaAdsError("meta_analysis_period_invalid");
    const access = await this.connection.access(merchantId); const existing = (await this.provider.existingCampaigns(access)).find(value => value.id === remoteId);
    if (!existing) throw new MetaAdsError("meta_asset_forbidden", 403);
    const now = new Date().toISOString();
    const campaign: MetaAdsCampaign = { id: `existing-${remoteId}`, draft: { name: existing.name, destination: "store", priority: "paid_sales", variantIds: [], mediaIds: [], budget: null, country: "BR", headline: "", primaryText: "" }, products: [], createdByAgent: false, managed: false, remoteCampaignId: remoteId, remoteAdSetId: null, remoteAdIds: [], remoteAccountId: access.accountId, status: "draft", createdAt: now, updatedAt: now };
    const remote = await this.provider.metrics(access, campaign, since, until); const metrics = buildMetrics({ campaignId: campaign.id, remote, orders: [], updatedAt: now });
    return { ...metrics, source: "meta_reported", confirmedRevenueCents: null, notes: [...metrics.notes, "existing_campaign_read_only"] };
  }
  async overview(merchantId: string): Promise<MetaAdsOverview> {
    const [description, history, connection] = await Promise.all([this.billing.describe(merchantId), this.billing.history(merchantId), this.connection.view(merchantId)]);
    let entitled = false; try { await this.billing.requireAccess(merchantId); entitled = true; } catch { /* Retained history is readable after expiry. */ }
    return { eligible: description.eligible, entitled, offer: description.offer, subscription: description.subscription, wallet: description.wallet, connection,
      campaigns: history.campaigns, media: history.media, generations: history.generations, proposals: history.proposals.map(publicProposal), executions: history.executions, metrics: history.metrics, recommendations: history.recommendations };
  }
}
