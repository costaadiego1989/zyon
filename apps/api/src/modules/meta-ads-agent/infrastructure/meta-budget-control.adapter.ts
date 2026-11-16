import type { MetaAdsAutomationLimits, MetaAdsBudget, MetaAdsCampaign } from '@zyon/shared-types';
import { MetaAdsError, type MetaAccess } from '../domain/types.js';
import type { MetaBudgetControlPort, MetaBudgetControlReading } from '../domain/budget-control.port.js';
import { stableDigest } from '../domain/offer.js';
import { MetaMcpSession, entityRows } from './meta-mcp.transport.js';
import { metaCurrencyCents } from './meta-money.js';

type Json = Record<string, unknown>;
interface Dependencies { request?: typeof fetch; clock?: () => Date; }
const unavailable = (): never => { throw new MetaAdsError('automatic_budget_control_unavailable', 503); };
const numericId = (value: unknown): value is string => typeof value === 'string' && value === value.trim() && /^\d+$/.test(value);
function instant(value: unknown): string {
  if (typeof value !== 'string' || !value.includes('T') || !Number.isFinite(Date.parse(value))) return unavailable();
  return new Date(value).toISOString();
}
const campaignFields = ['id', 'account_id', 'lifetime_budget', 'daily_budget', 'spend_cap', 'start_time', 'stop_time', 'status'];
const setFields = ['id', 'account_id', 'campaign_id', 'start_time', 'end_time', 'status'];
const adFields = ['id', 'account_id', 'campaign_id', 'adset_id', 'status'];
/** All calls are reads. No account-wide cap or automatic eligibility assumption is made. */
export class MetaBudgetControlAdapter implements MetaBudgetControlPort {
  private readonly request: typeof fetch;
  private readonly clock: () => Date;
  constructor(deps: Dependencies) { this.request = deps.request ?? fetch; this.clock = deps.clock ?? (() => new Date()); }
  private async account(session: MetaMcpSession, selected: string): Promise<void> {
    let cursor: string | undefined;
    for (let page = 0; page < 20; page++) {
      const result = await session.call('ads_get_ad_accounts', { limit: 50, ...(cursor ? { cursor } : {}) });
      if (!Array.isArray(result.ad_accounts)) return unavailable();
      const account = (result.ad_accounts as Json[]).find(a => String(a.ad_account_id).replace(/^act_/, '') === selected);
      if (account) { if (account.is_ads_mcp_enabled !== true || account.is_queryable !== true || account.currency !== 'BRL') return unavailable(); return; }
      cursor = typeof result.next_cursor === 'string' ? result.next_cursor : undefined;
      if (!cursor) throw new MetaAdsError('meta_asset_forbidden', 403);
    }
    return unavailable();
  }
  private async metadata(session: MetaMcpSession): Promise<void> {
    const names = [...new Set([...campaignFields, ...setFields, ...adFields])];
    const response = await session.call('ads_get_field_context', { field_names: names });
    if (!Array.isArray(response.fields) || !Array.isArray(response.unknown_fields) || response.unknown_fields.length) return unavailable();
    const fields = response.fields as Array<{ name: string; levels?: string[]; type?: string; filterable?: boolean; supported_filter_operators?: string[] }>;
    for (const [level, required] of [['campaign', campaignFields], ['adset', setFields], ['ad', adFields]] as const)
      for (const name of required) if (!fields.some(field => field.name === name && field.levels?.includes(level))) return unavailable();
    const filter = fields.find(field => field.name === 'campaign_id');
    if (!filter?.filterable || !filter.supported_filter_operators?.includes('IN')) return unavailable();
    for (const name of ['lifetime_budget', 'daily_budget', 'spend_cap']) if (fields.find(field => field.name === name)?.type?.toUpperCase() !== 'CURRENCY') return unavailable();
  }
  private async rows(session: MetaMcpSession, access: MetaAccess, level: string, fields: string[], campaignId: string): Promise<Json[]> {
    const rows: Json[] = []; let cursor: string | undefined;
    for (let page = 0; page < 20; page++) {
      const result = await session.call('ads_get_ad_entities', { ad_account_id: access.accountId, level, fields, object_state: 'live', limit: 100,
        ...(level === 'campaign' ? { object_ids: [campaignId] } : { filtering: [{ field: 'campaign_id', operator: 'IN', value: [campaignId] }] }), ...(cursor ? { cursor } : {}) });
      rows.push(...entityRows(result.ad_entities ?? []));
      const next = (result.pagination as Json | undefined)?.next_cursor ?? result.next_cursor;
      cursor = typeof next === 'string' ? next : undefined; if (!cursor) return rows;
    }
    return unavailable();
  }
  async read(access: MetaAccess, campaign: MetaAdsCampaign, scheduled = false): Promise<MetaBudgetControlReading> {
    if (!campaign.createdByAgent || !campaign.managed) throw new MetaAdsError('campaign_read_only', 403);
    if (!numericId(access.accountId) || campaign.remoteAccountId !== access.accountId) throw new MetaAdsError('meta_asset_forbidden', 403);
    if (!numericId(campaign.remoteCampaignId) || !numericId(campaign.remoteAdSetId) || !campaign.remoteAdIds.length || campaign.remoteAdIds.some(id => !numericId(id))) return unavailable();
    try {
      const session = new MetaMcpSession(access, this.request, 'update_existing_campaigns', false, scheduled); await session.start();
      await this.account(session, access.accountId); await this.metadata(session);
      const campaigns = await this.rows(session, access, 'campaign', campaignFields, campaign.remoteCampaignId);
      if (!campaigns.length) return unavailable();
      if (campaigns.length !== 1 || String(campaigns[0].id) !== campaign.remoteCampaignId || String(campaigns[0].account_id) !== access.accountId) throw new MetaAdsError('meta_asset_forbidden', 403);
      const [sets, ads] = await Promise.all([this.rows(session, access, 'adset', setFields, campaign.remoteCampaignId), this.rows(session, access, 'ad', adFields, campaign.remoteCampaignId)]);
      if ([...sets, ...ads].some(row => String(row.account_id) !== access.accountId || String(row.campaign_id) !== campaign.remoteCampaignId)) throw new MetaAdsError('meta_asset_forbidden', 403);
      const adIds = ads.map(row => String(row.id)).sort(); const expectedIds = [...campaign.remoteAdIds].sort();
      if (sets.length !== 1 || String(sets[0].id) !== campaign.remoteAdSetId || new Set(adIds).size !== adIds.length || stableDigest(adIds) !== stableDigest(expectedIds) || ads.some(ad => String(ad.adset_id) !== campaign.remoteAdSetId)) return unavailable();
      const amountCents = metaCurrencyCents(campaigns[0].lifetime_budget, 'BRL');
      const rawDaily = campaigns[0].daily_budget; const daily = rawDaily == null ? 0 : metaCurrencyCents(rawDaily, 'BRL');
      if (amountCents === null || amountCents <= 0 || daily !== 0) return unavailable();
      const startsAt = instant(sets[0].start_time), endsAt = instant(sets[0].end_time);
      if (Date.parse(endsAt) <= Date.parse(startsAt)) return unavailable();
      // Campaign dates are aggregates. Child dates are authoritative for the one owned set.
      if (campaigns[0].start_time != null && instant(campaigns[0].start_time) !== startsAt || campaigns[0].stop_time != null && instant(campaigns[0].stop_time) !== endsAt) throw new MetaAdsError('authorization_limit_exceeded', 409);
      const evidence = { campaignId: campaign.id, accountId: access.accountId, connectionEpoch: access.connectionEpoch, remoteCampaignId: campaign.remoteCampaignId, currency: 'BRL' as const, cadence: 'lifetime' as const, amountCents, startsAt, endsAt, adSetId: campaign.remoteAdSetId, adIds };
      return { ...evidence, kind: 'campaign_lifetime', checkedAt: this.clock().toISOString(), fingerprint: stableDigest(evidence) };
    } catch (error) {
      if (error instanceof MetaAdsError && ['meta_asset_forbidden', 'campaign_read_only', 'authorization_limit_exceeded', 'automatic_budget_control_unavailable'].includes(error.code)) throw error;
      return unavailable();
    }
  }
  async prove(access: MetaAccess, campaign: MetaAdsCampaign, target: MetaAdsBudget, limits: MetaAdsAutomationLimits, matchAmount = true, scheduled = false): Promise<MetaBudgetControlReading> {
    if (target.cadence !== 'lifetime' || limits.cadence !== 'lifetime') return unavailable();
    if (target.currency !== 'BRL' || limits.currency !== 'BRL' || !Number.isSafeInteger(target.amountCents) || target.amountCents <= 0 || target.amountCents > limits.campaignCeilingCents || !target.endsAt || !Number.isFinite(Date.parse(target.startsAt)) || !Number.isFinite(Date.parse(target.endsAt)) || Date.parse(target.startsAt) < Date.parse(limits.startsAt) || Date.parse(target.endsAt) > Date.parse(limits.endsAt)) throw new MetaAdsError('authorization_limit_exceeded', 409);
    const reading = await this.read(access, campaign, scheduled);
    if (Date.parse(reading.startsAt) !== Date.parse(target.startsAt) || Date.parse(reading.endsAt) !== Date.parse(target.endsAt!) || matchAmount && reading.amountCents !== target.amountCents) throw new MetaAdsError('authorization_limit_exceeded', 409);
    return reading;
  }
}
