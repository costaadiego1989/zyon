import { Inject, Injectable, Logger, Optional, ServiceUnavailableException, UnauthorizedException } from "@nestjs/common";
import type { CheckoutSession, StartCheckoutRequest } from "@zyon/shared-types";
import { CHECKOUT_SESSION_REPOSITORY, type CheckoutSessionRepository } from "../../domain/ports/checkout-session.repository.port.js";
import { CheckoutSessionEntity } from "../../domain/entities/checkout-session.entity.js";
import { createCheckoutEventEnvelope } from "../../domain/events/checkout-domain-event.js";
import { OUTBOX_REPOSITORY, type OutboxRepository } from "../../../../shared/messaging/ports/outbox.repository.port.js";
import { CheckoutCustomerService } from "./checkout-customer.service.js";
import { HoldoutGroupService } from "../../../revenue-lift/domain/services/holdout-group.service.js";
import { STOREFRONT_CART_PORT, type StorefrontCartPort } from "../../../storefront/domain/ports/storefront-cart.port.js";
import { MetricsService } from "../../../../shared/observability/metrics.service.js";
import { CartPromoResolutionService } from "./cart-promo-resolution.service.js";
import type { TrustedCheckoutBuyer, TrustedWhatsAppCheckoutBuyer } from "./trusted-checkout-buyer.js";
import { commitCheckoutMutation } from "./commit-checkout-mutation.js";
import { requiresPhysicalDelivery } from "../../domain/services/cart-fulfillment.js";
import { QuoteShippingUseCase } from "../../../shipping/application/use-cases/quote-shipping.use-case.js";

interface BootstrapResult {
  session: CheckoutSession;
  suggestedProductsRequest?: { merchant_id: string; session_id: string; cart: any };
}

@Injectable()
export class CheckoutBootstrapService {
  private readonly logger = new Logger(CheckoutBootstrapService.name);

  constructor(
    @Inject(CHECKOUT_SESSION_REPOSITORY) private readonly sessions: CheckoutSessionRepository,
    @Inject(OUTBOX_REPOSITORY) private readonly outbox: OutboxRepository,
    @Optional() private readonly customerService?: CheckoutCustomerService,
    @Optional() private readonly holdoutGroupService?: HoldoutGroupService,
    @Optional() @Inject(STOREFRONT_CART_PORT) private readonly storefrontCart?: StorefrontCartPort,
    @Optional() private readonly metrics?: MetricsService,
    @Optional() private readonly promoResolution?: CartPromoResolutionService,
    @Inject(QuoteShippingUseCase) private readonly shippingQuotes?: QuoteShippingUseCase,
  ) {}

