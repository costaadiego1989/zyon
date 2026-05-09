import type { Prisma, PrismaClient } from "@prisma/client";
import type {
  AcceptedOffer,
  AuthorizedOffer,
  Cart,
  ChatTurn,
  CheckoutEventName,
  CheckoutSession,
  CompletedOrder,
  CurrencyCode,
  CustomerHints,
  DashboardOverview,
  DomainEventEnvelope,
  MerchantRules,
  OfferType,
  ShippingQuote
} from "@aacp/shared-types";
import type { CheckoutRepository } from "../../domain/ports/checkout-repository.port.js";
import { CheckoutAbandonmentService } from "../../domain/services/checkout-abandonment.service.js";
import { CheckoutIdentityService } from "../../domain/services/checkout-identity.service.js";

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

export class PrismaCheckoutRepository implements CheckoutRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async transaction<T>(work: (repository: CheckoutRepository) => Promise<T>): Promise<T> {
    return this.prisma.$transaction((tx) => work(new PrismaCheckoutRepository(tx as unknown as PrismaClient)));
  }

  async getRules(merchantId: string): Promise<MerchantRules> {
    const row = await this.prisma.merchantRule.upsert({
      where: { merchantId },
      create: toMerchantRuleCreate(merchantId, DEFAULT_RULES),
      update: {}
    });
    return toMerchantRules(row);
  }

  async updateRules(merchantId: string, rules: Partial<MerchantRules>): Promise<MerchantRules> {
    return this.setRules(merchantId, rules);
  }

  async setRules(merchantId: string, rules: Partial<MerchantRules>): Promise<MerchantRules> {
    const current = await this.getRules(merchantId);
    const next = { ...current, ...rules };
    const row = await this.prisma.merchantRule.upsert({
      where: { merchantId },
      create: toMerchantRuleCreate(merchantId, next),
      update: toMerchantRuleUpdate(next)
    });
    return toMerchantRules(row);
  }

  async resolveGlobalUserId(merchantId: string, customer?: CustomerHints): Promise<string> {
    const identityKey = CheckoutIdentityService.identityKey(merchantId, customer);
    if (!identityKey) return `usr_${crypto.randomUUID()}`;
    const localKey = identityKey.slice(`${merchantId}:`.length);
    const row = await this.prisma.buyerIdentity.upsert({
      where: { merchantId_identityKey: { merchantId, identityKey: localKey } },
      create: { merchantId, identityKey: localKey, globalUserId: `usr_${crypto.randomUUID()}` },
      update: {}
    });
    return row.globalUserId;
  }

  async saveSession(session: CheckoutSession): Promise<void> {
    await this.prisma.checkoutSession.upsert({
      where: { merchantId_sessionId: { merchantId: session.merchantId, sessionId: session.sessionId } },
      create: toCheckoutSessionCreate(session) as any,
      update: toCheckoutSessionUpdate(session) as any
    });
  }

  async getSession(merchantId: string, sessionId: string): Promise<CheckoutSession | undefined> {
    const row = await this.prisma.checkoutSession.findUnique({
      where: { merchantId_sessionId: { merchantId, sessionId } }
    });
    return row ? toCheckoutSession(row) : undefined;
  }

  async findSessionsByEmail(merchantId: string, email: string): Promise<CheckoutSession[]> {
    const rows = await this.prisma.checkoutSession.findMany({
      where: { merchantId }
    });
    return rows
      .map(toCheckoutSession)
      .filter((s) => s.customer?.email?.toLowerCase() === email.toLowerCase());
  }

  async recordEvent(merchantId: string, sessionId: string, event: CheckoutEventName): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const session = await tx.checkoutSession.findUnique({
        where: { merchantId_sessionId: { merchantId, sessionId } }
      });
      await tx.checkoutEvent.create({
        data: { merchantId, sessionId, eventName: event, occurredAt: new Date() }
      });
      if (!session) return;
      const score = CheckoutAbandonmentService.applyEvent(session.abandonmentScore, event);
      await tx.checkoutSession.update({
        where: { merchantId_sessionId: { merchantId, sessionId } },
        data: {
          abandonmentScore: score.nextScore,
          triggerAgent: score.triggerAgent,
          updatedAt: new Date()
        }
      });
    });
  }

  async appendChatTurn(merchantId: string, sessionId: string, turn: ChatTurn): Promise<CheckoutSession> {
    const current = await this.getSession(merchantId, sessionId);
    if (!current) throw new Error("checkout_session_not_found");
    const next = [...current.chatHistory, turn].slice(-50);
    const row = await this.prisma.checkoutSession.update({
      where: { merchantId_sessionId: { merchantId, sessionId } },
      data: {
        chatHistory: next as unknown as Prisma.InputJsonValue,
        updatedAt: new Date()
      }
    });
    return toCheckoutSession(row);
  }

  async saveOffer(offer: AuthorizedOffer): Promise<AuthorizedOffer> {
    const row = await this.prisma.authorizedOffer.upsert({
      where: { id: offer.id },
      create: toAuthorizedOfferCreate(offer),
      update: toAuthorizedOfferUpdate(offer)
    });
    return toAuthorizedOffer(row);
  }

  async getOffer(merchantId: string, offerId: string): Promise<AuthorizedOffer | undefined> {
    const row = await this.prisma.authorizedOffer.findFirst({ where: { id: offerId, merchantId } });
    return row ? toAuthorizedOffer(row) : undefined;
  }

  async saveAcceptedOffer(acceptedOffer: AcceptedOffer): Promise<void> {
    await this.prisma.acceptedOffer.upsert({
      where: {
        merchantId_sessionId_offerId: {
          merchantId: acceptedOffer.merchantId,
          sessionId: acceptedOffer.sessionId,
          offerId: acceptedOffer.offerId
        }
      },
      create: toAcceptedOfferCreate(acceptedOffer),
      update: {}
    });
  }

  async getAcceptedOffer(merchantId: string, sessionId: string, offerId: string): Promise<AcceptedOffer | undefined> {
    const row = await this.prisma.acceptedOffer.findUnique({
      where: { merchantId_sessionId_offerId: { merchantId, sessionId, offerId } }
    });
    return row ? toAcceptedOffer(row) : undefined;
  }

  async saveCompletedOrder(order: CompletedOrder): Promise<{ order: CompletedOrder; idempotent: boolean }> {
    const existing = await this.getCompletedOrder(order.merchantId, order.sessionId, order.externalOrderId);
    if (existing) return { order: existing, idempotent: true };
    const row = await this.prisma.completedOrder.create({ data: toCompletedOrderCreate(order) as any });
    return { order: toCompletedOrder(row), idempotent: false };
  }

  async getCompletedOrder(merchantId: string, sessionId: string, externalOrderId: string): Promise<CompletedOrder | undefined> {
    const row = await this.prisma.completedOrder.findUnique({
      where: { merchantId_sessionId_externalOrderId: { merchantId, sessionId, externalOrderId } }
    });
    return row ? toCompletedOrder(row) : undefined;
  }

  async appendOutbox(event: DomainEventEnvelope): Promise<DomainEventEnvelope> {
    await this.prisma.outboxMessage.upsert({
      where: { eventId: event.event_id },
      create: {
        eventId: event.event_id,
        eventType: event.event_type,
        schemaVersion: event.schema_version,
        merchantId: event.merchant_id,
        occurredAt: new Date(event.occurred_at),
        correlationId: event.correlation_id,
        causationId: event.causation_id,
        producer: event.producer,
        payload: event.payload as Prisma.InputJsonValue
      },
      update: {}
    });
    return event;
  }

  async listOutbox(merchantId: string): Promise<DomainEventEnvelope[]> {
    const rows = await this.prisma.outboxMessage.findMany({
      where: { merchantId },
      orderBy: { createdAt: "asc" }
    });
    return rows.map((row) => ({
      event_id: row.eventId,
      event_type: row.eventType as DomainEventEnvelope["event_type"],
      schema_version: 1,
      merchant_id: row.merchantId,
      occurred_at: row.occurredAt.toISOString(),
      correlation_id: row.correlationId,
      causation_id: row.causationId,
      producer: "checkout",
      payload: row.payload as Record<string, unknown>
    }));
  }

  async overview(merchantId: string): Promise<DashboardOverview> {
    const [sessions, offers, events] = await Promise.all([
      this.prisma.checkoutSession.findMany({ where: { merchantId }, orderBy: { createdAt: "desc" }, take: 10 }),
      this.prisma.authorizedOffer.findMany({ where: { merchantId }, orderBy: { expiresAt: "desc" }, take: 10 }),
      this.prisma.checkoutEvent.findMany({ where: { merchantId } })
    ]);
    const orders = events.filter((event) => event.eventName === "order_completed").length;
    const accepted = events.filter((event) => event.eventName === "offer_accepted").length;
    const allSessions = await this.prisma.checkoutSession.findMany({ where: { merchantId } });
    const allOffers = await this.prisma.authorizedOffer.findMany({ where: { merchantId } });
    return {
      merchant_id: merchantId,
      conversations_started: allSessions.length,
      offers_viewed: allOffers.length,
      offers_accepted: accepted,
      orders_completed: orders,
      conversion_rate_with_agent: allSessions.length ? orders / allSessions.length : 0,
      average_discount: average(allOffers.filter((offer) => offer.type === "discount_percent").map((offer) => offer.value)),
      average_shipping_subsidy: average(allOffers.filter((offer) => offer.type.startsWith("shipping")).map((offer) => offer.value)),
      incremental_revenue: orders * average(allSessions.map((session) => (session.cart as unknown as Cart).total)),
      recent_sessions: sessions.map(toCheckoutSession),
      recent_offers: offers.map(toAuthorizedOffer)
    };
  }
}

