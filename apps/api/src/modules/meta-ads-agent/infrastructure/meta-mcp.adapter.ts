import type { MetaAdsCampaign, MetaAdsMedia, MetaAdsProposal, MetaAdsExecution, MetaAdsBudget } from "@zyon/shared-types";
import { MetaAdsError, type MetaAdsProviderPort, type MetaAccess, type MetaDiscovery, type RemoteSnapshot, type ProviderExecutionResult, type ProviderMetricSnapshot } from "../domain/types.js";
import type { MetaAdsEnvironment } from "../domain/offer.js";
import { stableDigest } from "../domain/offer.js";
import { McpFailure, MetaMcpSession, decoded, entityRows } from "./meta-mcp.transport.js";

type Json = Record<string, unknown>;
type Objects = MetaAdsExecution["objects"];
const createTools = ["ads_create_campaign", "ads_create_ad_set", "ads_create_creative", "ads_create_ad"];
function id(value: unknown): string {
  if (typeof value !== "string" || !/^\d+$/.test(value)) throw new MetaAdsError("meta_asset_invalid");
  return value;
}
function list(value: unknown): Json[] { if (!Array.isArray(value)) throw new McpFailure("meta_response_invalid", false); return value as Json[]; }
function money(value: unknown): number | null {
  if (value === undefined || value === null || value === "") return null;
  const number = Number(value); return Number.isFinite(number) && number >= 0 ? Math.round(number * 100) : null;
}
function count(value: unknown): number | null { const amount = money(value); return amount === null ? null : amount / 100; }
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
    const response = await this.request(`https://graph.facebook.com/${this.env.META_ADS_GRAPH_API_VERSION}/${id(pageId)}?fields=id,whatsapp_number,has_whatsapp_number`, { headers: { Authorization: `Bearer ${access.accessToken}` }, redirect: "error", signal: AbortSignal.timeout(15000) });
    const body = await response.json() as Json;
    if (!response.ok || body.error || String(body.id) !== pageId) throw new MetaAdsError("meta_whatsapp_access_denied", 403);
    const phone = typeof body.whatsapp_number === "string" ? body.whatsapp_number.replace(/\D/g, "") : "";
    return body.has_whatsapp_number === true && /^\d{10,15}$/.test(phone) ? phone : null;
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
    const sets = campaign.remoteAdSetId ? (await this.entities(session, access, "adset", ["id", "status", "effective_status", "targeting"], [campaign.remoteAdSetId])).filter(set => String(set.id ?? set.ad_set_id ?? set.ad_object_id) === campaign.remoteAdSetId) : [];
    const ads = campaign.remoteAdIds.length ? (await this.entities(session, access, "ad", ["id", "status", "effective_status", "creative_id"], campaign.remoteAdIds)).filter(ad => campaign.remoteAdIds.includes(String(ad.id ?? ad.ad_id ?? ad.ad_object_id))) : [];
    return { campaignId: campaign.remoteCampaignId, status: String(row.status ?? "UNKNOWN"), effectiveStatus: String(row.effective_status ?? "UNKNOWN"),
      budget: { daily_budget: row.daily_budget ?? null, lifetime_budget: row.lifetime_budget ?? null, spend_cap: row.spend_cap ?? null }, targeting: (sets[0]?.targeting ?? {}) as Json,
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
  async execute(access: MetaAccess, campaign: MetaAdsCampaign, proposal: MetaAdsProposal, onProgress: (objects: Objects) => Promise<void>): Promise<ProviderExecutionResult> {
    this.owned(campaign);
    if (proposal.status !== "approved" || proposal.campaignId !== campaign.id || proposal.connectionEpoch !== access.connectionEpoch) throw new MetaAdsError("proposal_not_approved", 403);
    const objects = refs(campaign);
    let completedWrite = false;
    try {
      const session = this.session(access, "update_existing_campaigns"); await session.start(); const account = await this.account(session, access);
      if (!campaign.remoteCampaignId) throw new MetaAdsError("meta_campaign_missing", 409);
      if (proposal.kind === "publish") {
        if (account.has_payment_method !== true) throw new MetaAdsError("meta_funding_required", 409);
        for (const ref of objects) {
          const result = await session.call("ads_activate_entity", { ad_account_id: access.accountId, entity_id: ref.id, entity_type: ref.type, object_ids: objects.map(o => o.id), publish_as_active: true, allow_partial_publish: false }, true);
          completedWrite = true;
          await onProgress([...objects]);
          const status = String((decoded(result.result ?? result) as Json).status);
          if (status === "PUBLISHING") return { status: "publishing", objects };
          if (status !== "ACTIVE") throw new McpFailure("meta_publication_unconfirmed", true);
        }
        return { status: "active_unconfirmed", objects };
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
    const fields = ["id", "spend", "offsite_conversion_fb_pixel_purchase", "offsite_conversion_fb_pixel_purchase_values", "onsite_conversion_messaging_conversation_started_7d"];
    const context = await session.call("ads_get_field_context", { field_names: fields });
    const available = fields.filter(name => list(context.fields).some(field => field.name === name));
    if (!available.includes("spend")) throw new MetaAdsError("meta_metrics_unavailable", 503);
    const rows = await this.entities(session, access, "campaign", available, [id(campaign.remoteCampaignId)], { time_range: JSON.stringify({ since, until }), action_attribution_windows: ["7d_click", "1d_view"] });
    const row = rows.find(r => String(r.id ?? r.campaign_id) === campaign.remoteCampaignId) ?? {};
    const metadata = await this.entities(session, access, "account", ["timezone_name"]);
    return { campaignId: campaign.id, currency: String(account.currency), since, until, timezone: String(metadata[0]?.timezone_name ?? "unknown"), attributionWindow: "7d_click+1d_view",
      spendCents: money(row.spend), attributedRevenueCents: money(row.offsite_conversion_fb_pixel_purchase_values), attributedPurchases: count(row.offsite_conversion_fb_pixel_purchase), conversations: count(row.onsite_conversion_messaging_conversation_started_7d) ?? 0 };
  }
}