  async bootstrap(input: StartCheckoutRequest, globalUserId: string, cartValidated = false,
    identity?: { trustedBuyer?: TrustedCheckoutBuyer; trustedWhatsAppBuyer?: TrustedWhatsAppCheckoutBuyer; requireBuyerProof?: boolean; refreshCart?: boolean; trustedPhoneBuyer?: { globalUserId: string; phone: string } },
  ): Promise<BootstrapResult> {
    let enrichedInput = input;

    if (identity?.trustedWhatsAppBuyer) {
      const buyer = identity.trustedWhatsAppBuyer;
      if (!buyer.globalUserId || buyer.globalUserId !== globalUserId || buyer.merchantId !== input.merchant_id ||
        buyer.conversationId !== input.cart?.cart_ref || buyer.customer.phone_verified !== true || buyer.customer.email_verified !== false ||
        !buyer.customer.phone || input.customer?.phone !== buyer.customer.phone) {
        throw new UnauthorizedException("checkout_buyer_session_binding_mismatch");
      }
    }

    const cartRef = cartValidated ? (input.cart as any)?.cart_ref : (input as any).cart_ref?.trim?.();
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
              currentDiscount: (storefrontCart.discount ?? 0) / 100,
              items: storefrontCart.items.map((i) => ({
                sku: i.sku,
                name: i.name,
                price: i.unitPriceCents / 100,
                quantity: i.quantity,
                imageUrl: i.imageUrl,
                selected_options: i.selectedOptions?.map((o) => ({
                  group_name: o.groupName,
                  item_name: o.itemName,
                  price_modifier: o.priceModifierInCents / 100,
                })),
              })),
            },
          };
          this.logger.log(`Hydrated cart from storefront for ${cartRef}: ${storefrontCart.items.length} items`);
        }
      } catch (err) {
        this.logger.warn(`Failed to hydrate cart from storefront (non-blocking): ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    if (enrichedInput.cart && !cartValidated) {
      enrichedInput.cart = await this.promoResolution?.resolveCartPromos(
        enrichedInput.cart,
        input.merchant_id
      ) ?? enrichedInput.cart;
    }

    this.metrics?.checkoutStarted.inc({ merchant_id: input.merchant_id });
    if (cartValidated && !requiresPhysicalDelivery(enrichedInput.cart)) enrichedInput = { ...enrichedInput, shipping: undefined };

    const sessionId = enrichedInput.session_id ?? `chk_${crypto.randomUUID()}`;
    this.logger.warn('[CHECKOUT-DBG] session created', { sessionId, globalUserId, cartItems: enrichedInput.cart?.items?.length ?? 0, hasShipping: !!enrichedInput.shipping });

    const existingSession = await this.sessions.getSession(input.merchant_id, sessionId);

    let session: CheckoutSession;
    let preparedCreatedBuyer = false;
    if (existingSession) {
      session = CheckoutSessionEntity.rehydrate(existingSession).snapshot();
    } else {
      session = CheckoutSessionEntity.create({
        merchantId: input.merchant_id,
        sessionId,
        globalUserId,
        conversationId: `conv_${crypto.randomUUID()}`,
        cart: enrichedInput.cart ?? { items: [], total: 0, currency: "BRL", source: "storefront" },
        customer: enrichedInput.customer,
        shipping: enrichedInput.shipping
      }).snapshot();

      // Cohort must be known before atomic experiment enrollment. A resumed
      // checkout keeps its original cohort rather than recomputing assignment.
      session.cohort = this.holdoutGroupService
        ? this.holdoutGroupService.assignCohort(session.globalUserId, session.merchantId)
        : "treatment";

      if (cartRef && session.cart) {
        (session.cart as any).cart_ref = cartRef;
      }
      if (identity?.trustedBuyer && this.customerService) {
        session = await this.customerService.prepareTrustedBuyerForCheckout(session, identity.trustedBuyer);
      }
      if (this.sessions.createSessionIfAbsent) {
        const result = await this.sessions.createSessionIfAbsent(session);
        session = result.session;
        preparedCreatedBuyer = result.created && !!identity?.trustedBuyer && !!this.customerService;
        if (result.created) await this.sessions.recordEvent(input.merchant_id, sessionId, "checkout_started");
      } else {
        if (identity?.requireBuyerProof || identity?.trustedBuyer || identity?.trustedPhoneBuyer || identity?.trustedWhatsAppBuyer) {
          throw new ServiceUnavailableException("checkout_session_binding_unavailable");
        }
        await this.sessions.saveSession(session);
        await this.sessions.recordEvent(input.merchant_id, sessionId, "checkout_started");
      }
      // The event advances the persisted session too. Continue from that state
      // before hydration or the next save; never overwrite a concurrent cart.
      session = await this.sessions.getSession(input.merchant_id, sessionId) ?? session;
    }

    // The embed capability remains bound to its first checkout buyer. A new
    // authenticated buyer (including login after an anonymous start) needs a
    // fresh embed token, so concurrent starts cannot replace someone else's PII.
    if (identity?.trustedWhatsAppBuyer) {
      const buyer = identity.trustedWhatsAppBuyer;
      if (session.globalUserId !== buyer.globalUserId || session.cart.cart_ref !== buyer.conversationId ||
        session.customer?.phone?.replace(/\D/g, "") !== buyer.customer.phone.replace(/\D/g, "")) {
        throw new UnauthorizedException("checkout_buyer_session_binding_mismatch");
      }
    } else if (identity?.trustedPhoneBuyer) {
      if (session.globalUserId !== identity.trustedPhoneBuyer.globalUserId || session.customer?.phone?.replace(/\D/g, "") !== identity.trustedPhoneBuyer.phone.replace(/\D/g, "")) {
        throw new UnauthorizedException("checkout_buyer_session_binding_mismatch");
      }
    } else if (identity?.trustedBuyer) {
      if (session.globalUserId !== identity.trustedBuyer.globalUserId ||
        session.customer?.email?.trim().toLowerCase() !== identity.trustedBuyer.customer.email) {
        throw new UnauthorizedException("checkout_buyer_session_binding_mismatch");
      }
    } else if (identity?.requireBuyerProof && session.customer?.email_verified === true) {
      throw new UnauthorizedException("checkout_buyer_proof_required");
    }

    // A normal same-capability remount can follow a definitive coupon release
    // and explicit reapply on the authenticated source cart. Presence only
    // selects the dedicated path; its transaction still owns proof and CAS.
    const releasedStorefrontResume = cartValidated && !!identity?.trustedBuyer && session.cart.source === "storefront"
      && cartRef === session.cart.cart_ref
      && !!await this.sessions.hasReleasedStorefrontCouponBinding?.(session.merchantId, session.sessionId);
    if (identity?.refreshCart || releasedStorefrontResume) {
      // Requote items, delivery and payment after absence, preserving verified identity.
      // Preserve the old benefit as input; the transaction removes it when its
      // commercial context changes. A refresh cannot grant a caller's discount.
      session = await commitCheckoutMutation(this.sessions, { expected: session, next: {
        ...session, cart: releasedStorefrontResume ? enrichedInput.cart : { ...enrichedInput.cart, currentDiscount: session.cart.currentDiscount,
          commercialNudge: session.cart.commercialNudge },
        shipping: undefined, shippingOptions: undefined, paymentMethod: undefined,
        abandonmentScore: 0, triggerAgent: false,
      } });
    }

    this.logger.warn('[CHECKOUT-DBG] session saved', { sessionId, customer: { cpf: !!session.customer?.cpf, name: !!session.customer?.fullName, asaasId: !!session.customer?.asaasCustomerId } });

    if (identity?.trustedBuyer && this.customerService && !preparedCreatedBuyer) {
      // Authenticate the canonical winner before recognizing any private PII.
      // Refresh above must retain its persisted CAS expectation, not this new profile.
      session = await this.customerService.prepareTrustedBuyerForCheckout(session, identity.trustedBuyer);
    } else if (!identity?.trustedBuyer && !identity?.trustedWhatsAppBuyer && this.customerService && session.customer?.email?.trim()) {
      session = await this.customerService.hydrateReturningBuyerFromEmailHint(session);
    }

    if (!requiresPhysicalDelivery(session.cart)) session = { ...session, shipping: undefined, shippingOptions: undefined };

    // Same-capability remounts do not authorize a former neighborhood selection
    // after the canonical buyer/origin locality changed. Review before saving
    // or rendering; never clear/reprice a persisted or uncertain payment here.
    // Nest requires this provider (no @Optional); older direct construction
    // doubles can omit it without changing their unrelated fixture contracts.
    if (session.shipping && this.shippingQuotes) await this.shippingQuotes.assertNeighborhoodDestination(session);

    const cohort = this.holdoutGroupService
      ? this.holdoutGroupService.assignCohort(session.globalUserId, session.merchantId)
      : ("treatment" as const);
    session.cohort = session.cohort ?? cohort;
    session.featuresApplied = session.featuresApplied ?? {};
    session.aiCostCents = session.aiCostCents ?? 0;

    await this.sessions.saveSession(session);

    if (identity?.trustedBuyer && this.customerService) {
      await this.customerService.persistTrustedBuyerProfile(session, identity.trustedBuyer);
    }

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
