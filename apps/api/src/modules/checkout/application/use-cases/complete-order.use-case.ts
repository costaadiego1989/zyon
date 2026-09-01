import { BadRequestException, Inject, Injectable, Logger, NotFoundException, Optional } from "@nestjs/common";
import type { CheckoutSession, CompleteOrderRequest, CompleteOrderResponse } from "@zyon/shared-types";
import { BUYER_ACCOUNT_REPOSITORY, type BuyerAccountRepository } from "../../../buyer-account/domain/ports/buyer-account-repository.port.js";
import { CompletedOrderEntity } from "../../domain/entities/completed-order.entity.js";
import { createCheckoutEventEnvelope } from "../../domain/events/checkout-domain-event.js";
import { planOmnichannelConfirmation } from "../../domain/policies/omnichannel-confirmation.policy.js";
import { CHECKOUT_SESSION_REPOSITORY, type CheckoutSessionRepository } from "../../domain/ports/checkout-session.repository.port.js";
import { OFFER_REPOSITORY, type OfferRepository } from "../../domain/ports/offer.repository.port.js";
import { ORDER_REPOSITORY, type OrderRepository } from "../../domain/ports/order.repository.port.js";
import { OUTBOX_REPOSITORY, type OutboxRepository } from "../../../../shared/messaging/ports/outbox.repository.port.js";
import { CHECKOUT_REPOSITORY } from "../../domain/ports/checkout-repository.port.js";
import type { CheckoutEventName, CompletedOrder, DomainEventEnvelope } from "@zyon/shared-types";
import { PlaceCrossStoreOrderUseCase } from "../../../marketplace/application/use-cases/place-cross-store-order.use-case.js";
import { MERCHANT_REPOSITORY, type MerchantRepository } from "../../../merchant/domain/ports/merchant-repository.port.js";
import { RecordIntentIfConsentedUseCase } from "../../../intent-memory/application/use-cases/classify-customer-intent.use-case.js";
import { AttributionTaggerService } from "../../../revenue-lift/domain/services/attribution-tagger.service.js";
import {
  PURCHASE_HISTORY_PORT,
  type PurchaseHistoryPort
} from "../../domain/ports/purchase-history.port.js";
import { MetricsService } from "../../../../shared/observability/metrics.service.js";
import { RecordExperimentResultUseCase } from "../../../experiments/application/use-cases/record-experiment-result.use-case.js";
import { RecordFunnelEventUseCase } from "../../../experiments/application/use-cases/record-funnel-event.use-case.js";

interface OrderCommitRepository {
  saveCompletedOrder(order: CompletedOrder): Promise<{ order: CompletedOrder; idempotent: boolean }> | { order: CompletedOrder; idempotent: boolean };
  recordEvent(merchantId: string, sessionId: string, event: CheckoutEventName): Promise<void> | void;
  appendOutbox(event: DomainEventEnvelope): Promise<DomainEventEnvelope> | DomainEventEnvelope;
}

interface TransactionRunner {
  transaction?<T>(work: (repository: OrderCommitRepository) => Promise<T>): Promise<T>;
}

@Injectable()
export class CompleteOrderUseCase {
  constructor(
    @Inject(CHECKOUT_SESSION_REPOSITORY) private readonly sessions: CheckoutSessionRepository,
    @Inject(ORDER_REPOSITORY) private readonly orders: OrderRepository,
    @Inject(OUTBOX_REPOSITORY) private readonly outbox: OutboxRepository,
    @Optional() @Inject(OFFER_REPOSITORY) private readonly offerRepository?: OfferRepository,
    @Optional() @Inject(PURCHASE_HISTORY_PORT) private readonly purchaseHistory?: PurchaseHistoryPort,
    @Optional() @Inject(BUYER_ACCOUNT_REPOSITORY) private readonly buyerAccounts?: BuyerAccountRepository,
    @Optional() private readonly metrics?: MetricsService,
    @Optional() @Inject(CHECKOUT_REPOSITORY) private readonly txRunner?: TransactionRunner,
    @Optional() private readonly recordExperimentResult?: RecordExperimentResultUseCase,
    @Optional() private readonly recordFunnelEvent?: RecordFunnelEventUseCase,
    @Optional() private readonly placeCrossStoreOrder?: PlaceCrossStoreOrderUseCase,
    @Optional() private readonly attributionTagger?: AttributionTaggerService,
    @Optional() private readonly recordIntentIfConsented?: RecordIntentIfConsentedUseCase,
    @Optional() @Inject(MERCHANT_REPOSITORY) private readonly merchantRepo?: MerchantRepository
  ) { }

