import { Injectable, Inject, NotFoundException, Optional, ConflictException, BadRequestException , Logger} from "@nestjs/common";
import type { ShippingQuote } from "@zyon/shared-types";
import type { PrismaClient } from "@prisma/client";
import { PRISMA_CLIENT } from "../../../../shared/persistence/persistence.module.js";
import { hasMarketplaceCheckout } from "../../../checkout/infrastructure/marketplace-checkout-scope.js";
import { SHIPPING_QUOTE_REPOSITORY, type ShippingQuoteRepository } from "../../domain/ports/shipping-quote-repository.port.js";
import { CHECKOUT_SESSION_REPOSITORY, type CheckoutSessionRepository } from "../../../checkout/domain/ports/checkout-session.repository.port.js";
import type { ShippingQuoteResult, ShippingQuoteSnapshot } from "../../domain/entities/shipping-quote.entity.js";
import { CorrelationIdStorage } from "../../../../shared/logger/correlation-id.storage.js";
import { QuoteShippingUseCase } from "./quote-shipping.use-case.js";
import { checkoutShippingInput, checkoutShippingOption } from "../checkout-shipping-quote.js";
import { OWN_DELIVERY_CONFIG_REPOSITORY, type OwnDeliveryConfigRepository } from "../../domain/ports/own-delivery-config.port.js";
import { commitCheckoutMutation } from "../../../checkout/application/services/commit-checkout-mutation.js";
import { manualDeliveryConfigSchema, quoteManualDelivery } from "../../domain/services/manual-delivery-quote.js";
import { requiresPhysicalDelivery } from "../../../checkout/domain/services/cart-fulfillment.js";
import { hasPreparedCheckoutPayment } from "../../../checkout/infrastructure/checkout-payment-scope.js";

@Injectable()
export class SelectShippingMethodUseCase {
  private readonly logger = new Logger(SelectShippingMethodUseCase.name);

  constructor(
    @Inject(SHIPPING_QUOTE_REPOSITORY) private readonly quotes: ShippingQuoteRepository,
    @Optional() @Inject(CHECKOUT_SESSION_REPOSITORY) private readonly checkoutSessions?: CheckoutSessionRepository,
    @Inject(PRISMA_CLIENT) private readonly prisma?: PrismaClient,
    @Optional() private readonly quoteShipping?: QuoteShippingUseCase,
    @Optional() @Inject(OWN_DELIVERY_CONFIG_REPOSITORY) private readonly ownDeliveryConfig?: OwnDeliveryConfigRepository
  ) {}

  async execute(input: { session_id: string; merchant_id: string; carrier_key: string; quote_id?: string }) {
    const session = await this.checkoutSessions?.getSession(input.merchant_id, input.session_id);
    if (session && !requiresPhysicalDelivery(session.cart)) throw new BadRequestException("checkout_shipping_not_required");
    await this.assertGenericCheckout(input);
    const quote = input.quote_id ? await this.quotes.findById(input.quote_id, input.merchant_id)
      : await this.quotes.findBySession(input.session_id, input.merchant_id);
    if (!quote) throw new NotFoundException("shipping_quote_not_found");
    if (quote.snapshot().session_id !== input.session_id) throw new NotFoundException("shipping_quote_not_found");
    if (quote.isExpired()) throw new ConflictException("shipping_quote_expired");
    if (this.quoteShipping && session && quote.snapshot().quote_key !== await this.quoteShipping.quoteKey(checkoutShippingInput(session))) {
      throw new ConflictException("shipping_quote_changed");
    }
    if (/estimate|local_pickup/.test(input.carrier_key)) throw new BadRequestException("shipping_carrier_not_available");

    const candidate = quote.snapshot().results.find(option => option.carrier_key === input.carrier_key);
    if (candidate?.carrier_key.startsWith("own_delivery_neighborhood_")) {
      const session = await this.checkoutSessions?.getSession(input.merchant_id, input.session_id);
      const config = manualDeliveryConfigSchema.safeParse(await this.ownDeliveryConfig?.getByMerchantId(input.merchant_id));
      const originResult = await this.ownDeliveryConfig?.getNeighborhoodOrigin?.(input.merchant_id);
      if (originResult?.kind !== "ready") throw new BadRequestException({ code: "shipping_origin_address_configuration_required" });
      const address = session?.customer?.address;
      if (!session || session.merchantId !== input.merchant_id || session.sessionId !== input.session_id
        || session.customer?.address_verified !== true || !address || address.zip?.replace(/\D/g, "") !== quote.snapshot().destination_zip.replace(/\D/g, "")
        || !config.success || config.data.merchantId !== input.merchant_id || !config.data.enabled || config.data.mode !== "neighborhood"
        || !quoteManualDelivery(config.data, { cartTotalCents: Math.round(session.cart.total * 100), neighborhood: address.neighborhood,
          origin: originResult.origin, destinationCity: address.city, destinationState: address.state }).some(option =>
            option.carrier_key === candidate.carrier_key && option.label === candidate.label && option.price === candidate.price
            && option.eta_days === candidate.eta_days && option.is_free === candidate.is_free && option.original_price === candidate.original_price))
        throw new ConflictException("shipping_quote_review_required");
    }

    let updated;
    try {
      updated = quote.selectCarrier(input.carrier_key);
    } catch (error) {
      const reason = error instanceof Error ? error.message : "shipping_select_failed";
      if (reason === "shipping_quote_expired") throw new ConflictException(reason);
      if (reason === "shipping_carrier_not_in_quote") throw new BadRequestException(reason);
      throw error;
    }

    await this.assertGenericCheckout(input);
    await this.quotes.saveWithEvents(updated);
    const snapshot = updated.snapshot();
    await this.persistSelectionToCheckoutSession(input, snapshot);

    const selected = snapshot.results.find((r) => r.carrier_key === snapshot.selected_carrier_key);
    const shipping = selected ? checkoutShippingOption(snapshot, selected) : undefined;

    return { ...snapshot, shipping };
  }

  private async assertGenericCheckout(input: { session_id: string; merchant_id: string }): Promise<void> {
    if (!this.prisma) throw new ConflictException("marketplace_checkout_scope_unavailable");
    if (await hasMarketplaceCheckout(this.prisma, { merchantId: input.merchant_id, sessionId: input.session_id })) {
      throw new ConflictException("marketplace_shipping_selection_required");
    }
    if (await hasPreparedCheckoutPayment(this.prisma, { merchantId: input.merchant_id, sessionId: input.session_id })) {
      throw new ConflictException("shipping_change_requires_payment_cancellation");
    }
  }

  private async persistSelectionToCheckoutSession(
    input: { session_id: string; merchant_id: string },
    snapshot: ShippingQuoteSnapshot
  ): Promise<void> {
    if (!this.checkoutSessions) return;
    const session = await this.checkoutSessions.getSession(input.merchant_id, input.session_id);
    if (!session) throw new NotFoundException("checkout_session_not_found");

    const selectedResult = snapshot.results.find((result) => result.carrier_key === snapshot.selected_carrier_key);
    if (!selectedResult) return;

    await this.assertGenericCheckout(input);
    await commitCheckoutMutation(this.checkoutSessions, { expected: session, next: {
      ...session,
      shipping: checkoutShippingOption(snapshot, selectedResult),
      updatedAt: new Date().toISOString()
    } });
  }
}
