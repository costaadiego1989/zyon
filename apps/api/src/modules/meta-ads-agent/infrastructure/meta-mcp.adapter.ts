import type { MetaAdsCampaign, MetaAdsMedia, MetaAdsProposal, MetaAdsExecution, MetaAdsBudget } from "@zyon/shared-types";
import { MetaAdsError, type MetaAdsProviderPort, type MetaAccess, type MetaDiscovery, type RemoteSnapshot, type ProviderExecutionResult, type ProviderMetricSnapshot } from "../domain/types.js";
import type { MetaAdsEnvironment } from "../domain/offer.js";
import { stableDigest } from "../domain/offer.js";
import { McpFailure, MetaMcpSession, decoded, entityRows } from "./meta-mcp.transport.js";
import { metaCurrencyCents } from './meta-money.js';

type Json = Record<string, unknown>;
type Objects = MetaAdsExecution["objects"];
const createTools = ["ads_create_campaign", "ads_create_ad_set", "ads_create_creative", "ads_create_ad"];
function id(value: unknown): string {
  if (typeof value !== "string" || !/^\d+$/.test(value)) throw new MetaAdsError("meta_asset_invalid");
  return value;
}
function list(value: unknown): Json[] { if (!Array.isArray(value)) throw new McpFailure("meta_response_invalid", false); return value as Json[]; }
function count(value: unknown): number | null {
  const raw = value && typeof value === 'object' && !Array.isArray(value) ? (value as Json).value : value;
  if (typeof raw !== 'number' && typeof raw !== 'string' || !/^\d+$/.test(String(raw))) return null;
  const number = Number(raw); return Number.isSafeInteger(number) && number >= 0 ? number : null;
}
function budgetValue(value: unknown): unknown {
  if (value && typeof value === 'object') {
    const cents = metaCurrencyCents(value, 'BRL');
    if (cents === null) throw new MetaAdsError('meta_currency_invalid', 409);
    return cents;
  }
  return value ?? null;
}
function refs(campaign: MetaAdsCampaign): Objects {
  return [...(campaign.remoteCampaignId ? [{ type: "campaign" as const, id: campaign.remoteCampaignId }] : []), ...(campaign.remoteAdSetId ? [{ type: "ad_set" as const, id: campaign.remoteAdSetId }] : []), ...campaign.remoteAdIds.map(value => ({ type: "ad" as const, id: value }))];
}

