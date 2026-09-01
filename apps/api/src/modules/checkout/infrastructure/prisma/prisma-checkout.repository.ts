import type { Prisma, PrismaClient } from "@prisma/client";
import type {
  AcceptedOffer,
  AuthorizedOffer,
  Cart,
  ChatTurn,
  CheckoutEventName,
  CheckoutSession,
  CompletedOrder,
  CompletedOrderStatus,
  CurrencyCode,
  CustomerHints,
  DashboardOverview,
  DomainEventEnvelope,
  MerchantRules,
  OfferType,
  ShippingQuote
} from "@zyon/shared-types";
import { DEFAULT_MERCHANT_RULES } from "@zyon/shared-types";
import type { CheckoutRepository } from "../../domain/ports/checkout-repository.port.js";
import { CheckoutAbandonmentService } from "../../domain/services/checkout-abandonment.service.js";
import { CheckoutIdentityService } from "../../domain/services/checkout-identity.service.js";
import { toNumber, toNumberOrNull, type DecimalLike } from "../../../../shared/persistence/decimal.util.js";

// P2 fix: single canonical default — no inline copy here.
const DEFAULT_RULES: MerchantRules = DEFAULT_MERCHANT_RULES;

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
    // P2: customer email lives in a JSON column — filter is pushed to Prisma's JSON
    // path query rather than loading all rows into memory.
    // NOTE: full DB-level index on customerEmail requires a denormalized column in
    // the schema (blocked — schema is owned by a prior phase). This is the best
    // achievable without schema migration.
    const normalizedEmail = email.toLowerCase().trim();
    const rows = await this.prisma.checkoutSession.findMany({
      where: {
        merchantId,
        customer: {
          path: ["email"],
          string_contains: normalizedEmail
        }
      }
    });
    // Secondary in-process filter to enforce exact match (path string_contains is a substring search).
    return rows
      .map(toCheckoutSession)
      .filter((s) => s.customer?.email?.toLowerCase().trim() === normalizedEmail);
  }

  async findSessionsWithTrigger(threshold = 0.55): Promise<CheckoutSession[]> {
    // Cart Recovery scanner targets recently-triggered sessions. 72h window gives
    // abandoned carts a realistic chance to be recovered (buyer may return next day).
    const RECOVERY_WINDOW_HOURS = 72;
    const twentyFourHoursAgo = new Date(Date.now() - RECOVERY_WINDOW_HOURS * 60 * 60 * 1000);
    const rows = await this.prisma.checkoutSession.findMany({
      where: {
        triggerAgent: true,
        abandonmentScore: { gte: threshold },
        updatedAt: { gte: twentyFourHoursAgo }
      },
      take: 100,
      orderBy: { updatedAt: "desc" }
    });
    return rows.map(toCheckoutSession);
  }

  async recordEvent(merchantId: string, sessionId: string, event: CheckoutEventName, metadata?: Record<string, unknown>): Promise<void> {
    if (!event) return; // Guard: missing event name should not 500
    await this.prisma.$transaction(async (tx) => {
      const session = await tx.checkoutSession.findUnique({
        where: { merchantId_sessionId: { merchantId, sessionId } }
      });
      await tx.checkoutEvent.create({
        data: { merchantId, sessionId, eventName: event, occurredAt: new Date(), metadata: metadata as any }
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

  async getSessionEvents(merchantId: string, sessionId: string): Promise<CheckoutEventName[]> {
    const rows = await this.prisma.checkoutEvent.findMany({
      where: { merchantId, sessionId },
      orderBy: { occurredAt: "asc" },
      select: { eventName: true }
    });
    return rows.map((r) => r.eventName as CheckoutEventName);
  }

  async appendChatTurn(merchantId: string, sessionId: string, turn: ChatTurn): Promise<CheckoutSession> {
    const current = await this.getSession(merchantId, sessionId);
    if (!current) throw new Error("checkout_session_not_found");
    const next = [...current.chatHistory, turn].slice(-50);

    // Optimistic locking: prevent concurrent overwrites using updatedAt timestamp.
    // If session was updated since we read it, Prisma will return 0 rows and we throw.
    const currentUpdatedAt = new Date(current.updatedAt);
    const result = await this.prisma.checkoutSession.updateMany({
      where: {
        merchantId,
        sessionId,
        updatedAt: currentUpdatedAt
      },
      data: {
        chatHistory: next as unknown as Prisma.InputJsonValue,
        updatedAt: new Date()
      }
    });

    if (result.count === 0) {
      throw new Error("session_conflict_concurrent_update");
    }

    // Re-fetch to return current state (mirrors last-write semantic but safely locked).
    const updated = await this.prisma.checkoutSession.findUnique({
      where: { merchantId_sessionId: { merchantId, sessionId } }
    });
    if (!updated) throw new Error("checkout_session_not_found");
    return toCheckoutSession(updated);
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
    try {
      const row = await this.prisma.completedOrder.create({ data: toCompletedOrderCreate(order) as any });
      return { order: toCompletedOrder(row), idempotent: false };
    } catch (error) {
      // Concurrent completion lost the create race; treat the winner's row as idempotent.
      if (isPrismaUniqueViolation(error)) {
        const winner = await this.getCompletedOrder(order.merchantId, order.sessionId, order.externalOrderId);
        if (winner) return { order: winner, idempotent: true };
      }
      throw error;
    }
  }

  async getCompletedOrder(merchantId: string, sessionId: string, externalOrderId: string): Promise<CompletedOrder | undefined> {
    const row = await this.prisma.completedOrder.findUnique({
      where: { merchantId_sessionId_externalOrderId: { merchantId, sessionId, externalOrderId } }
    });
    return row ? toCompletedOrder(row) : undefined;
  }

  async findCompletedOrderByExternalOrderId(merchantId: string, externalOrderId: string): Promise<CompletedOrder | undefined> {
    const row = await this.prisma.completedOrder.findFirst({
      where: { merchantId, externalOrderId },
      orderBy: { completedAt: "desc" }
    });
    return row ? toCompletedOrder(row) : undefined;
  }

  async updateCompletedOrderTracking(input: {
    merchantId: string;
    sessionId: string;
    externalOrderId: string;
    trackingCode: string;
  }): Promise<CompletedOrder | undefined> {
    try {
      const row = await this.prisma.completedOrder.update({
        where: {
          merchantId_sessionId_externalOrderId: {
            merchantId: input.merchantId,
            sessionId: input.sessionId,
            externalOrderId: input.externalOrderId
          }
        },
        data: { trackingCode: input.trackingCode }
      });
      return toCompletedOrder(row);
    } catch (error) {
      if (isPrismaRecordNotFound(error)) return undefined;
      throw error;
    }
  }

  async updateCompletedOrderStatus(input: {
    merchantId: string;
    sessionId: string;
    externalOrderId: string;
    status: CompletedOrderStatus;
  }): Promise<CompletedOrder | undefined> {
    try {
      const row = await this.prisma.completedOrder.update({
        where: {
          merchantId_sessionId_externalOrderId: {
            merchantId: input.merchantId,
            sessionId: input.sessionId,
            externalOrderId: input.externalOrderId
          }
        },
        data: { status: input.status }
      });
      return toCompletedOrder(row);
    } catch (error) {
      if (isPrismaRecordNotFound(error)) return undefined;
      throw error;
    }
  }

  async cancelCompletedOrder(input: {
    merchantId: string;
    sessionId: string;
    externalOrderId: string;
    reason: string;
    cancelledAt: string;
  }): Promise<{ order: CompletedOrder; idempotent: boolean } | undefined> {
    const existing = await this.getCompletedOrder(
      input.merchantId,
      input.sessionId,
      input.externalOrderId,
    );
    if (!existing) return undefined;
    if (existing.status === "cancelled") {
      return { order: existing, idempotent: true };
    }
    try {
      const result = await this.prisma.completedOrder.updateMany({
        where: {
          merchantId: input.merchantId,
          sessionId: input.sessionId,
          externalOrderId: input.externalOrderId,
          status: { not: "cancelled" },
        },
        data: {
          status: "cancelled",
          cancelledAt: new Date(input.cancelledAt),
          cancellationReason: input.reason,
        },
      });
      const order = await this.getCompletedOrder(
        input.merchantId,
        input.sessionId,
        input.externalOrderId,
      );
      return order
        ? { order, idempotent: result.count === 0 }
        : undefined;
    } catch (error) {
      if (isPrismaRecordNotFound(error)) return undefined;
      throw error;
    }
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

  async listPending(batchSize = 50): Promise<DomainEventEnvelope[]> {
    const rows = await this.prisma.outboxMessage.findMany({
      where: { status: "pending" },
      orderBy: { createdAt: "asc" },
      take: batchSize
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

  async claimBatch(batchSize = 50): Promise<{ envelope: DomainEventEnvelope; attempts: number }[]> {
    const rows = await this.prisma.outboxMessage.findMany({
      where: { status: "pending" },
      orderBy: { createdAt: "asc" },
      take: batchSize
    });
    return rows.map((row) => ({
      envelope: {
        event_id: row.eventId,
        event_type: row.eventType as DomainEventEnvelope["event_type"],
        schema_version: 1,
        merchant_id: row.merchantId,
        occurred_at: row.occurredAt.toISOString(),
        correlation_id: row.correlationId,
        causation_id: row.causationId,
        producer: "checkout",
        payload: row.payload as Record<string, unknown>
      },
      attempts: row.attempts
    }));
  }

  async markDelivered(eventId: string): Promise<void> {
    await this.prisma.outboxMessage.update({
      where: { eventId },
      data: { status: "delivered", deliveredAt: new Date(), publishedAt: new Date() }
    });
  }

  async markFailed(eventId: string, error?: string): Promise<void> {
    await this.prisma.outboxMessage.update({
      where: { eventId },
      data: { status: "failed", lastError: error ?? null }
    });
  }

  async recordFailure(
    eventId: string,
    error: string,
    backoff: { maxAttempts: number; nextAttemptAt: Date }
  ): Promise<{ attempts: number; dead: boolean }> {
    const current = await this.prisma.outboxMessage.findUnique({
      where: { eventId },
      select: { attempts: true }
    });
    const attempts = (current?.attempts ?? 0) + 1;
    const dead = attempts >= backoff.maxAttempts;
    await this.prisma.outboxMessage.update({
      where: { eventId },
      data: {
        attempts,
        lastError: error,
        status: dead ? "dead" : "pending",
        nextAttemptAt: dead ? null : backoff.nextAttemptAt
      }
    });
    return { attempts, dead };
  }

  async isProcessed(eventId: string): Promise<boolean> {
    const row = await this.prisma.outboxMessage.findUnique({
      where: { eventId },
      select: { status: true }
    });
    return row?.status === "delivered";
  }

  async isHandlerProcessed(eventId: string, handlerId: string): Promise<boolean> {
    const row = await this.prisma.outboxHandlerExecution.findUnique({
      where: { eventId_handlerId: { eventId, handlerId } },
      select: { eventId: true }
    });
    return row !== null;
  }

  async markHandlerProcessed(eventId: string, handlerId: string): Promise<void> {
    await this.prisma.outboxHandlerExecution.upsert({
      where: { eventId_handlerId: { eventId, handlerId } },
      create: { eventId, handlerId },
      update: {}
    });
  }

  async overview(merchantId: string): Promise<DashboardOverview> {
    // P2 fix: replace full-table findMany scans with targeted count/aggregate queries.
    const [
      sessions,
      offers,
      conversationsStarted,
      offersViewed,
      ordersCompleted,
      offersAccepted,
      avgDiscountResult,
      avgShippingResult,
      avgCartResult
    ] = await Promise.all([
      this.prisma.checkoutSession.findMany({ where: { merchantId }, orderBy: { createdAt: "desc" }, take: 10 }),
      this.prisma.authorizedOffer.findMany({ where: { merchantId }, orderBy: { expiresAt: "desc" }, take: 10 }),
      this.prisma.checkoutSession.count({ where: { merchantId } }),
      this.prisma.authorizedOffer.count({ where: { merchantId } }),
      this.prisma.checkoutEvent.count({ where: { merchantId, eventName: "order_completed" } }),
      this.prisma.checkoutEvent.count({ where: { merchantId, eventName: "offer_accepted" } }),
      this.prisma.authorizedOffer.aggregate({ where: { merchantId, type: "discount_percent" }, _avg: { value: true } }),
      this.prisma.authorizedOffer.aggregate({ where: { merchantId, type: { startsWith: "shipping" } }, _avg: { value: true } }),
      this.prisma.checkoutSession.aggregate({ where: { merchantId }, _avg: { abandonmentScore: true } })
    ]);
    // incremental_revenue: completed orders × average authorized offer value (best approximation without order table join)
    const avgCartValue = (avgCartResult._avg as Record<string, number | null>).abandonmentScore ?? 0;
    void avgCartValue; // not used directly; kept for future extension
    // Use recent sessions cart total as proxy for average cart value
    const recentTotals = sessions.map((s) => ((s.cart as unknown as Cart).total ?? 0));
    const avgCart = recentTotals.length
      ? recentTotals.reduce((a, b) => a + b, 0) / recentTotals.length
      : 0;
    return {
      merchant_id: merchantId,
      conversations_started: conversationsStarted,
      offers_viewed: offersViewed,
      offers_accepted: offersAccepted,
      orders_completed: ordersCompleted,
      conversion_rate_with_agent: conversationsStarted ? ordersCompleted / conversationsStarted : 0,
      average_discount: toNumber(avgDiscountResult._avg.value),
      average_shipping_subsidy: toNumber(avgShippingResult._avg.value),
      incremental_revenue: ordersCompleted * avgCart,
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
  value: DecimalLike;
  approved: boolean;
  reason: string;
  marginAfterOffer: DecimalLike;
  expiresAt: Date;
  discountCode: string | null;
}): AuthorizedOffer {
  return {
    id: row.id,
    merchantId: row.merchantId,
    sessionId: row.sessionId,
    type: row.type as OfferType,
    value: toNumber(row.value),
    approved: row.approved,
    reason: row.reason,
    marginAfterOffer: toNumber(row.marginAfterOffer),
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
  value: DecimalLike;
  marginAfterOffer: DecimalLike;
  acceptedAt: Date;
  expiresAt: Date;
}): AcceptedOffer {
  return {
    merchantId: row.merchantId,
    sessionId: row.sessionId,
    offerId: row.offerId,
    type: row.type as OfferType,
    value: toNumber(row.value),
    marginAfterOffer: toNumber(row.marginAfterOffer),
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
    status: order.status ?? "approved",
    acceptedOfferId: order.acceptedOfferId,
    trackingCode: order.trackingCode,
    completedAt: new Date(order.completedAt),
    cancelledAt: order.cancelledAt
      ? new Date(order.cancelledAt)
      : undefined,
    cancellationReason: order.cancellationReason,
  };
}

function toCompletedOrder(row: {
  merchantId: string;
  sessionId: string;
  externalOrderId: string;
  orderTotal: DecimalLike;
  currency: string;
  status?: string;
  acceptedOfferId: string | null;
  trackingCode?: string | null;
  completedAt: Date;
  cancelledAt?: Date | null;
  cancellationReason?: string | null;
}): CompletedOrder {
  return {
    merchantId: row.merchantId,
    sessionId: row.sessionId,
    externalOrderId: row.externalOrderId,
    orderTotal: toNumber(row.orderTotal),
    currency: row.currency as CurrencyCode,
    status: row.status as CompletedOrderStatus,
    acceptedOfferId: row.acceptedOfferId ?? undefined,
    trackingCode: row.trackingCode ?? undefined,
    completedAt: row.completedAt.toISOString(),
    cancelledAt: row.cancelledAt?.toISOString(),
    cancellationReason: row.cancellationReason ?? undefined,
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
  maxDiscountPercent: DecimalLike;
  minimumMarginPercent: DecimalLike;
  allowFreeShipping: boolean;
  allowShippingDiscount: boolean;
  allowBonusItem: boolean;
  allowStackDiscountAndFreeShipping: boolean;
  freeShippingMinCartValue: DecimalLike;
  maxShippingSubsidy: DecimalLike;
  maxPartialShippingDiscount: DecimalLike;
  offerExpirationMinutes: number;
  blockedRegions: string[];
  brandVoice: string;
  couponBoxEnabled?: boolean | null;
  autonomousEngineEnabled?: boolean | null;
}): MerchantRules {
  return {
    maxDiscountPercent: toNumber(row.maxDiscountPercent),
    minimumMarginPercent: toNumber(row.minimumMarginPercent),
    allowFreeShipping: row.allowFreeShipping,
    allowShippingDiscount: row.allowShippingDiscount,
    allowBonusItem: row.allowBonusItem,
    allowStackDiscountAndFreeShipping: row.allowStackDiscountAndFreeShipping,
    freeShippingMinCartValue: toNumber(row.freeShippingMinCartValue),
    maxShippingSubsidy: toNumber(row.maxShippingSubsidy),
    maxPartialShippingDiscount: toNumber(row.maxPartialShippingDiscount),
    offerExpirationMinutes: row.offerExpirationMinutes,
    blockedRegions: row.blockedRegions,
    brandVoice: row.brandVoice as MerchantRules["brandVoice"],
    couponBoxEnabled: row.couponBoxEnabled ?? true,
    autonomousEngineEnabled: row.autonomousEngineEnabled ?? true
  };
}

function average(values: number[]): number {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function isPrismaRecordNotFound(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "P2025"
  );
}

function isPrismaUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "P2002"
  );
}
