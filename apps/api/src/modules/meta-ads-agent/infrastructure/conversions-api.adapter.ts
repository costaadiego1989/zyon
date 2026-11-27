import { isIP } from "node:net";
import type { MetaAdsEnvironment } from "../domain/offer.js";
import type { ConversionsPort, MetaAccess, PurchaseSignal, WhatsappConversionsContextPort, Clock } from "../domain/types.js";

type Result = Awaited<ReturnType<ConversionsPort["send"]>>;
const failed = (error = "meta_conversion_context_invalid"): Result => ({ status: "failed", error });
const unknown = (): Result => ({ status: "unknown", error: "meta_conversion_outcome_unknown" });
const numericId = (value: unknown): value is string => typeof value === "string" && /^\d{1,40}$/.test(value);
const phone = (value: string) => value.replace(/\D/g, "");
const cookie = (value: unknown): value is string => typeof value === "string" && /^fb\.\d\.\d{10,16}\.[A-Za-z0-9._-]{1,500}$/.test(value);

export class ConversionsApiAdapter implements ConversionsPort {
  constructor(private readonly env: MetaAdsEnvironment, private readonly request: typeof fetch = fetch,
    private readonly whatsapp?: WhatsappConversionsContextPort, private readonly clock: Clock = () => new Date()) {}
  private base(): string | null { return this.env.META_ADS_AGENT_CONVERSIONS_ENABLED === "true" && /^v\d+\.0$/.test(this.env.META_ADS_GRAPH_API_VERSION ?? "") ? `https://graph.facebook.com/${this.env.META_ADS_GRAPH_API_VERSION}` : null; }
  private async get(url: string, token: string): Promise<Record<string, unknown>> {
    const response = await this.request(url, { method: "GET", headers: { Authorization: `Bearer ${token}` }, redirect: "error", signal: AbortSignal.timeout(15000) });
    const result = await response.json() as Record<string, unknown>;
    if (!response.ok || result.error) throw new Error("conversion_binding_unavailable");
    return result;
  }
  async send(access: MetaAccess, signal: PurchaseSignal): Promise<Result> {
    const base = this.base(); if (!base) return failed("meta_conversions_not_configured");
    const at = Date.parse(signal.eventTime); const now = this.clock().getTime();
    if (!Number.isFinite(at) || at < now - 7 * 86400000 || at > now + 300000 || !Number.isSafeInteger(signal.valueCents) || signal.valueCents <= 0 || !/^[A-Z]{3}$/.test(signal.currency) || !/^[A-Za-z0-9_-]{1,160}$/.test(signal.eventId)) return failed();
    let datasetId = access.datasetId; let token = access.accessToken; let event: Record<string, unknown>;
    const common = { event_name: "Purchase", event_time: Math.floor(at / 1000), event_id: signal.eventId, custom_data: { currency: signal.currency, value: signal.valueCents / 100 } };
    if (signal.source === "store") {
      let source: URL; try { source = new URL(signal.eventSourceUrl ?? ""); } catch { return failed(); }
      if (source.protocol !== "https:" || source.username || source.password || isIP(source.hostname) || source.hostname === "localhost" || source.hostname.endsWith(".localhost") || !signal.clientUserAgent || signal.clientUserAgent.length > 1024 || /[\r\n\x00]/.test(signal.clientUserAgent) || (!cookie(signal.fbc) && !cookie(signal.fbp)) || !numericId(datasetId) || !token) return failed();
      event = { ...common, action_source: "website", event_source_url: source.toString(), user_data: { ...(cookie(signal.fbc) ? { fbc: signal.fbc } : {}), ...(cookie(signal.fbp) ? { fbp: signal.fbp } : {}), client_user_agent: signal.clientUserAgent } };
    } else if (signal.source === "whatsapp") {
      if (!signal.ctwaClid || !/^[A-Za-z0-9_-]{1,512}$/.test(signal.ctwaClid) || !access.whatsappId) return failed();
      try {
        const context = await this.whatsapp?.get(access.merchantId);
        if (!context || context.merchantId !== access.merchantId || !numericId(context.wabaId) || !numericId(context.phoneNumberId) || !context.accessToken || phone(context.phoneNumber) !== access.whatsappId) return failed();
        token = context.accessToken;
        const numbers = await this.get(`${base}/${context.wabaId}/phone_numbers?fields=id,display_phone_number&limit=100`, token);
        if (!Array.isArray(numbers.data) || !numbers.data.some((row: { id?: string; display_phone_number?: string }) => row.id === context.phoneNumberId && typeof row.display_phone_number === "string" && phone(row.display_phone_number) === access.whatsappId)) return failed("meta_conversion_phone_not_linked");
        const dataset = await this.get(`${base}/${context.wabaId}/dataset?fields=id`, token);
        const ids = Array.isArray(dataset.data) ? dataset.data.map((row: { id?: unknown }) => row.id) : [dataset.id];
        if (ids.length !== 1 || !numericId(ids[0])) return failed("meta_conversion_dataset_not_linked");
        datasetId = ids[0]; event = { ...common, action_source: "business_messaging", messaging_channel: "whatsapp", user_data: { whatsapp_business_account_id: context.wabaId, ctwa_clid: signal.ctwaClid } };
      } catch { return failed("meta_conversion_binding_unavailable"); }
    } else return failed();
    try { await access.assertWriteAuthorized?.(); } catch { return failed("meta_conversion_authorization_changed"); }
    try {
      const response = await this.request(`${base}/${datasetId}/events`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ data: [event] }), redirect: "error", signal: AbortSignal.timeout(15000) });
      if ([400, 401, 403, 404].includes(response.status)) return failed("meta_conversion_rejected");
      if (!response.ok) return unknown();
      const body = await response.json() as { events_received?: unknown; error?: unknown };
      return body.events_received === 1 && !body.error ? { status: "sent", error: null } : body.error ? failed("meta_conversion_rejected") : unknown();
    } catch { return unknown(); }
  }
}
