import { Injectable } from "@nestjs/common";
import { CheckoutAbandonmentService } from "../../domain/services/checkout-abandonment.service.js";
import { CheckoutIdentityService } from "../../domain/services/checkout-identity.service.js";
import type {
  AcceptedOffer,
  AuthorizedOffer,
  ChatTurn,
  CheckoutEventName,
  CheckoutSession,
  CompletedOrder,
  CustomerHints,
  DashboardOverview,
  DomainEventEnvelope,
  MerchantRules
} from "@aacp/shared-types";
import type { CheckoutRepository } from "../../domain/ports/checkout-repository.port.js";
import { CheckoutSessionEntity } from "../../domain/entities/checkout-session.entity.js";

const DEFAULT_RULES: MerchantRules = {
  maxDiscountPercent: 10,
  minimumMarginPercent: 38,
  allowFreeShipping: true,
  allowShippingDiscount: true,
  allowBonusItem: false,
  allowStackDiscountAndFreeShipping: false,
  freeShippingMinCartValue: 250,
  maxShippingSubsidy: 45,
  maxPartialShippingDiscount: 20,
  offerExpirationMinutes: 15,
  blockedRegions: [],
  brandVoice: "consultative",
  couponBoxEnabled: true
};

@Injectable()
export class InMemoryCheckoutRepository implements CheckoutRepository {
  private sessions = new Map<string, CheckoutSession>();
  private rules = new Map<string, MerchantRules>();
  private identityIndex = new Map<string, string>();
  private offers = new Map<string, AuthorizedOffer>();
  private acceptedOffers = new Map<string, AcceptedOffer>();
  private completedOrders = new Map<string, CompletedOrder>();
  private outbox: DomainEventEnvelope[] = [];
  private events: Array<{ merchantId: string; sessionId: string; event: CheckoutEventName; at: string }> = [];

  async transaction<T>(work: (repository: CheckoutRepository) => Promise<T>): Promise<T> {
    return work(this);
  }

  getRules(merchantId: string): MerchantRules {
    if (!this.rules.has(merchantId)) this.rules.set(merchantId, { ...DEFAULT_RULES });
    return this.rules.get(merchantId)!;
  }

  setRules(merchantId: string, rules: Partial<MerchantRules>): MerchantRules {
    const next = { ...this.getRules(merchantId), ...rules };
    this.rules.set(merchantId, next);
    return next;
  }

  resolveGlobalUserId(merchantId: string, customer?: CustomerHints): string {
    const identityKey = CheckoutIdentityService.identityKey(merchantId, customer);
    if (!identityKey) return `usr_${crypto.randomUUID()}`;
    const existing = this.identityIndex.get(identityKey);
    if (existing) return existing;
    const created = `usr_${crypto.randomUUID()}`;
    this.identityIndex.set(identityKey, created);
    return created;
  }

  saveSession(session: CheckoutSession): CheckoutSession {
    this.sessions.set(this.key(session.merchantId, session.sessionId), session);
    return session;
  }

  getSession(merchantId: string, sessionId: string): CheckoutSession | undefined {
    return this.sessions.get(this.key(merchantId, sessionId));
  }

  recordEvent(merchantId: string, sessionId: string, event: CheckoutEventName): void {
    this.events.push({ merchantId, sessionId, event, at: new Date().toISOString() });
    const session = this.getSession(merchantId, sessionId);
    if (!session) return;
    const score = CheckoutAbandonmentService.applyEvent(session.abandonmentScore, event);
    this.saveSession({
      ...session,
      abandonmentScore: score.nextScore,
      triggerAgent: score.triggerAgent,
      updatedAt: new Date().toISOString()
    });
  }

  appendChatTurn(merchantId: string, sessionId: string, turn: ChatTurn): CheckoutSession {
    const existing = this.getSession(merchantId, sessionId);
    if (!existing) throw new Error("checkout_session_not_found");
    const next = CheckoutSessionEntity.rehydrate(existing).appendTurn(turn).snapshot();
    this.saveSession(next);
    return next;
  }

  saveOffer(offer: AuthorizedOffer): AuthorizedOffer {
    this.offers.set(offer.id, offer);
    return offer;
  }

  getOffer(merchantId: string, offerId: string): AuthorizedOffer | undefined {
    const offer = this.offers.get(offerId);
    return offer?.merchantId === merchantId ? offer : undefined;
  }

  saveAcceptedOffer(acceptedOffer: AcceptedOffer): AcceptedOffer {
    this.acceptedOffers.set(
      this.offerKey(acceptedOffer.merchantId, acceptedOffer.sessionId, acceptedOffer.offerId),
      acceptedOffer
    );
    return acceptedOffer;
  }

  getAcceptedOffer(merchantId: string, sessionId: string, offerId: string): AcceptedOffer | undefined {
    return this.acceptedOffers.get(this.offerKey(merchantId, sessionId, offerId));
  }

  saveCompletedOrder(order: CompletedOrder): { order: CompletedOrder; idempotent: boolean } {
    const key = this.orderKey(order.merchantId, order.sessionId, order.externalOrderId);
    const existing = this.completedOrders.get(key);
    if (existing) return { order: existing, idempotent: true };
    this.completedOrders.set(key, order);
    return { order, idempotent: false };
  }

  getCompletedOrder(merchantId: string, sessionId: string, externalOrderId: string): CompletedOrder | undefined {
    return this.completedOrders.get(this.orderKey(merchantId, sessionId, externalOrderId));
  }

  appendOutbox(event: DomainEventEnvelope): DomainEventEnvelope {
    this.outbox.push(event);
    return event;
  }

  listOutbox(merchantId: string): DomainEventEnvelope[] {
    return this.outbox.filter((event) => event.merchant_id === merchantId);
  }

  overview(merchantId: string): DashboardOverview {
    const sessions = [...this.sessions.values()].filter((session) => session.merchantId === merchantId);
    const offers = [...this.offers.values()].filter((offer) => offer.merchantId === merchantId);
    const events = this.events.filter((event) => event.merchantId === merchantId);
    const orders = events.filter((event) => event.event === "order_completed").length;
    const accepted = events.filter((event) => event.event === "offer_accepted").length;

    return {
      merchant_id: merchantId,
      conversations_started: sessions.length,
      offers_viewed: offers.length,
      offers_accepted: accepted,
      orders_completed: orders,
      conversion_rate_with_agent: sessions.length ? orders / sessions.length : 0,
      average_discount: average(offers.filter((offer) => offer.type === "discount_percent").map((offer) => offer.value)),
      average_shipping_subsidy: average(offers.filter((offer) => offer.type.startsWith("shipping")).map((offer) => offer.value)),
      incremental_revenue: orders * average(sessions.map((session) => session.cart.total)),
      recent_sessions: sessions.slice(-10).reverse(),
      recent_offers: offers.slice(-10).reverse()
    };
  }

  private key(merchantId: string, sessionId: string): string {
    return `${merchantId}:${sessionId}`;
  }

  private offerKey(merchantId: string, sessionId: string, offerId: string): string {
    return `${merchantId}:${sessionId}:${offerId}`;
  }

  private orderKey(merchantId: string, sessionId: string, externalOrderId: string): string {
    return `${merchantId}:${sessionId}:${externalOrderId}`;
  }
}

function average(values: number[]): number {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}