function toCheckoutSessionCreate(session: CheckoutSession) {
  return {
    merchantId: session.merchantId,
    sessionId: session.sessionId,
    globalUserId: session.globalUserId,
    conversationId: session.conversationId,
    cart: session.cart as unknown as Prisma.InputJsonValue,
    customer: (session.customer ?? undefined) as unknown as Prisma.InputJsonValue,
    shipping: (session.shipping ?? undefined) as unknown as Prisma.InputJsonValue,
    shippingOptions: (session.shippingOptions ?? undefined) as unknown as Prisma.InputJsonValue,
    abandonmentScore: session.abandonmentScore,
    triggerAgent: session.triggerAgent,
    chatHistory: (session.chatHistory ?? []) as unknown as Prisma.InputJsonValue,
    createdAt: new Date(session.createdAt),
    updatedAt: new Date(session.updatedAt)
  };
}

function toCheckoutSessionUpdate(session: CheckoutSession) {
  return {
    globalUserId: session.globalUserId,
    conversationId: session.conversationId,
    cart: session.cart as unknown as Prisma.InputJsonValue,
    customer: (session.customer ?? undefined) as unknown as Prisma.InputJsonValue,
    shipping: (session.shipping ?? undefined) as unknown as Prisma.InputJsonValue,
    shippingOptions: (session.shippingOptions ?? undefined) as unknown as Prisma.InputJsonValue,
    abandonmentScore: session.abandonmentScore,
    triggerAgent: session.triggerAgent,
    chatHistory: (session.chatHistory ?? []) as unknown as Prisma.InputJsonValue,
    updatedAt: new Date(session.updatedAt)
  };
}

