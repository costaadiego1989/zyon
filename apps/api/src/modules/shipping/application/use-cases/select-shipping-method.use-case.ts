import { Injectable, Inject, NotFoundException, Optional, ConflictException, BadRequestException , Logger} from "@nestjs/common";
import type { ShippingQuote } from "@zyon/shared-types";
import { SHIPPING_QUOTE_REPOSITORY, type ShippingQuoteRepository } from "../../domain/ports/shipping-quote-repository.port.js";
import { CHECKOUT_SESSION_REPOSITORY, type CheckoutSessionRepository } from "../../../checkout/domain/ports/checkout-session.repository.port.js";
import type { ShippingQuoteResult, ShippingQuoteSnapshot } from "../../domain/entities/shipping-quote.entity.js";
import { CorrelationIdStorage } from "../../../../shared/logger/correlation-id.storage.js";
import { isDeepStrictEqual } from "node:util";
import { OWN_DELIVERY_CONFIG_REPOSITORY, type OwnDeliveryConfigRepository } from "../../domain/ports/own-delivery-config.port.js";
import { manualDeliveryConfigSchema, quoteManualDelivery } from "../../domain/services/manual-delivery-quote.js";

@Injectable()
export class SelectShippingMethodUseCase {
  private readonly logger = new Logger(SelectShippingMethodUseCase.name);

  constructor(
    @Inject(SHIPPING_QUOTE_REPOSITORY) private readonly quotes: ShippingQuoteRepository,
    @Optional() @Inject(CHECKOUT_SESSION_REPOSITORY) private readonly checkoutSessions?: CheckoutSessionRepository,
    @Optional() @Inject(OWN_DELIVERY_CONFIG_REPOSITORY) private readonly ownDeliveryConfig?: OwnDeliveryConfigRepository
  ) {}

  async execute(input: { session_id: string; merchant_id: string; carrier_key: string }) {
    const quote = await this.quotes.findBySession(input.session_id, input.merchant_id);
    if (!quote) throw new NotFoundException("shipping_quote_not_found");
    if (quote.isExpired()) throw new ConflictException("shipping_quote_expired");
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
          origin: originResult.origin, destinationCity: address.city, destinationState: address.state }).some(option => isDeepStrictEqual(option, candidate)))
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

    await this.quotes.saveWithEvents(updated);
    const snapshot = updated.snapshot();
    await this.persistSelectionToCheckoutSession(input, snapshot);

    const selected = snapshot.results.find((r) => r.carrier_key === snapshot.selected_carrier_key);
    const shipping = selected
      ? {
          carrier: selected.carrier_key,
          carrierKey: selected.carrier_key,
          method: selected.label,
          customerPrice: Math.round(selected.price) / 100,
          isFree: selected.is_free ?? false,
          deliveryDays: selected.eta_days,
        }
      : undefined;

    return { ...snapshot, shipping };
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

    await this.checkoutSessions.saveSession({
      ...session,
      shipping: toCheckoutShippingQuote(snapshot, selectedResult),
      updatedAt: new Date().toISOString()
    });
  }
}

function toCheckoutShippingQuote(snapshot: ShippingQuoteSnapshot, result: ShippingQuoteResult): ShippingQuote {
  const price = centsToMajorUnits(result.price);
  return {
    customerPrice: price,
    realCost: centsToMajorUnits(result.original_price ?? result.price),
    carrier: result.carrier_key,
    method: result.label,
    deliveryDays: result.eta_days,
    destinationZip: snapshot.destination_zip
  };
}

function centsToMajorUnits(cents: number): number {
  return Math.round(cents) / 100;
}
