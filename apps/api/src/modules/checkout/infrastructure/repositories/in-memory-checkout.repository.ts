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
import type { CheckoutSessionRepository } from "../../domain/ports/checkout-session.repository.port.js";
import type { OfferRepository } from "../../domain/ports/offer.repository.port.js";
import type { OrderRepository } from "../../domain/ports/order.repository.port.js";
import type { DashboardReadModel } from "../../domain/ports/dashboard-read-model.port.js";
import type { BuyerIdentityRepository } from "../../../buyer-purchase-history/domain/ports/buyer-identity.repository.port.js";
import type { OutboxRepository } from "../../../../shared/messaging/ports/outbox.repository.port.js";
import type { MerchantRulesRepository } from "../../../merchant/domain/ports/merchant-rules.repository.port.js";
import type { MerchantRepository } from "../../../merchant/domain/ports/merchant-repository.port.js";
import type { MerchantTheme } from "../../../merchant/domain/merchant.types.js";
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
export class InMemoryCheckoutRepository
  implements CheckoutRepository, CheckoutSessionRepository, OfferRepository, OrderRepository, DashboardReadModel, BuyerIdentityRepository, OutboxRepository, MerchantRulesRepository, MerchantRepository {
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

  private _getRulesSync(merchantId: string): MerchantRules {
    if (!this.rules.has(merchantId)) this.rules.set(merchantId, { ...DEFAULT_RULES });
    return this.rules.get(merchantId)!;
  }

  async getRules(merchantId: string): Promise<MerchantRules> {
    return this._getRulesSync(merchantId);
  }

  setRules(merchantId: string, rules: Partial<MerchantRules>): MerchantRules {
    const next = { ...this._getRulesSync(merchantId), ...rules };
    this.rules.set(merchantId, next);
    return next;
  }

  async updateRules(merchantId: string, rules: Partial<MerchantRules>): Promise<MerchantRules> {
    return this.setRules(merchantId, rules);
  }

  async getProfile(merchantId: string) {
    return { id: merchantId, name: merchantId };
  }

  async updateTheme(_merchantId: string, theme: MerchantTheme): Promise<MerchantTheme> {
    return theme;
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

  saveSession(session: CheckoutSession): void {
    this.sessions.set(this.key(session.merchantId, session.sessionId), structuredClone(session));
  }

  getSession(merchantId: string, sessionId: string): CheckoutSession | undefined {
    const stored = this.sessions.get(this.key(merchantId, sessionId));
    return stored ? structuredClone(stored) : undefined;
  }

  findSessionsByEmail(merchantId: string, email: string): CheckoutSession[] {
    return Array.from(this.sessions.values()).filter(
      (s) => s.merchantId === merchantId && s.customer?.email?.toLowerCase() === email.toLowerCase()
    );
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

  saveAcceptedOffer(acceptedOffer: AcceptedOffer): void {
    this.acceptedOffers.set(
      this.offerKey(acceptedOffer.merchantId, acceptedOffer.sessionId, acceptedOffer.offerId),
      acceptedOffer
    );
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
    const stored = this.completedOrders.get(this.orderKey(merchantId, sessionId, externalOrderId));
    return stored ? structuredClone(stored) : undefined;
  }

  findCompletedOrderByExternalOrderId(merchantId: string, externalOrderId: string): CompletedOrder | undefined {
    const stored = Array.from(this.completedOrders.values())
      .filter((order) => order.merchantId === merchantId && order.externalOrderId === externalOrderId)
      .sort((a, b) => b.completedAt.localeCompare(a.completedAt))[0];
    return stored ? structuredClone(stored) : undefined;
  }

  updateCompletedOrderTracking(input: {
    merchantId: string;
    sessionId: string;
    externalOrderId: string;
    trackingCode: string;
  }): CompletedOrder | undefined {
    const key = this.orderKey(input.merchantId, input.sessionId, input.externalOrderId);
    const existing = this.completedOrders.get(key);
    if (!existing) return undefined;
    const updated = { ...existing, trackingCode: input.trackingCode };
    this.completedOrders.set(key, updated);
    return structuredClone(updated);
  }

  appendOutbox(event: DomainEventEnvelope): DomainEventEnvelope {
    this.outbox.push(event);
    return event;
  }

  listOutbox(merchantId: string): DomainEventEnvelope[] {
    return this.outbox.filter((event) => event.merchant_id === merchantId);
  }

  listPending(batchSize = 50): DomainEventEnvelope[] {
    return this.outbox.slice(0, batchSize);
  }

  markDelivered(_eventId: string): void {}

  markFailed(_eventId: string): void {}

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