function toCheckoutSession(row: {
  merchantId: string;
  sessionId: string;
  globalUserId: string;
  conversationId: string;
  cart: unknown;
  customer: unknown | null;
  shipping: unknown | null;
  shippingOptions?: unknown | null;
  abandonmentScore: number;
  triggerAgent: boolean;
  chatHistory?: unknown | null;
  createdAt: Date;
  updatedAt: Date;
}): CheckoutSession {
  return {
    merchantId: row.merchantId,
    sessionId: row.sessionId,
    globalUserId: row.globalUserId,
    conversationId: row.conversationId,
    cart: row.cart as Cart,
    customer: (row.customer ?? undefined) as CustomerHints | undefined,
    shipping: (row.shipping ?? undefined) as ShippingQuote | undefined,
    shippingOptions: (row.shippingOptions ?? undefined) as ShippingQuote[] | undefined,
    abandonmentScore: row.abandonmentScore,
    triggerAgent: row.triggerAgent,
    chatHistory: ((row.chatHistory ?? []) as ChatTurn[]),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  };
}

function toAuthorizedOfferCreate(offer: AuthorizedOffer) {
  return {
    id: offer.id,
    merchantId: offer.merchantId,
    sessionId: offer.sessionId,
    type: offer.type,
    value: offer.value,
    approved: offer.approved,
    reason: offer.reason,
    marginAfterOffer: offer.marginAfterOffer,
    expiresAt: new Date(offer.expiresAt),
    discountCode: offer.discountCode
  };
}

function toAuthorizedOfferUpdate(offer: AuthorizedOffer) {
  return {
    type: offer.type,
    value: offer.value,
    approved: offer.approved,
    reason: offer.reason,
    marginAfterOffer: offer.marginAfterOffer,
    expiresAt: new Date(offer.expiresAt),
    discountCode: offer.discountCode
  };
}

function toAuthorizedOffer(row: {
  id: string;
  merchantId: string;
  sessionId: string;
  type: string;
  value: number;
  approved: boolean;
  reason: string;
  marginAfterOffer: number;
  expiresAt: Date;
  discountCode: string | null;
}): AuthorizedOffer {
  return {
    id: row.id,
    merchantId: row.merchantId,
    sessionId: row.sessionId,
    type: row.type as OfferType,
    value: row.value,
    approved: row.approved,
    reason: row.reason,
    marginAfterOffer: row.marginAfterOffer,
    expiresAt: row.expiresAt.toISOString(),
    discountCode: row.discountCode ?? undefined
  };
}

