import { createHash, createHmac, timingSafeEqual, randomUUID } from "node:crypto";
import { MetaAdsError, type MetaAdsRepository, type CommerceContextPort, type AttributionReceipt, type AttributedPurchase, type PurchaseSignal, type ConversionsPort, type MetaAccess, type Clock, type IdFactory } from "../domain/types.js";
import { requireIdentifier } from "../domain/offer.js";
import type { ConnectionService } from "./connection.service.js";

interface ConsentInput { sessionId: string; consent: boolean; consentVersion: string; }
interface StoreOrigin extends ConsentInput { token: string; fbc?: string | null; fbp?: string | null; clientUserAgent?: string | null; }
interface WhatsappOrigin extends ConsentInput { adId: string; ctwaClid?: string; }
const eventId = (merchantId: string, orderId: string) => `zyon_purchase_${createHash("sha256").update(JSON.stringify([merchantId, orderId])).digest("hex")}`;
const cookie = (value: unknown) => typeof value === "string" && /^fb\.\d\.\d{10,16}\.[A-Za-z0-9._-]{1,500}$/.test(value) ? value : null;

export class AttributionService {
  constructor(private readonly repo: MetaAdsRepository, private readonly commerce: Pick<CommerceContextPort, "paidOrder" | "getProfile">,
    private readonly connection: Pick<ConnectionService, "access">, private readonly conversions: ConversionsPort, private readonly signingKey: string | undefined,
    private readonly clock: Clock = () => new Date(), private readonly id: IdFactory = randomUUID) {}
  private signature(merchantId: string, campaignId: string): string {
    const key = Buffer.from(this.signingKey ?? "", "base64");
    if (key.length !== 32 || key.toString("base64") !== this.signingKey) throw new MetaAdsError("attribution_not_configured", 503);
    return createHmac("sha256", key).update(JSON.stringify(["zyon-meta-ad-v1", merchantId, campaignId])).digest("base64url");
  }
  trackingToken(merchantId: string, campaignId: string): string { requireIdentifier(merchantId); requireIdentifier(campaignId); return `${campaignId}.${this.signature(merchantId, campaignId)}`; }
  trackedUrl(merchantId: string, campaignId: string, original: string): string {
    const url = new URL(original); if (url.protocol !== "https:") throw new MetaAdsError("attribution_url_invalid");
    url.searchParams.set("zyon_ad", this.trackingToken(merchantId, campaignId)); return url.toString();
  }
  private async campaign(merchantId: string, campaignId: string) {
    const state = await this.repo.read(merchantId); const campaign = Object.hasOwn(state.campaigns, campaignId) ? state.campaigns[campaignId] : null;
    const origin = (await this.repo.getRecord<{ source: string; campaignId: string }>(merchantId, `campaign-origin:${campaignId}`))?.payload;
    if (!campaign?.createdByAgent || !campaign.remoteCampaignId || origin?.source !== "agent" || origin.campaignId !== campaignId) throw new MetaAdsError("attribution_origin_invalid", 403);
    return campaign;
  }
  async captureStore(merchantId: string, input: StoreOrigin): Promise<AttributionReceipt> {
    if (typeof input.token !== "string" || input.token.length > 300) throw new MetaAdsError("attribution_origin_invalid", 403);
    const [campaignId, signature, extra] = input.token.split(".");
    requireIdentifier(campaignId); const expected = this.signature(merchantId, campaignId);
    if (extra || !signature || signature.length !== expected.length || !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) throw new MetaAdsError("attribution_origin_invalid", 403);
    await this.campaign(merchantId, campaignId);
    const clientUserAgent = typeof input.clientUserAgent === "string" && input.clientUserAgent.length <= 1024 && !/[\r\n\x00]/.test(input.clientUserAgent) ? input.clientUserAgent : null;
    return this.capture(merchantId, campaignId, "store", input, { fbc: cookie(input.fbc), fbp: cookie(input.fbp), ctwaClid: null, clientUserAgent });
  }
  /** Called only by the authenticated provider ingress bridge, never by a public request body. */
  async captureWhatsapp(merchantId: string, input: WhatsappOrigin): Promise<AttributionReceipt> {
    if (typeof input.adId !== "string" || !/^\d+$/.test(input.adId) || (input.ctwaClid !== undefined && (typeof input.ctwaClid !== "string" || !/^[A-Za-z0-9_-]{1,512}$/.test(input.ctwaClid))) || (input.consent && !input.ctwaClid)) throw new MetaAdsError("attribution_origin_invalid", 403);
    const state = await this.repo.read(merchantId); const campaign = Object.values(state.campaigns).find(value => value.remoteAdIds.includes(input.adId) && value.createdByAgent);
    if (!campaign) throw new MetaAdsError("attribution_origin_invalid", 403);
    await this.campaign(merchantId, campaign.id);
    return this.capture(merchantId, campaign.id, "whatsapp", input, { fbc: null, fbp: null, ctwaClid: input.ctwaClid ?? null });
  }
  private async capture(merchantId: string, campaignId: string, source: AttributionReceipt["source"], input: ConsentInput, identifiers: Pick<AttributionReceipt, "fbc" | "fbp" | "ctwaClid" | "clientUserAgent">): Promise<AttributionReceipt> {
    requireIdentifier(input.sessionId);
    if (typeof input.consent !== "boolean" || typeof input.consentVersion !== "string" || !/^[A-Za-z0-9._-]{1,80}$/.test(input.consentVersion)) throw new MetaAdsError("attribution_consent_invalid");
    const now = this.clock().toISOString(); const receipt: AttributionReceipt = { id: requireIdentifier(this.id()), campaignId, sessionId: input.sessionId, consent: input.consent, consentVersion: input.consentVersion, grantedAt: now, revokedAt: null, source,
      fbc: input.consent ? identifiers.fbc : null, fbp: input.consent ? identifiers.fbp : null, ctwaClid: input.consent ? identifiers.ctwaClid : null, clientUserAgent: input.consent ? identifiers.clientUserAgent ?? null : null };
    const key = `attribution-session:${input.sessionId}`;
    return this.repo.mutate(merchantId, [key], (_state, records) => {
      const existing = records.get(key)?.payload as AttributionReceipt | undefined;
      return existing ? { result: existing } : { result: receipt, records: [{ key, kind: "attribution", payload: receipt, createdAt: now }] };
    });
  }
  async revoke(merchantId: string, sessionId: string): Promise<void> {
    requireIdentifier(sessionId); const key = `attribution-revoked:${sessionId}`;
    await this.repo.mutate(merchantId, [key], (_state, records) => ({ result: undefined, records: records.has(key) ? [] : [{ key, kind: "attribution", payload: { sessionId, revokedAt: this.clock().toISOString() }, createdAt: this.clock().toISOString() }] }));
  }
  /** Caller supplies the binding only after reading the canonical checkout session on the server. */
  async bindSession(merchantId: string, originSessionId: string, checkoutSessionId: string): Promise<AttributionReceipt | null> {
    requireIdentifier(originSessionId); requireIdentifier(checkoutSessionId);
    const sourceKey = `attribution-session:${originSessionId}`; const targetKey = `attribution-session:${checkoutSessionId}`;
    return this.repo.mutate<AttributionReceipt | null>(merchantId, [sourceKey, targetKey], (_state, records) => {
      const source = records.get(sourceKey)?.payload as AttributionReceipt | undefined;
      if (!source) return { result: null };
      const existing = records.get(targetKey)?.payload as AttributionReceipt | undefined;
      if (existing) {
        if (existing.campaignId !== source.campaignId || (existing.originSessionId ?? existing.sessionId) !== (source.originSessionId ?? source.sessionId)) throw new MetaAdsError("attribution_binding_conflict", 409);
        return { result: existing };
      }
      const bound: AttributionReceipt = { ...source, id: requireIdentifier(this.id()), sessionId: checkoutSessionId, originSessionId: source.originSessionId ?? originSessionId };
      return { result: bound, records: [{ key: targetKey, kind: "attribution", payload: bound, createdAt: this.clock().toISOString() }] };
    });
  }
  private async consent(merchantId: string, sessionId: string): Promise<AttributionReceipt | null> {
    const receipt = (await this.repo.getRecord<AttributionReceipt>(merchantId, `attribution-session:${sessionId}`))?.payload;
    return receipt?.consent && !receipt.revokedAt && !await this.repo.getRecord(merchantId, `attribution-revoked:${sessionId}`) && (!receipt.originSessionId || !await this.repo.getRecord(merchantId, `attribution-revoked:${receipt.originSessionId}`)) ? receipt : null;
  }
  async reconcilePurchase(merchantId: string, orderId: string): Promise<AttributedPurchase | null> {
    requireIdentifier(orderId); const fact = await this.commerce.paidOrder(merchantId, orderId);
    if (!fact?.paid || fact.merchantId !== merchantId || fact.orderId !== orderId || !Number.isSafeInteger(fact.paidCents) || fact.paidCents <= 0 || !Number.isSafeInteger(fact.refundedCents) || fact.refundedCents < 0 || fact.refundedCents > fact.paidCents || !/^[A-Z]{3}$/.test(fact.currency) || !Number.isFinite(new Date(fact.paidAt).getTime())) return null;
    const origin = (await this.repo.getRecord<AttributionReceipt>(merchantId, `attribution-session:${fact.sessionId}`))?.payload;
    const verified = origin && new Date(origin.grantedAt) <= new Date(fact.paidAt) ? origin : null;
    const identity = eventId(merchantId, orderId); const now = this.clock().toISOString();
    await this.repo.mutate(merchantId, [], state => {
      state.purchases ??= {}; const previous = state.purchases[orderId];
      const purchase: AttributedPurchase = { orderId, eventId: identity, campaignId: previous?.campaignId ?? verified?.campaignId ?? null, source: previous?.source ?? verified?.source ?? null, fact, netRevenueCents: fact.paidCents - fact.refundedCents, signalStatus: previous?.signalStatus ?? "not_authorized", reconciledAt: now };
      state.purchases[orderId] = purchase; return { result: null };
    });
    const consent = verified && await this.consent(merchantId, fact.sessionId);
    if (consent && fact.refundedCents === 0) {
      let access: MetaAccess | null = null;
      try { access = await this.connection.access(merchantId, { destination: consent.source }); } catch { /* Purchase remains valid without advertising access. */ }
      const state = await this.repo.read(merchantId); const campaign = state.campaigns[consent.campaignId];
      if (access && campaign?.remoteAccountId === access.accountId) {
        const key = `purchase-signal:${identity}`;
        const claimed = await this.repo.mutate(merchantId, [key, `attribution-revoked:${fact.sessionId}`], (current, records) => {
          if (records.has(key) || records.has(`attribution-revoked:${fact.sessionId}`)) return { result: false };
          current.purchases![orderId].signalStatus = "sending";
          return { result: true, records: [{ key, kind: "purchase", payload: { eventId: identity, status: "sending", campaignId: consent.campaignId }, createdAt: now }] };
        });
        if (claimed) {
          let status: "sent" | "failed" | "unknown";
          try {
            const epoch = access.connectionEpoch;
            access.assertWriteAuthorized = async () => {
              const currentAccess = await this.connection.access(merchantId, { destination: consent.source });
              if (currentAccess.connectionEpoch !== epoch || !await this.consent(merchantId, fact.sessionId)) throw new MetaAdsError("meta_conversion_authorization_changed", 409);
            };
            const profile = consent.source === "store" ? await this.commerce.getProfile(merchantId) : null;
            const response = await this.conversions.send(access, { eventId: identity, eventTime: fact.paidAt, orderId, currency: fact.currency, valueCents: fact.paidCents, source: consent.source, fbc: consent.fbc, fbp: consent.fbp, ctwaClid: consent.ctwaClid ?? null, clientUserAgent: consent.clientUserAgent ?? null, eventSourceUrl: profile?.storefrontUrl ?? null }); status = response.status;
          }
          catch { status = "unknown"; }
          await this.repo.mutate(merchantId, [], current => { current.purchases![orderId].signalStatus = status; return { result: null, records: [{ key: `purchase-signal-result:${identity}`, kind: "purchase", payload: { eventId: identity, status }, createdAt: this.clock().toISOString() }] }; });
        }
      }
    }
    return (await this.repo.read(merchantId)).purchases![orderId];
  }
  async browserPurchase(merchantId: string, sessionId: string, orderId: string): Promise<PurchaseSignal | null> {
    const fact = await this.commerce.paidOrder(merchantId, orderId);
    if (!fact?.paid || fact.merchantId !== merchantId) return null;
    if (fact.sessionId !== sessionId) throw new MetaAdsError("attribution_session_forbidden", 403);
    if (this.clock().getTime() - Date.parse(fact.paidAt) > 48 * 3600000) return null;
    const consent = await this.consent(merchantId, sessionId);
    if (!consent || fact.refundedCents !== 0 || new Date(consent.grantedAt) > new Date(fact.paidAt)) return null;
    return { eventId: eventId(merchantId, fact.orderId), eventTime: fact.paidAt, orderId: fact.orderId, valueCents: fact.paidCents, currency: fact.currency, source: consent.source, fbc: consent.fbc, fbp: consent.fbp, ctwaClid: consent.ctwaClid ?? null };
  }
  async report(merchantId: string, since: string, until: string, timezone = "UTC"): Promise<AttributedPurchase[]> {
    const start = Date.parse(since); const end = Date.parse(until) + (/^\d{4}-\d{2}-\d{2}$/.test(until) ? 86400000 : 0);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || end - start > 367 * 86400000) throw new MetaAdsError("attribution_period_invalid");
    const rows = Object.values((await this.repo.read(merchantId)).purchases ?? {});
    if (/^\d{4}-\d{2}-\d{2}$/.test(since) && /^\d{4}-\d{2}-\d{2}$/.test(until)) {
      let formatter: Intl.DateTimeFormat; try { formatter = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }); } catch { throw new MetaAdsError("attribution_timezone_unavailable", 409); }
      return rows.filter(value => {
        const parts = Object.fromEntries(formatter.formatToParts(new Date(value.fact.paidAt)).map(part => [part.type, part.value])); const day = `${parts.year}-${parts.month}-${parts.day}`;
        return day >= since && day <= until;
      });
    }
    return rows.filter(value => Date.parse(value.fact.paidAt) >= start && Date.parse(value.fact.paidAt) < end);
  }
}
