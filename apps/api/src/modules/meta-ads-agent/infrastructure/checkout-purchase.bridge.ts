import type { DomainEvent, DomainEventBus } from "../../../shared/events/domain-event-bus.port.js";
import type { MetaAdsRepository, CommerceContextPort, Clock, AttributionSessionBindingPort } from "../domain/types.js";
import type { AttributionService } from "../application/attribution.service.js";
import {stableDigest} from '../domain/offer.js';

export class CheckoutPurchaseBridge {
  private timer: ReturnType<typeof setInterval> | undefined;
  private active: Promise<void> | undefined;
  private stopping = false;
  constructor(private readonly repo: MetaAdsRepository, private readonly commerce: Pick<CommerceContextPort, "paidOrder" | "paidOrders">,
    private readonly attribution: Pick<AttributionService, "reconcilePurchase" | "captureWhatsapp" | "bindSession">, private readonly events: DomainEventBus | undefined,
    private readonly enabled: boolean, private readonly clock: Clock = () => new Date(), private readonly binding?: AttributionSessionBindingPort) {}
  onModuleInit(): void {
    if (!this.enabled) return;
    if (!this.events) throw new Error("meta_ads_event_bus_missing");
    this.events.subscribe("order.completed", event => this.completed(event), "meta-ads-agent.purchase.v1");
    this.events.subscribe("whatsapp.ad_referral", event => this.referral(event), "meta-ads-agent.whatsapp-origin.v1");
    this.timer = setInterval(() => { void this.drain(); }, 60000); this.timer.unref(); void this.drain();
  }
  async onModuleDestroy(): Promise<void> { this.stopping = true; clearInterval(this.timer); await this.active; }
  async completed(event: DomainEvent): Promise<void> {
    const payload = event.payload as { external_order_id?: unknown } | null;
    if (event.eventType !== "order.completed" || !payload || typeof payload.external_order_id !== "string") return;
    const state = await this.repo.read(event.merchantId); if (!Object.keys(state.campaigns).length) return;
    const fact = await this.commerce.paidOrder(event.merchantId, payload.external_order_id);
    if (fact?.paid && fact.merchantId === event.merchantId) { await this.bind(event.merchantId, fact.sessionId); await this.attribution.reconcilePurchase(event.merchantId, fact.orderId); }
  }
  async referral(event: DomainEvent): Promise<void> {
    const payload = event.payload as { adId?: unknown; sessionId?: unknown } | null;
    if (event.eventType !== "whatsapp.ad_referral" || !payload || typeof payload.adId !== "string" || typeof payload.sessionId !== "string") return;
    const state = await this.repo.read(event.merchantId);
    if (!Object.values(state.campaigns).some(campaign => campaign.createdByAgent && campaign.remoteAdIds.includes(payload.adId as string))) return;
    const idempotencyKey=stableDigest({merchantId:event.merchantId,eventId:event.eventId??null,...(!event.eventId?{sessionId:payload.sessionId,adId:payload.adId}:{})});
    await this.attribution.captureWhatsapp(event.merchantId, { adId: payload.adId, sessionId: payload.sessionId, consent: false, consentVersion: "whatsapp-no-ad-consent-v1",idempotencyKey });
  }
  drain(): Promise<void> { if (this.stopping) return Promise.resolve(); return this.active ??= this.scan().catch(() => undefined).finally(() => { this.active = undefined; }); }
  private async bind(merchantId: string, sessionId: string) { const origin = await this.binding?.parent(merchantId, sessionId); if (origin) await this.attribution.bindSession(merchantId, origin, sessionId); }
  private async scan(): Promise<void> {
    let after: string | undefined;
    while (!this.stopping) {
      const stores = await this.repo.listStoreIds(100, after); if (!stores.length) return;
      for (const merchantId of stores) { try { await this.scanStore(merchantId); } catch { /* Isolate tenant failures; checkpoints only advance on success. */ } }
      if (stores.length < 100) return; after = stores.at(-1);
    }
  }
  private async scanStore(merchantId: string): Promise<void> {
    const state = await this.repo.read(merchantId); const dates = Object.values(state.campaigns).map(campaign => Date.parse(campaign.createdAt)).filter(Number.isFinite);
    if (!dates.length) return;
    const now = this.clock().getTime(); const since = state.purchaseScan?.since ?? new Date(Math.min(...dates)).toISOString();
    const until = new Date(Math.min(now + 1, Date.parse(since) + 30 * 86400000)).toISOString();
    if (Date.parse(until) > Date.parse(since)) for (const fact of await this.commerce.paidOrders(merchantId, since, until)) if (fact.paid && fact.merchantId === merchantId) { await this.bind(merchantId, fact.sessionId); await this.attribution.reconcilePurchase(merchantId, fact.orderId); }
    const existing = Object.keys(state.purchases ?? {}).sort().filter(id => !state.purchaseScan?.refreshAfter || id > state.purchaseScan.refreshAfter).slice(0, 100);
    for (const orderId of existing) await this.attribution.reconcilePurchase(merchantId, orderId);
    await this.repo.mutate(merchantId, [], current => {
      const next = Date.parse(until) >= now ? new Date(Math.max(Math.min(...dates), now - 2 * 86400000)).toISOString() : until;
      current.purchaseScan = { since: next, refreshAfter: existing.length === 100 ? existing.at(-1)! : null }; return { result: null };
    });
  }
}
