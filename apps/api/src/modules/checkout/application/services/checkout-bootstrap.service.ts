import { Inject, Injectable, Logger, Optional } from "@nestjs/common";
import type { CheckoutSession, StartCheckoutRequest } from "@zyon/shared-types";
import { CHECKOUT_SESSION_REPOSITORY, type CheckoutSessionRepository } from "../../domain/ports/checkout-session.repository.port.js";
import { CheckoutSessionEntity } from "../../domain/entities/checkout-session.entity.js";
import { createCheckoutEventEnvelope } from "../../domain/events/checkout-domain-event.js";
import { OUTBOX_REPOSITORY, type OutboxRepository } from "../../../../shared/messaging/ports/outbox.repository.port.js";
import { CheckoutCustomerService } from "./checkout-customer.service.js";
import { HoldoutGroupService } from "../../../revenue-lift/domain/services/holdout-group.service.js";
import { STOREFRONT_CART_PORT, type StorefrontCartPort } from "../../../storefront/domain/ports/storefront-cart.port.js";
import { MetricsService } from "../../../../shared/observability/metrics.service.js";

interface BootstrapResult {
  session: CheckoutSession;
  suggestedProductsRequest?: { merchant_id: string; session_id: string; cart: any };
}

/** Handles cart hydration, session creation/rehydration, and cohort assignment. */
@Injectable()
export class CheckoutBootstrapService {
  private readonly logger = new Logger(CheckoutBootstrapService.name);

  constructor(
    @Inject(CHECKOUT_SESSION_REPOSITORY) private readonly sessions: CheckoutSessionRepository,
    @Inject(OUTBOX_REPOSITORY) private readonly outbox: OutboxRepository,
    @Optional() private readonly customerService?: CheckoutCustomerService,
    @Optional() private readonly holdoutGroupService?: HoldoutGroupService,
    @Optional() @Inject(STOREFRONT_CART_PORT) private readonly storefrontCart?: StorefrontCartPort,
    @Optional() private readonly metrics?: MetricsService
  ) {}

  /**
   * Bootstraps checkout session: hydrates cart from storefront, creates/rehydrates session,
   * assigns cohort, and records events. Returns the persisted session.
   */
  async bootstrap(input: StartCheckoutRequest, globalUserId: string): Promise<BootstrapResult> {
    let enrichedInput = input;

    // Cart hydration from storefront: if a cart_ref is provided and no items are in the input,
    // try to load the storefront cart and merge its items into the request.
    const cartRef = (input as any).cart_ref?.trim?.();
    if (this.storefrontCart && cartRef && (!input.cart?.items || input.cart.items.length === 0)) {
      try {
        const storefrontCart = await this.storefrontCart.getOrCreate(input.merchant_id, cartRef);
        if (storefrontCart?.items && storefrontCart.items.length > 0) {
          enrichedInput = {
            ...enrichedInput,
            cart: {
              currency: enrichedInput.cart?.currency ?? "BRL",
              source: enrichedInput.cart?.source ?? "storefront",
              total: storefrontCart.total / 100,
              items: storefrontCart.items.map((i) => ({
                sku: i.sku,
                name: i.name,
                price: i.unitPriceCents / 100,
                quantity: i.quantity,
              })),
            },
          };
          this.logger.log(`Hydrated cart from storefront for ${cartRef}: ${storefrontCart.items.length} items`);
        }
      } catch (err) {
        this.logger.warn(`Failed to hydrate cart from storefront (non-blocking): ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    this.metrics?.checkoutStarted.inc({ merchant_id: input.merchant_id });

    const sessionId = enrichedInput.session_id ?? `chk_${crypto.randomUUID()}`;
    this.logger.warn('[CHECKOUT-DBG] session created', { sessionId, globalUserId, cartItems: enrichedInput.cart?.items?.length ?? 0, hasShipping: !!enrichedInput.shipping });

    const existingSession = await this.sessions.getSession(input.merchant_id, sessionId);

    let session: CheckoutSession;
    if (existingSession) {
      session = CheckoutSessionEntity.rehydrate(existingSession).snapshot();
    } else {
      session = CheckoutSessionEntity.create({
        merchantId: input.merchant_id,
        sessionId,
        globalUserId,
        conversationId: `conv_${crypto.randomUUID()}`,
        cart: enrichedInput.cart,
        customer: enrichedInput.customer,
        shipping: enrichedInput.shipping
      }).snapshot();
      await this.sessions.saveSession(session);
      await this.sessions.recordEvent(input.merchant_id, sessionId, "checkout_started");
    }

    this.logger.warn('[CHECKOUT-DBG] session saved', { sessionId, customer: { cpf: !!session.customer?.cpf, name: !!session.customer?.fullName, asaasId: !!session.customer?.asaasCustomerId } });

    if (this.customerService && session.customer?.email?.trim()) {
      session = await this.customerService.hydrateReturningBuyerFromEmailHint(session);
    }

    // Revenue Lift: assign holdout cohort deterministically.
    // Default to "treatment" if HoldoutGroupService is not available (graceful degradation).
    const cohort = this.holdoutGroupService
      ? this.holdoutGroupService.assignCohort(session.globalUserId, session.merchantId)
      : ("treatment" as const);
    (session as any).cohort = cohort;

    // Persist cohort assignment for new and existing sessions
    await this.sessions.saveSession(session);

    await this.outbox.appendOutbox(
      createCheckoutEventEnvelope({
        eventType: "checkout.session.started",
        merchantId: input.merchant_id,
        payload: {
          session_id: session.sessionId,
          conversation_id: session.conversationId,
          global_user_id: session.globalUserId,
          cart_total: session.cart.total,
          currency: session.cart.currency,
          has_customer_hint: Boolean(enrichedInput.customer),
          has_shipping_quote: Boolean(enrichedInput.shipping)
        },
        causationId: session.sessionId
      })
    );

    return {
      session,
      suggestedProductsRequest: {
        merchant_id: input.merchant_id,
        session_id: session.sessionId,
        cart: session.cart
      }
    };
  }
}