export class MetaMcpAdapter implements MetaAdsProviderPort {
  constructor(private readonly env: MetaAdsEnvironment, private readonly request: typeof fetch = fetch,
    private readonly trackedLink?: (merchantId: string, campaignId: string, original: string) => string) {}
  private session(access: MetaAccess, job: string, scheduled = false) {
    return new MetaMcpSession(access, this.request, job, this.env.META_ADS_AGENT_REMOTE_WRITES_ENABLED === "true", scheduled);
  }
  private async pages(session: MetaMcpSession, tool: string, args: Json, property: string): Promise<Json[]> {
    const result: Json[] = []; let cursor: string | undefined;
    for (let page = 0; page < 20; page++) {
      const response = await session.call(tool, { ...args, ...(cursor ? { cursor } : {}), limit: 100 });
      result.push(...list(response[property]));
      const pageInfo = response.page_info as Json | undefined;
      cursor = typeof response.next_cursor === "string" ? response.next_cursor : typeof pageInfo?.after_cursor === "string" && pageInfo.has_next_page === true ? pageInfo.after_cursor : undefined;
      if (!cursor) return result;
    }
    throw new McpFailure("meta_pagination_limit", false);
  }
  private async account(session: MetaMcpSession, access: MetaAccess): Promise<Json> {
    const accounts = await this.pages(session, "ads_get_ad_accounts", {}, "ad_accounts");
    const account = accounts.find(row => String(row.ad_account_id).replace(/^act_/, "") === access.accountId?.replace(/^act_/, ""));
    if (!account || account.is_queryable !== true || account.is_ads_mcp_enabled !== true) throw new MetaAdsError("meta_asset_forbidden", 403);
    return account;
  }
  async discover(access: MetaAccess): Promise<MetaDiscovery> {
    const session = this.session(access, "set_up_and_fix_ad_account"); await session.start();
    const rawAccounts = await this.pages(session, "ads_get_ad_accounts", {}, "ad_accounts");
    const accounts = rawAccounts.filter(a => a.is_queryable === true && a.is_ads_mcp_enabled === true).map(a => ({ id: String(a.ad_account_id).replace(/^act_/, ""), name: String(a.ad_account_name) }));
    const selectedAccount = access.accountId?.replace(/^act_/, "");
    if (selectedAccount && !accounts.some(a => a.id === selectedAccount)) throw new MetaAdsError("meta_asset_forbidden", 403);
    const discovery: MetaDiscovery = { accounts, pages: [], catalogs: [], datasets: [], whatsappNumbers: [], errors: [], capabilities: {
      prepare: createTools.every(n => session.has(n)) && this.env.META_ADS_AGENT_REMOTE_WRITES_ENABLED === "true", publish: session.has("ads_activate_entity") && this.env.META_ADS_AGENT_REMOTE_WRITES_ENABLED === "true", optimize: session.has("ads_update_entity") && this.env.META_ADS_AGENT_REMOTE_WRITES_ENABLED === "true", catalog: false, whatsapp: false,
    } };
    const collect = async (capability: "pages" | "catalogs" | "datasets", tool: string, args: Json, key: string, idKey: string, nameKey: string) => {
      try {
        const rows = await this.pages(session, tool, args, key);
        discovery[capability] = rows.map(row => ({ id: String(row[idKey]), name: String(row[nameKey]), ...(access.accountId ? { accountId: access.accountId } : {}) }));
        discovery.capabilities[capability === "catalogs" ? "catalog" : capability] = true;
      } catch (error) {
        discovery.errors.push(capability === "catalogs" && error instanceof MetaAdsError && error.code === "meta_permission_denied" ? "catalog_access_denied" : `${capability}_unavailable`);
      }
    };
    await collect("pages", access.accountId ? "ads_get_ad_account_pages" : "ads_get_user_pages", access.accountId ? { ad_account_id: access.accountId } : {}, "pages", "page_id", "page_name");
    await collect("catalogs", "ads_catalog_list_catalogs", access.accountId ? { entity_id: access.accountId } : {}, "catalogs", "catalog_id", "name");
    await collect("datasets", "ads_get_datasets", access.accountId ? { ad_account_id: access.accountId } : {}, "datasets", "dataset_id", "name");
    for (const page of discovery.pages) {
      try {
        const phone = await this.pagePhone(access, page.id);
        if (phone) discovery.whatsappNumbers.push({ id: phone, name: `WhatsApp ${phone}`, pageId: page.id, ...(access.accountId ? { accountId: access.accountId } : {}) });
      } catch { if (!discovery.errors.includes("whatsapp_unavailable")) discovery.errors.push("whatsapp_unavailable"); }
    }
    discovery.capabilities.whatsapp = discovery.whatsappNumbers.length > 0;
    return discovery;
  }
  private async pagePhone(access: MetaAccess, pageId: string): Promise<string | null> {
    if (!/^v\d+\.0$/.test(this.env.META_ADS_GRAPH_API_VERSION ?? "")) throw new MetaAdsError("meta_graph_not_configured", 503);
    const response = await this.request(`https://graph.facebook.com/${this.env.META_ADS_GRAPH_API_VERSION}/${id(pageId)}?fields=id,whatsapp_number,has_whatsapp_number,has_whatsapp_business_number`, { headers: { Authorization: `Bearer ${access.accessToken}` }, redirect: "error", signal: AbortSignal.timeout(15000) });
    const body = await response.json() as Json;
    if (!response.ok || body.error || String(body.id) !== pageId) throw new MetaAdsError("meta_whatsapp_access_denied", 403);
    const phone = typeof body.whatsapp_number === "string" ? body.whatsapp_number.replace(/\D/g, "") : "";
    return (body.has_whatsapp_number === true||body.has_whatsapp_business_number===true) && /^\d{10,15}$/.test(phone) ? phone : null;
  }
  private async entities(session: MetaMcpSession, access: MetaAccess, level: string, fields: string[], ids?: string[], extra: Json = {}): Promise<Json[]> {
    await session.fields(fields);
    const rows: Json[] = []; let cursor: string | undefined;
    for (let page = 0; page < 20; page++) {
      const response = await session.call("ads_get_ad_entities", { ad_account_id: access.accountId, level, fields, ...(ids?.length ? { object_ids: ids } : {}), ...extra, ...(cursor ? { cursor } : {}), limit: 100 });
      rows.push(...entityRows(response.ad_entities ?? response.ad_drafts ?? []));
      cursor = typeof response.next_cursor === "string" ? response.next_cursor : typeof (response.pagination as Json | undefined)?.next_cursor === "string" ? String((response.pagination as Json).next_cursor) : undefined;
      if (!cursor) return rows;
    }
    throw new McpFailure("meta_pagination_limit", false);
  }
  async existingCampaigns(access: MetaAccess) {
    const session = this.session(access, "assess_and_optimize_performance"); await session.start(); await this.account(session, access);
    return (await this.entities(session, access, "campaign", ["id", "name", "status"])).map(row => ({ id: String(row.id ?? row.campaign_id), name: String(row.name ?? row.campaign_name), status: String(row.status) }));
  }
  private async snapshotWith(session: MetaMcpSession, access: MetaAccess, campaign: MetaAdsCampaign): Promise<RemoteSnapshot> {
    if (!campaign.remoteCampaignId) throw new MetaAdsError("meta_campaign_missing", 409);
    const fields = ["id", "status", "effective_status", "daily_budget", "lifetime_budget", "spend_cap"];
    let rows = await this.entities(session, access, "campaign", fields, [campaign.remoteCampaignId], { object_state: "live" });
    if (!rows.length) rows = await this.entities(session, access, "campaign", fields, [campaign.remoteCampaignId], { object_state: "draft" });
    const row = rows.find(r => String(r.id ?? r.campaign_id ?? r.ad_object_id) === campaign.remoteCampaignId);
    if (!row) throw new MetaAdsError("meta_campaign_missing", 404);
    const sets = campaign.remoteAdSetId ? (await this.entities(session, access, "adset", ["id", "status", "effective_status", "targeting", "start_time", "end_time"], [campaign.remoteAdSetId])).filter(set => String(set.id ?? set.ad_set_id ?? set.ad_object_id) === campaign.remoteAdSetId) : [];
    const ads = campaign.remoteAdIds.length ? (await this.entities(session, access, "ad", ["id", "status", "effective_status", "creative_id"], campaign.remoteAdIds)).filter(ad => campaign.remoteAdIds.includes(String(ad.id ?? ad.ad_id ?? ad.ad_object_id))) : [];
    return { ...(sets.length === 1 && Object.hasOwn(sets[0], 'start_time') && Object.hasOwn(sets[0], 'end_time') ? { schedule: { startsAt: typeof sets[0].start_time === 'string' ? sets[0].start_time : null, endsAt: typeof sets[0].end_time === 'string' ? sets[0].end_time : null } } : {}), campaignId: campaign.remoteCampaignId, status: String(row.status ?? "UNKNOWN"), effectiveStatus: String(row.effective_status ?? "UNKNOWN"),
      budget: { daily_budget: budgetValue(row.daily_budget), lifetime_budget: budgetValue(row.lifetime_budget), spend_cap: budgetValue(row.spend_cap) }, targeting: (sets[0]?.targeting ?? {}) as Json,
      adSetId: campaign.remoteAdSetId, adIds: ads.map(ad => String(ad.id ?? ad.ad_id ?? ad.ad_object_id)), creativeIds: ads.flatMap(ad => typeof ad.creative_id === "string" ? [ad.creative_id] : []),
      objectStates: [...sets.map(set => ({ type: "ad_set" as const, id: String(set.id ?? set.ad_set_id ?? set.ad_object_id), status: String(set.status ?? "UNKNOWN"), effectiveStatus: String(set.effective_status ?? "UNKNOWN") })),
        ...ads.map(ad => ({ type: "ad" as const, id: String(ad.id ?? ad.ad_id ?? ad.ad_object_id), status: String(ad.status ?? "UNKNOWN"), effectiveStatus: String(ad.effective_status ?? "UNKNOWN") }))] };
  }
  async snapshot(access: MetaAccess, campaign: MetaAdsCampaign): Promise<RemoteSnapshot> {
    const session = this.session(access, "update_existing_campaigns"); await session.start(); await this.account(session, access);
    return this.snapshotWith(session, access, campaign);
  }
  private owned(campaign: MetaAdsCampaign): void { if (!campaign.createdByAgent || !campaign.managed) throw new MetaAdsError("campaign_read_only", 403); }
  private budget(budget: MetaAdsBudget | null): Json {
    if (!budget || budget.currency !== "BRL" || !Number.isSafeInteger(budget.amountCents) || budget.amountCents <= 0 || !["daily", "lifetime"].includes(budget.cadence)) throw new MetaAdsError("campaign_budget_invalid");
    return { [budget.cadence === "daily" ? "campaign_daily_budget" : "campaign_lifetime_budget"]: budget.amountCents };
  }
  private async creative(session: MetaMcpSession, access: MetaAccess, campaign: MetaAdsCampaign, media: MetaAdsMedia[]): Promise<Json> {
    if (media.length < 1 || media.length > 10 || media.some(m => m.campaignId !== campaign.id || !campaign.products.some(p => p.variantId === m.variantId))) throw new MetaAdsError("campaign_media_invalid");
    const whatsapp = campaign.draft.destination === "whatsapp";
    if (whatsapp && (!access.whatsappId || await this.pagePhone(access, id(access.pageId)) !== access.whatsappId)) throw new MetaAdsError("meta_whatsapp_not_linked", 403);
    const link = (item: MetaAdsMedia) => {
      if (whatsapp) return `https://wa.me/${access.whatsappId}`;
      const canonical = campaign.products.find(p => p.variantId === item.variantId)!.storefrontUrl;
      return this.trackedLink ? this.trackedLink(access.merchantId, campaign.id, canonical) : canonical;
    };
    return session.call("ads_create_creative", { ad_account_id: access.accountId, page_id: id(access.pageId), name: campaign.draft.name, message: campaign.draft.primaryText, headline: campaign.draft.headline,
      call_to_action_type: whatsapp ? "WHATSAPP_MESSAGE" : "SHOP_NOW", advantage_plus_creative: false,
      ...(media.length === 1 ? { image_url: media[0].url, link_url: link(media[0]) } : { cards: media.map(m => ({ image_url: m.url, link: link(m), headline: campaign.draft.headline })) }),
    }, true);
  }
  private failure(error: unknown, objects: Objects): ProviderExecutionResult {
    return { status: error instanceof McpFailure && error.uncertain ? "execution_unknown" : "failed", objects, error: error instanceof MetaAdsError ? error.code : "meta_execution_unknown" };
  }
  async prepare(access: MetaAccess, campaign: MetaAdsCampaign, media: MetaAdsMedia[], onProgress: (objects: Objects) => Promise<void>): Promise<ProviderExecutionResult> {
    this.owned(campaign); const objects: Objects = [];
    const progress = async (type: Objects[number]["type"], value: unknown) => { objects.push({ type, id: id(value) }); try { await onProgress([...objects]); } catch { throw new McpFailure("meta_progress_persistence_failed", true); } };
    try {
      const session = this.session(access, "create_and_launch_new_ads"); await session.start(); session.require(createTools);
      const account = await this.account(session, access);
      if (account.currency !== "BRL") throw new MetaAdsError("meta_currency_mismatch");
      if (campaign.draft.budget?.cadence === "daily" && campaign.draft.budget.amountCents < Number(account.min_daily_budget_cents)) throw new MetaAdsError("campaign_budget_below_minimum");
      const pages = await this.pages(session, "ads_get_ad_account_pages", { ad_account_id: access.accountId }, "pages");
      if (!pages.some(p => p.page_id === access.pageId)) throw new MetaAdsError("meta_asset_forbidden", 403);
      const whatsapp = campaign.draft.destination === "whatsapp";
      if (whatsapp) { if (!access.whatsappId || await this.pagePhone(access, id(access.pageId)) !== access.whatsappId) throw new MetaAdsError("meta_whatsapp_not_linked", 403); }
      else {
        const datasets = await this.pages(session, "ads_get_datasets", { ad_account_id: access.accountId }, "datasets");
        if (!datasets.some(d => d.dataset_id === access.datasetId && d.is_active === true)) throw new MetaAdsError("meta_dataset_required", 403);
      }
      const created = await session.call("ads_create_campaign", { ad_account_id: access.accountId, campaign_name: campaign.draft.name, buying_type: "AUCTION", objective: whatsapp ? "OUTCOME_ENGAGEMENT" : "OUTCOME_SALES", special_ad_categories: "[]", ...this.budget(campaign.draft.budget) }, true);
      await progress("campaign", created.campaign_id);
      if (!["DRAFT", "PAUSED"].includes(String(created.status))) throw new McpFailure("meta_unexpected_remote_status", true);
      const goal = whatsapp ? "CONVERSATIONS" : "OFFSITE_CONVERSIONS";
      const goals = decoded(created.valid_optimization_goals);
      if (!Array.isArray(goals) || !goals.includes(goal)) throw new MetaAdsError("meta_optimization_unavailable", 503);
      await this.entities(session, access, "campaign", ["id", "daily_budget", "lifetime_budget"], [String(created.campaign_id)], { object_state: created.status === "DRAFT" ? "draft" : "live" });
      const set = await session.call("ads_create_ad_set", { ad_account_id: access.accountId, campaign_id: created.campaign_id, ad_set_name: campaign.draft.name, billing_event: "IMPRESSIONS", optimization_goal: goal,
        destination_type: whatsapp ? "WHATSAPP" : "WEBSITE", promoted_object: JSON.stringify(whatsapp ? { page_id: access.pageId } : { pixel_id: access.datasetId, custom_event_type: "PURCHASE" }),
        targeting: JSON.stringify({ geo_locations: { countries: [campaign.draft.country] }, age_min: 18, targeting_automation: { advantage_audience: 1 } }), start_time: campaign.draft.budget!.startsAt, ...(campaign.draft.budget!.endsAt ? { end_time: campaign.draft.budget!.endsAt } : {}),
      }, true);
      await progress("ad_set", set.ad_set_id);
      if (!["DRAFT", "PAUSED"].includes(String(set.status))) throw new McpFailure("meta_unexpected_remote_status", true);
      const creative = await this.creative(session, access, campaign, media); await progress("creative", creative.creative_id);
      const setRows = await this.entities(session, access, "adset", ["id", "status", "effective_status"], [String(set.ad_set_id)], { object_state: set.status === "DRAFT" ? "draft" : "live" });
      if (setRows.some(r => ["DELETED", "ARCHIVED"].includes(String(r.status)))) throw new MetaAdsError("meta_ad_set_unavailable", 409);
      const ad = await session.call("ads_create_ad", { ad_account_id: access.accountId, ad_set_id: set.ad_set_id, ad_name: campaign.draft.name, creative: JSON.stringify({ creative_id: creative.creative_id }) }, true); await progress("ad", ad.ad_id);
      if (!["DRAFT", "PAUSED"].includes(String(ad.status))) throw new McpFailure("meta_unexpected_remote_status", true);
      if ([created, set, ad].some(result => result.active_errors && list(decoded(result.active_errors)).length)) return { status: "remote_draft", objects, error: "meta_validation_errors" };
      return { status: [created, set, ad].some(result => result.status === "DRAFT") ? "remote_draft" : "remote_paused", objects };
    } catch (error) { return this.failure(error, objects); }
  }
  private async publish(session: MetaMcpSession, access: MetaAccess, objects: Objects, onProgress: (objects: Objects) => Promise<void>): Promise<ProviderExecutionResult> {
    let completedWrite = false;
    try {
      const targets = objects.filter(ref => ref.type !== 'creative');
      for (const ref of targets) {
        const result = await session.call('ads_activate_entity', { ad_account_id: access.accountId, entity_id: ref.id, entity_type: ref.type, object_ids: targets.map(o => o.id), publish_as_active: true, allow_partial_publish: false }, true);
        completedWrite = true; await onProgress([...objects]);
        const status = String((decoded(result.result ?? result) as Json).status);
        if (status === 'PUBLISHING') return { status: 'publishing', objects };
        if (status !== 'ACTIVE') throw new McpFailure('meta_publication_unconfirmed', true);
      }
      return { status: 'active_unconfirmed', objects };
    } catch (error) { return completedWrite ? { status: 'execution_unknown', objects, error: error instanceof MetaAdsError ? error.code : 'meta_execution_unknown' } : this.failure(error, objects); }
  }
  private async verifyLaunch(session: MetaMcpSession, access: MetaAccess, campaign: MetaAdsCampaign, objects: Objects): Promise<void> {
    const budget = campaign.draft.budget!;
    const campaigns = await this.entities(session, access, 'campaign', ['id', 'account_id', 'status', 'daily_budget', 'lifetime_budget'], [campaign.remoteCampaignId!]);
    const sets = await this.entities(session, access, 'adset', ['id', 'account_id', 'campaign_id', 'status', 'start_time', 'end_time'], [campaign.remoteAdSetId!]);
    const ads = await this.entities(session, access, 'ad', ['id', 'account_id', 'campaign_id', 'adset_id', 'creative_id', 'status'], campaign.remoteAdIds);
    const equalDate = (value: unknown, expected: string | null) => expected === null ? value == null : typeof value === 'string' && Number.isFinite(Date.parse(value)) && Date.parse(value) === Date.parse(expected);
    const sameAccount = (row: Json) => String(row.account_id) === access.accountId && ['PAUSED', 'DRAFT'].includes(String(row.status));
    const creative = objects.find(ref => ref.type === 'creative')!.id;
    if (campaigns.length !== 1 || String(campaigns[0].id) !== campaign.remoteCampaignId || !sameAccount(campaigns[0]) || Number(budgetValue(campaigns[0][budget.cadence === 'daily' ? 'daily_budget' : 'lifetime_budget'])) !== budget.amountCents || Number(budgetValue(campaigns[0][budget.cadence === 'daily' ? 'lifetime_budget' : 'daily_budget'])) !== 0 ||
      sets.length !== 1 || String(sets[0].id) !== campaign.remoteAdSetId || !sameAccount(sets[0]) || String(sets[0].campaign_id) !== campaign.remoteCampaignId || !equalDate(sets[0].start_time, budget.startsAt) || !equalDate(sets[0].end_time, budget.endsAt) ||
      ads.length !== campaign.remoteAdIds.length || new Set(ads.map(row => String(row.id))).size !== ads.length || ads.some(row => !campaign.remoteAdIds.includes(String(row.id)) || !sameAccount(row) || String(row.campaign_id) !== campaign.remoteCampaignId || String(row.adset_id) !== campaign.remoteAdSetId || String(row.creative_id) !== creative)) throw new MetaAdsError('proposal_stale', 409);
  }
  private async launch(access: MetaAccess, campaign: MetaAdsCampaign, proposal: MetaAdsProposal, onProgress: (objects: Objects) => Promise<void>): Promise<ProviderExecutionResult> {
    let objects: Objects = [];
    try {
      if (campaign.remoteCampaignId || campaign.remoteAdSetId || campaign.remoteAdIds.length) throw new MetaAdsError('campaign_already_prepared', 409);
      const media = proposal.after.media as MetaAdsMedia[];
      const products = proposal.after.products as MetaAdsCampaign['products'];
      if (proposal.after.status !== 'ACTIVE' || stableDigest(proposal.after.draft) !== stableDigest(campaign.draft) || !Array.isArray(products) || stableDigest(Object.fromEntries(products.map(product => [product.variantId, product]))) !== stableDigest(Object.fromEntries(campaign.products.map(product => [product.variantId, product]))) ||
        ['accountId', 'pageId', 'datasetId', 'whatsappId'].some(key => proposal.after[key] !== access[key as keyof MetaAccess]) || !Array.isArray(media) || stableDigest(media.map(item => item.id)) !== stableDigest(campaign.draft.mediaIds) ||
        media.some(item => item.commercialReview?.status !== 'verified' || item.commercialReview.productVersion !== item.productVersion || !/^[a-f0-9]{64}$/i.test(item.commercialReview.imageSha256))) throw new MetaAdsError('proposal_stale', 409);
      const session = this.session(access, 'create_and_launch_new_ads'); await session.start(); session.require([...createTools, 'ads_activate_entity']);
      const prepared = await this.prepare(access, campaign, media, onProgress); objects = prepared.objects;
      if (prepared.error || !['remote_paused', 'remote_draft'].includes(prepared.status)) return prepared;
      if (objects.length !== 4 || ['campaign', 'ad_set', 'creative', 'ad'].some(type => objects.filter(ref => ref.type === type).length !== 1)) throw new McpFailure('meta_preparation_incomplete', true);
      const staged: MetaAdsCampaign = { ...campaign, remoteCampaignId: objects.find(ref => ref.type === 'campaign')!.id, remoteAdSetId: objects.find(ref => ref.type === 'ad_set')!.id, remoteAdIds: objects.filter(ref => ref.type === 'ad').map(ref => ref.id), remoteAccountId: access.accountId };
      const account = await this.account(session, access);
      if (account.has_payment_method !== true) throw new MetaAdsError('meta_funding_required', 409);
      await this.verifyLaunch(session, access, staged, objects);
      return this.publish(session, access, objects, onProgress);
    } catch (error) { return this.failure(error, objects); }
  }
  async execute(access: MetaAccess, campaign: MetaAdsCampaign, proposal: MetaAdsProposal, onProgress: (objects: Objects) => Promise<void>): Promise<ProviderExecutionResult> {
    this.owned(campaign);
    const authority = access.executionAuthority;
    const automatic = proposal.status === 'pending_review' && proposal.approvedBy === null && proposal.approvedAt === null && authority?.kind === 'automatic' && authority.proposalId === proposal.id && authority.proposalDigest === proposal.digest && authority.connectionEpoch === access.connectionEpoch && typeof access.assertWriteAuthorized === 'function';
    if ((!automatic && proposal.status !== "approved") || proposal.campaignId !== campaign.id || proposal.connectionEpoch !== access.connectionEpoch) throw new MetaAdsError("proposal_not_approved", 403);
    if (proposal.kind === 'launch') {
      if (automatic || !proposal.approvedBy || !proposal.approvedAt || typeof access.assertWriteAuthorized !== 'function') throw new MetaAdsError('proposal_not_approved', 403);
      return this.launch(access, campaign, proposal, onProgress);
    }
    const objects = refs(campaign);
    let completedWrite = false;
    try {
      const session = this.session(access, "update_existing_campaigns"); await session.start(); const account = await this.account(session, access);
      if (!campaign.remoteCampaignId) throw new MetaAdsError("meta_campaign_missing", 409);
      if (proposal.kind === "publish") {
        if (account.has_payment_method !== true) throw new MetaAdsError("meta_funding_required", 409);
        return this.publish(session, access, objects, onProgress);
      }
      let fields: Json; let target = campaign.remoteCampaignId; let type = "campaign";
      if (proposal.kind === "pause") fields = { status: "PAUSED" };
      else if (proposal.kind === "budget") {
        const budget = proposal.after.budget as MetaAdsBudget;
        this.budget(budget); fields = { [budget.cadence === "daily" ? "daily_budget" : "lifetime_budget"]: budget.amountCents };
      } else if (proposal.kind === "audience") {
        if (!/^[A-Z]{2}$/.test(String(proposal.after.country))) throw new MetaAdsError("campaign_country_invalid");
        const snapshot = await this.snapshotWith(session, access, campaign);
        fields = { targeting: { ...snapshot.targeting, geo_locations: { countries: [proposal.after.country] } } }; target = id(campaign.remoteAdSetId); type = "ad_set";
      } else if (proposal.kind === "creative") {
        const creative = await this.creative(session, access, campaign, proposal.after.media as MetaAdsMedia[]);
        completedWrite = true;
        objects.push({ type: "creative", id: id(creative.creative_id) }); await onProgress([...objects]);
        if (campaign.remoteAdIds.length !== 1) throw new MetaAdsError("meta_creative_scope_invalid", 409);
        target = id(campaign.remoteAdIds[0]); type = "ad"; fields = { creative: { creative_id: creative.creative_id } };
      } else throw new MetaAdsError("meta_action_invalid");
      const result = await session.call("ads_update_entity", { ad_account_id: access.accountId, entity_id: target, entity_type: type, fields: JSON.stringify(fields) }, true);
      completedWrite = true;
      await onProgress([...objects]);
      if (result.is_draft === true && result.active_errors && list(decoded(result.active_errors)).length) return { status: "remote_draft", objects, error: "meta_validation_errors" };
      const readback = await this.snapshotWith(session, access, campaign);
      if (proposal.kind === "pause" && readback.status !== "PAUSED") return { status: "execution_unknown", objects, error: "meta_pause_unconfirmed" };
      if (proposal.kind === "budget" && Object.entries(fields).some(([key, value]) => Number(readback.budget[key]) !== value)) return { status: "execution_unknown", objects, error: "meta_budget_unconfirmed" };
      if (proposal.kind === "creative" && !readback.creativeIds.includes(String((fields.creative as Json).creative_id))) return { status: "execution_unknown", objects, error: "meta_creative_unconfirmed" };
      if (proposal.kind === "audience" && stableDigest(readback.targeting) !== stableDigest(fields.targeting)) return { status: "execution_unknown", objects, error: "meta_audience_unconfirmed" };
      return { status: result.is_draft === true ? "remote_draft" : readback.status === "PAUSED" ? "remote_paused" : "active_unconfirmed", objects };
    } catch (error) { return completedWrite ? { status: "execution_unknown", objects, error: error instanceof MetaAdsError ? error.code : "meta_execution_unknown" } : this.failure(error, objects); }
  }
  async reconcile(access: MetaAccess, campaign: MetaAdsCampaign, execution: MetaAdsExecution): Promise<ProviderExecutionResult> {
    this.owned(campaign);
    try {
      const session = this.session(access, "fix_ads_not_running"); await session.start(); await this.account(session, access);
      const snapshot = await this.snapshotWith(session, access, campaign);
      if (snapshot.status === "PAUSED") return { status: "remote_paused", objects: execution.objects };
      if (snapshot.status !== "ACTIVE") return { status: execution.status === "publishing" ? "publishing" : "execution_unknown", objects: execution.objects };
      const pending: ProviderExecutionResult = { status: execution.status === "publishing" ? "publishing" : "execution_unknown", objects: execution.objects };
      const expected = refs(campaign).filter(ref => ref.type !== "campaign");
      if (!campaign.remoteAdSetId || !campaign.remoteAdIds.length || snapshot.effectiveStatus !== "ACTIVE" || expected.some(ref => {
        const states = snapshot.objectStates?.filter(state => state.type === ref.type && state.id === ref.id) ?? [];
        return states.length !== 1 || states[0].status !== "ACTIVE" || states[0].effectiveStatus !== "ACTIVE";
      })) return pending;
      const ads = (await this.entities(session, access, "ad", ["id", "status", "effective_status", "impressions"], campaign.remoteAdIds, { date_preset: "today" })).filter(ad => campaign.remoteAdIds.includes(String(ad.id ?? ad.ad_id ?? ad.ad_object_id)));
      if (campaign.remoteAdIds.some(id => { const matches = ads.filter(ad => String(ad.id ?? ad.ad_id ?? ad.ad_object_id) === id); return matches.length !== 1 || matches[0].status !== "ACTIVE" || matches[0].effective_status !== "ACTIVE"; })) return pending;
      return { status: ads.some(ad => ad.effective_status === "ACTIVE" && Number(ad.impressions) > 0) ? "delivered" : "active_unconfirmed", objects: execution.objects };
    } catch { return { status: "execution_unknown", objects: execution.objects, error: "meta_reconciliation_unavailable" }; }
  }
  async metrics(access: MetaAccess, campaign: MetaAdsCampaign, since: string, until: string): Promise<ProviderMetricSnapshot> {
    const session = this.session(access, "assess_and_optimize_performance", true); await session.start(); const account = await this.account(session, access);
    const fields = ["id", "amount_spent", "offsite_conversion_fb_pixel_purchase", "offsite_conversion_fb_pixel_purchase_values", "actions:onsite_conversion.messaging_conversation_started_7d", "impressions", "reach", "link_click", "attribution_setting"];
    const context = await session.call("ads_get_field_context", { field_names: fields });
    const available = fields.filter(name => list(context.fields).some(field => field.name === name && Array.isArray(field.levels) && field.levels.includes('campaign')));
    if (!available.includes('id')) throw new MetaAdsError("meta_metrics_unavailable", 503);
    const rows = await this.entities(session, access, "campaign", available, [id(campaign.remoteCampaignId)], { time_range: JSON.stringify({ since, until }), action_attribution_windows: ["7d_click", "1d_view"] });
    const row = rows.find(r => String(r.id ?? r.campaign_id) === campaign.remoteCampaignId);
    if (!row) throw new MetaAdsError('meta_metrics_unavailable', 503);
    const metadata = await this.entities(session, access, "account", ['id', 'timezone_name'], [id(access.accountId)]);
    const selected = metadata.find(r => String(r.id ?? r.account_id ?? '').replace(/^act_/, '') === access.accountId);
    const currency = String(account.currency);
    const settings=['1d_click','7d_click','28d_click','1d_view_1d_click','1d_view_7d_click','7d_view_7d_click','1d_view_28d_click','7d_view_28d_click','28d_view_28d_click','1d_click_1d_ev','1d_view_1d_click_1d_ev','7d_click_1d_ev','1d_view_7d_click_1d_ev','1d_passback','7d_passback','28d_passback','custom','1d_sequenced','7d_sequenced','28d_sequenced','skan','incrementality','multiple','na'];
    const effectiveAttributionWindow=available.includes('attribution_setting')&&typeof row.attribution_setting==='string'&&settings.includes(row.attribution_setting)?row.attribution_setting:null;
    return { campaignId: campaign.id, currency, since, until, timezone: typeof selected?.timezone_name === 'string' ? selected.timezone_name : 'unknown', attributionWindow: "7d_click+1d_view",requestedAttributionWindow:'7d_click+1d_view',effectiveAttributionWindow,
      spendCents: available.includes('amount_spent') ? metaCurrencyCents(row.amount_spent, currency) : null,
      attributedRevenueCents: available.includes('offsite_conversion_fb_pixel_purchase_values') ? metaCurrencyCents(row.offsite_conversion_fb_pixel_purchase_values, currency) : null,
      attributedPurchases: available.includes('offsite_conversion_fb_pixel_purchase') ? count(row.offsite_conversion_fb_pixel_purchase) : null,
      conversations: available.includes('actions:onsite_conversion.messaging_conversation_started_7d') ? count(row['actions:onsite_conversion.messaging_conversation_started_7d']) : null,
      impressions: available.includes('impressions')?count(row.impressions):null,
      reach: available.includes('reach')?count(row.reach):null,
      linkClicks: available.includes('link_click')?count(row.link_click):null };
  }
  async accountBudgetConstraints(access:MetaAccess){
    const session=this.session(access,'plan_future_campaigns');await session.start();const account=await this.account(session,access),minimum=count(account.min_daily_budget_cents);
    return{accountId:access.accountId!,currency:typeof account.currency==='string'&&/^[A-Z]{3}$/.test(account.currency)?account.currency:null,minimumDailyBudgetCents:minimum!==null&&minimum>0?minimum:null};
  }
  async accountTimezone(access: MetaAccess): Promise<string> {
    const session = this.session(access, 'assess_and_optimize_performance', true); await session.start(); await this.account(session, access);
    const context = await session.call('ads_get_field_context', { field_names: ['id', 'timezone_name'] });
    if (!list(context.fields).some(field => field.name === 'timezone_name' && Array.isArray(field.levels) && field.levels.includes('ad_account'))) throw new MetaAdsError('meta_timezone_unavailable', 409);
    const rows = await this.entities(session, access, 'account', ['id', 'timezone_name'], [id(access.accountId)]);
    const row = rows.find(r => String(r.id ?? r.account_id ?? '').replace(/^act_/, '') === access.accountId);
    if (typeof row?.timezone_name !== 'string' || !row.timezone_name) throw new MetaAdsError('meta_timezone_unavailable', 409);
    return row.timezone_name;
  }
}
