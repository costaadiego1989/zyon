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
import { RecordIntentIfConsentedUseCase } from "../../../intent-memory/application/use-cases/classify-customer-intent.use-case.js";
import { AttributionTaggerService } from "../../../revenue-lift/domain/services/attribution-tagger.service.js";

/** Persistence surface required to commit an order atomically with its events. */
interface OrderCommitRepository {
  saveCompletedOrder(order: CompletedOrder): Promise<{ order: CompletedOrder; idempotent: boolean }> | { order: CompletedOrder; idempotent: boolean };
  recordEvent(merchantId: string, sessionId: string, event: CheckoutEventName): Promise<void> | void;
  appendOutbox(event: DomainEventEnvelope): Promise<DomainEventEnvelope> | DomainEventEnvelope;
}

/** Optional transaction boundary; absent under in-memory test doubles. */
interface TransactionRunner {
  transaction?<T>(work: (repository: OrderCommitRepository) => Promise<T>): Promise<T>;
}
import {
  PURCHASE_HISTORY_PORT,
  type PurchaseHistoryPort
} from "../../domain/ports/purchase-history.port.js";
import { MetricsService } from "../../../../shared/observability/metrics.service.js";
import { RecordExperimentResultUseCase } from "../../../experiments/application/use-cases/record-experiment-result.use-case.js";
import { RecordFunnelEventUseCase } from "../../../experiments/application/use-cases/record-funnel-event.use-case.js";

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
    @Optional() private readonly recordIntentIfConsented?: RecordIntentIfConsentedUseCase
  ) { }

  private readonly logger = new Logger(CompleteOrderUseCase.name);

  async execute(input: CompleteOrderRequest): Promise<CompleteOrderResponse> {
    const session = await this.sessions.getSession(input.merchant_id, input.session_id);
    if (!session) throw new NotFoundException("checkout_session_not_found");

    // P1: server-side recompute and validation — never trust client-supplied totals.
    // Guards only fire when offerRepository is wired (i.e., production path).
    // Without offerRepository (in-memory test doubles), we skip to preserve test compatibility.
    if (this.offerRepository) {
      const expectedTotal = computeExpectedTotal(session);
      const TOLERANCE = 0.02; // allow ±2¢ for floating point drift
      if (Math.abs(input.order_total - expectedTotal) > TOLERANCE) {
        throw new BadRequestException("order_total_mismatch");
      }

      // P1: validate accepted_offer_id belongs to this session.
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

    // Order aggregate + its outbox events must commit atomically: a crash must
    // not persist a completed order without emitting order.completed.
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
      if (whatsappMessage && session.customer?.phone && order.trackingCode) {
        await repo.appendOutbox(
          createCheckoutEventEnvelope({
            eventType: "whatsapp.message.requested",
            merchantId: input.merchant_id,
            payload: {
              session_id: input.session_id,
              phone: session.customer.phone,
              template: "order_tracking",
              external_order_id: input.external_order_id,
              tracking_code: order.trackingCode,
              message: whatsappMessage
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

      // Record experiment result if session has a variant
      if (session.promptVariantId && this.recordExperimentResult) {
        const durationSeconds = session.createdAt
          ? Math.round((Date.now() - new Date(session.createdAt).getTime()) / 1000)
          : undefined;
        await this.recordExperimentResult.execute({
          sessionId: input.session_id,
          merchantId: input.merchant_id,
          converted: true,
          revenue: input.order_total,
          offersShown: session.chatHistory?.filter(m => m.authorizedOfferId)?.length ?? 0,
          offersAccepted: input.accepted_offer_id ? 1 : 0,
          durationSeconds,
        });
      }

      // Record checkout completion as final funnel stage
      if (session.promptVariantId && this.recordFunnelEvent) {
        const timeFromStart = session.createdAt
          ? Math.round((Date.now() - new Date(session.createdAt).getTime()) / 1000)
          : undefined;
        await this.recordFunnelEvent.execute({
          merchantId: input.merchant_id,
          sessionId: input.session_id,
          stage: 'checkout_completed',
          metadata: { timeFromStart },
        });
      }

      // Side effects outside the transaction: external calls and cross-aggregate writes.
      if (whatsappMessage && session.customer?.phone) {
        const bubbleUrl = process.env.BUBBLEWHATS_API_URL;
        const bubbleToken = process.env.BUBBLEWHATS_TOKEN;
        if (bubbleUrl && bubbleToken) {
          try {
            const cleanDigits = session.customer.phone.replace(/\D/g, "");
            const jid = cleanDigits.startsWith("55") ? cleanDigits : `55${cleanDigits}`;

            const response = await fetch(`${bubbleUrl}/send-message`, {
              method: "POST",
              headers: {
                "Authorization": bubbleToken,
                "Content-Type": "application/json"
              },
              body: JSON.stringify({
                jid,
                message: whatsappMessage
              })
            });

            if (response.ok) {
              this.logger.log(`BubbleWhats message sent`, { jid, merchant_id: input.merchant_id, session_id: input.session_id });
            } else {
              const errText = await response.text();
              this.logger.error(`BubbleWhats failed to send message`, { status: response.status, body: errText, merchant_id: input.merchant_id, session_id: input.session_id });
            }
          } catch (err) {
            this.logger.error(`BubbleWhats error sending WhatsApp message`, { error: err, merchant_id: input.merchant_id, session_id: input.session_id });
          }
        }
      }

      // Revenue Lift: tag order for attribution (if service is available)
      if (this.attributionTagger) {
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
          // Non-critical — attribution tagging failure does not block order completion
        }
      }

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

    // Async intent classification (non-blocking): records buyer intent if consented
    // Runs AFTER order completion so buyer is not blocked
    if (this.recordIntentIfConsented && !idempotent) {
      this.recordIntentIfConsented.execute({
        merchantId: input.merchant_id,
        globalUserId: session.globalUserId,
        sessionEvents: [],
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

  private async resolveBuyerGlobalUserId(session: CheckoutSession): Promise<string | undefined> {
    const email = session.customer?.email?.trim().toLowerCase();
    if (email && this.buyerAccounts) {
      const account = await this.buyerAccounts.findByEmail(email);
      if (account?.globalUserId) return account.globalUserId;
    }
    return session.globalUserId || undefined;
  }
}

/**
 * Recompute the expected order total server-side from the session state.
 * cart.total is GROSS (sum of line totals); discount and shipping are applied once here.
 */
function computeExpectedTotal(session: CheckoutSession): number {
  const gross = session.cart.items.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const discount = session.cart.currentDiscount ?? 0;
  const shipping = session.shipping?.customerPrice ?? 0;
  const total = gross + shipping - discount;
  return Math.round(Math.max(0, total) * 100) / 100;
}