function toAcceptedOfferCreate(offer: AcceptedOffer) {
  return {
    merchantId: offer.merchantId,
    sessionId: offer.sessionId,
    offerId: offer.offerId,
    type: offer.type,
    value: offer.value,
    marginAfterOffer: offer.marginAfterOffer,
    acceptedAt: new Date(offer.acceptedAt),
    expiresAt: new Date(offer.expiresAt)
  };
}

function toAcceptedOffer(row: {
  merchantId: string;
  sessionId: string;
  offerId: string;
  type: string;
  value: number;
  marginAfterOffer: number;
  acceptedAt: Date;
  expiresAt: Date;
}): AcceptedOffer {
  return {
    merchantId: row.merchantId,
    sessionId: row.sessionId,
    offerId: row.offerId,
    type: row.type as OfferType,
    value: row.value,
    marginAfterOffer: row.marginAfterOffer,
    acceptedAt: row.acceptedAt.toISOString(),
    expiresAt: row.expiresAt.toISOString()
  };
}

function toCompletedOrderCreate(order: CompletedOrder) {
  return {
    merchantId: order.merchantId,
    sessionId: order.sessionId,
    externalOrderId: order.externalOrderId,
    orderTotal: order.orderTotal,
    currency: order.currency,
    acceptedOfferId: order.acceptedOfferId,
    trackingCode: order.trackingCode,
    completedAt: new Date(order.completedAt)
  };
}

function toCompletedOrder(row: {
  merchantId: string;
  sessionId: string;
  externalOrderId: string;
  orderTotal: number;
  currency: string;
  acceptedOfferId: string | null;
  trackingCode?: string | null;
  completedAt: Date;
}): CompletedOrder {
  return {
    merchantId: row.merchantId,
    sessionId: row.sessionId,
    externalOrderId: row.externalOrderId,
    orderTotal: row.orderTotal,
    currency: row.currency as CurrencyCode,
    acceptedOfferId: row.acceptedOfferId ?? undefined,
    trackingCode: row.trackingCode ?? undefined,
    completedAt: row.completedAt.toISOString()
  };
}

function toMerchantRuleCreate(merchantId: string, rules: MerchantRules) {
  return { merchantId, ...toMerchantRuleUpdate(rules) };
}

function toMerchantRuleUpdate(rules: MerchantRules) {
  return {
    maxDiscountPercent: rules.maxDiscountPercent,
    minimumMarginPercent: rules.minimumMarginPercent,
    allowFreeShipping: rules.allowFreeShipping,
    allowShippingDiscount: rules.allowShippingDiscount,
    allowBonusItem: rules.allowBonusItem,
    allowStackDiscountAndFreeShipping: rules.allowStackDiscountAndFreeShipping,
    couponBoxEnabled: rules.couponBoxEnabled,
    freeShippingMinCartValue: rules.freeShippingMinCartValue,
    maxShippingSubsidy: rules.maxShippingSubsidy,
    maxPartialShippingDiscount: rules.maxPartialShippingDiscount,
    offerExpirationMinutes: rules.offerExpirationMinutes,
    blockedRegions: rules.blockedRegions,
    brandVoice: rules.brandVoice
  };
}

function toMerchantRules(row: {
  maxDiscountPercent: number;
  minimumMarginPercent: number;
  allowFreeShipping: boolean;
  allowShippingDiscount: boolean;
  allowBonusItem: boolean;
  allowStackDiscountAndFreeShipping: boolean;
  freeShippingMinCartValue: number;
  maxShippingSubsidy: number;
  maxPartialShippingDiscount: number;
  offerExpirationMinutes: number;
  blockedRegions: string[];
  brandVoice: string;
  couponBoxEnabled?: boolean | null;
}): MerchantRules {
  return {
    maxDiscountPercent: row.maxDiscountPercent,
    minimumMarginPercent: row.minimumMarginPercent,
    allowFreeShipping: row.allowFreeShipping,
    allowShippingDiscount: row.allowShippingDiscount,
    allowBonusItem: row.allowBonusItem,
    allowStackDiscountAndFreeShipping: row.allowStackDiscountAndFreeShipping,
    freeShippingMinCartValue: row.freeShippingMinCartValue,
    maxShippingSubsidy: row.maxShippingSubsidy,
    maxPartialShippingDiscount: row.maxPartialShippingDiscount,
    offerExpirationMinutes: row.offerExpirationMinutes,
    blockedRegions: row.blockedRegions,
    brandVoice: row.brandVoice as MerchantRules["brandVoice"],
    couponBoxEnabled: row.couponBoxEnabled ?? true
  };
}

function average(values: number[]): number {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}