  private readonly logger = new Logger(CompleteOrderUseCase.name);

  async execute(input: CompleteOrderRequest): Promise<CompleteOrderResponse> {
    const session = await this.sessions.getSession(input.merchant_id, input.session_id);
    if (!session) throw new NotFoundException("checkout_session_not_found");

    let merchantName: string | undefined;
    try {
      merchantName = (await this.merchantRepo?.getProfile(input.merchant_id))?.name;
    } catch { /* non-critical — templates fall back to "nossa loja" */ }

    if (this.offerRepository) {
      const expectedTotal = computeExpectedTotal(session);
      const TOLERANCE = 0.02; // allow ±2¢ for floating point drift
      // The payment amount the buyer is charged includes the fixed platform
      // buyer service fee (R$0,99), which is NOT part of the cart/order total.
      // Accept order_total matching either the product total or product + fee.
      const expectedWithBuyerFee = expectedTotal + BUYER_SERVICE_FEE_MAJOR_UNITS;
      const matchesTotal = Math.abs(input.order_total - expectedTotal) <= TOLERANCE;
      const matchesTotalWithFee = Math.abs(input.order_total - expectedWithBuyerFee) <= TOLERANCE;
      if (!matchesTotal && !matchesTotalWithFee) {
        throw new BadRequestException("order_total_mismatch");
      }

      if (input.accepted_offer_id) {
        const acceptedOffer = await this.offerRepository.getAcceptedOffer(
          input.merchant_id,
          input.session_id,
          input.accepted_offer_id
        );
        if (!acceptedOffer) {
          throw new BadRequestException("accepted_offer_invalid");
        }
      }
    }

    const order = CompletedOrderEntity.complete(input).snapshot();
    const whatsappMessage =
      session.customer?.phone && order.trackingCode
        ? `Olá ${session.customer.fullName || "Cliente"}! Seu pagamento foi confirmado com sucesso. Seu pedido foi processado e o código de rastreio é: ${order.trackingCode}. Obrigado por comprar conosco!`
        : undefined;

    const commit = async (repo: OrderCommitRepository): Promise<boolean> => {
      const saved = await repo.saveCompletedOrder(order);
      if (saved.idempotent) return true;
      await repo.recordEvent(input.merchant_id, input.session_id, "order_completed");
      const confirmation_touchpoints = planOmnichannelConfirmation(input.order_total);
      await repo.appendOutbox(
        createCheckoutEventEnvelope({
          eventType: "order.completed",
          merchantId: input.merchant_id,
          payload: {
            session_id: input.session_id,
            external_order_id: input.external_order_id,
            order_total: input.order_total,
            currency: input.currency,
            accepted_offer_id: input.accepted_offer_id,
            tracking_code: order.trackingCode ?? null,
            confirmation_touchpoints
          },
          causationId: input.external_order_id
        })
      );

      const buyerEmail = session.customer?.email;
      const buyerPhone = session.customer?.phone;
      if (buyerEmail || buyerPhone) {
        await repo.appendOutbox(
          createCheckoutEventEnvelope({
            eventType: "order.confirmed",
            merchantId: input.merchant_id,
            payload: {
              type: "ORDER_CONFIRMATION",
              merchantId: input.merchant_id,
              merchantName,
              orderId: input.external_order_id,
              orderNumber: input.external_order_id,
              buyerEmail: buyerEmail ?? "",
              buyerName: session.customer?.fullName,
              buyerPhone,
              items: (session.cart?.items ?? []).map((it) => ({
                name: it.variant ? `${it.name} (${it.variant})` : it.name,
                quantity: it.quantity,
                price: it.price.toFixed(2),
              })),
              total: input.order_total.toFixed(2),
              currency: input.currency,
            },
            causationId: input.external_order_id
          })
        );
      }
      return false;
    };

    const fallbackRepo: OrderCommitRepository = {
      saveCompletedOrder: (o) => this.orders.saveCompletedOrder(o),
      recordEvent: (m, s, e) => this.sessions.recordEvent(m, s, e),
      appendOutbox: (e) => this.outbox.appendOutbox(e)
    };
    const idempotent = this.txRunner?.transaction
      ? await this.txRunner.transaction(commit)
      : await commit(fallbackRepo);

    if (!idempotent) {
      this.metrics?.orderCompleted.inc({ merchant_id: input.merchant_id });

      await this.recordConversionAnalytics(session, input);

      await this.sendWhatsAppConfirmation(session, whatsappMessage, input);
      this.tagAttributionForOrder(session, input);

      const globalUserId = await this.resolveBuyerGlobalUserId(session);
      if (globalUserId) {
        await this.purchaseHistory?.recordCheckoutPurchase({
          merchantId: input.merchant_id,
          sessionId: input.session_id,
          globalUserId,
          orderId: input.external_order_id,
          currency: input.currency,
          totalAmount: input.order_total,
          discountAmount: session.cart.currentDiscount ?? 0,
          completedAt: order.completedAt,
          items: session.cart.items.map((item) => ({
            sku: item.sku,
            title: item.name,
            quantity: item.quantity,
            unitPrice: item.price,
            discountAmount: 0
          }))
        });
      }
    }

    if (this.placeCrossStoreOrder) {
      try {
        await this.placeCrossStoreOrder.execute({
          checkoutSessionId: input.session_id,
          orderId: input.external_order_id,
          hostMerchantId: input.merchant_id
        });
      } catch (err) {
        this.logger.error("cross-store-order.failed", { error: err instanceof Error ? err.message : String(err) });
      }
    }

    if (this.recordIntentIfConsented && !idempotent) {
      const sessionEvents = await this.sessions.getSessionEvents(input.merchant_id, input.session_id);
      this.recordIntentIfConsented.execute({
        merchantId: input.merchant_id,
        globalUserId: session.globalUserId,
        sessionEvents,
        cart: session.cart
      }).catch((err) => {
        this.logger.warn(`intent-classification.failed (non-blocking)`, {
          merchantId: input.merchant_id,
          error: err instanceof Error ? err.message : String(err)
        });
      });
    }

    return {
      recorded: true,
      idempotent,
      event_type: "order.completed"
    };
  }

  private async recordConversionAnalytics(session: CheckoutSession, input: CompleteOrderRequest): Promise<void> {
    if (!session.promptVariantId) return;
    const elapsedSeconds = session.createdAt
      ? Math.round((Date.now() - new Date(session.createdAt).getTime()) / 1000)
      : undefined;

    if (this.recordExperimentResult) {
      await this.recordExperimentResult.execute({
        sessionId: input.session_id,
        merchantId: input.merchant_id,
        converted: true,
        revenue: input.order_total,
        offersShown: session.chatHistory?.filter(m => m.authorizedOfferId)?.length ?? 0,
        offersAccepted: input.accepted_offer_id ? 1 : 0,
        durationSeconds: elapsedSeconds,
      });
    }

    if (this.recordFunnelEvent) {
      await this.recordFunnelEvent.execute({
        merchantId: input.merchant_id,
        sessionId: input.session_id,
        stage: 'checkout_completed',
        metadata: { timeFromStart: elapsedSeconds },
      });
    }
  }

  private async sendWhatsAppConfirmation(
    session: CheckoutSession,
    whatsappMessage: string | undefined,
    input: CompleteOrderRequest
  ): Promise<void> {
    if (!whatsappMessage || !session.customer?.phone) return;
    const bubbleUrl = process.env.BUBBLEWHATS_API_URL;
    const bubbleToken = process.env.BUBBLEWHATS_TOKEN;
    if (!bubbleUrl || !bubbleToken) return;
    try {
      const cleanDigits = session.customer.phone.replace(/\D/g, "");
      const jid = cleanDigits.startsWith("55") ? cleanDigits : `55${cleanDigits}`;
      const response = await fetch(`${bubbleUrl}/send-message`, {
        method: "POST",
        headers: { "Authorization": bubbleToken, "Content-Type": "application/json" },
        body: JSON.stringify({ jid, message: whatsappMessage })
      });
      if (response.ok) {
        this.logger.log(`BubbleWhats message sent`, { jid, merchant_id: input.merchant_id, session_id: input.session_id });
        return;
      }
      const errText = await response.text();
      this.logger.error(`BubbleWhats failed to send message`, { status: response.status, body: errText, merchant_id: input.merchant_id, session_id: input.session_id });
    } catch (err) {
      this.logger.error(`BubbleWhats error sending WhatsApp message`, { error: err, merchant_id: input.merchant_id, session_id: input.session_id });
    }
  }

  private tagAttributionForOrder(session: CheckoutSession, input: CompleteOrderRequest): void {
    if (!this.attributionTagger) return;
    try {
      const cohort = (session as any).cohort || "treatment";
      const attributionTag = this.attributionTagger.tag({
        sessionId: input.session_id,
        orderId: input.external_order_id,
        cohort: cohort as "holdout" | "treatment",
        features: {
          negotiation: false, // TODO: detect if negotiation was applied
          crossSell: false, // TODO: detect if cross-sell was applied
          progressiveDiscount: (session.cart.currentDiscount ?? 0) > 0,
          cartRecovery: false, // TODO: detect if recovery was applied
          intentPersonalization: false, // TODO: detect if intent was applied
          experimentVariantId: session.promptVariantId
        },
        revenue: {
          orderValueCents: input.order_total,
          discountCents: session.cart.currentDiscount ?? 0,
          shippingSubsidyCents: 0 // TODO: calculate from shipping realCost vs customerPrice
        },
        aiCostCents: 0 // TODO: track LLM costs per session
      });
      this.logger.debug("attribution.tagged", { sessionId: input.session_id, cohort, tag: attributionTag });
    } catch (err) {
      this.logger.error("attribution.failed", { error: err instanceof Error ? err.message : String(err) });
    }
  }

  private async resolveBuyerGlobalUserId(session: CheckoutSession): Promise<string | undefined> {
    const email = session.customer?.email?.trim().toLowerCase();
    if (email && this.buyerAccounts) {
      const account = await this.buyerAccounts.findByEmail(email);
      if (account?.globalUserId) return account.globalUserId;
    }
    return session.globalUserId || undefined;
  }
}

// Fixed platform buyer service fee (R$0,99) added to the payment amount the
// buyer is charged. Kept in sync with payment module's BUYER_SERVICE_FEE_CENTS
// (99). Duplicated here to avoid a checkout→payment module dependency.
const BUYER_SERVICE_FEE_MAJOR_UNITS = 0.99;

function computeExpectedTotal(session: CheckoutSession): number {
  const gross = session.cart.items.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const discount = session.cart.currentDiscount ?? 0;
  const shipping = session.shipping?.customerPrice ?? 0;
  const total = gross + shipping - discount;
  return Math.round(Math.max(0, total) * 100) / 100;
}
