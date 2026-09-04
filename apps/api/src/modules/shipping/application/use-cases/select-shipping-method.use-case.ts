import { Injectable, Inject, NotFoundException, Optional, ConflictException, BadRequestException , Logger} from "@nestjs/common";
import type { ShippingQuote } from "@zyon/shared-types";
import { SHIPPING_QUOTE_REPOSITORY, type ShippingQuoteRepository } from "../../domain/ports/shipping-quote-repository.port.js";
import { CHECKOUT_SESSION_REPOSITORY, type CheckoutSessionRepository } from "../../../checkout/domain/ports/checkout-session.repository.port.js";
import type { ShippingQuoteResult, ShippingQuoteSnapshot } from "../../domain/entities/shipping-quote.entity.js";
import { CorrelationIdStorage } from "../../../../shared/logger/correlation-id.storage.js";

@Injectable()
export class SelectShippingMethodUseCase {
  private readonly logger = new Logger(SelectShippingMethodUseCase.name);

  constructor(
    @Inject(SHIPPING_QUOTE_REPOSITORY) private readonly quotes: ShippingQuoteRepository,
    @Optional() @Inject(CHECKOUT_SESSION_REPOSITORY) private readonly checkoutSessions?: CheckoutSessionRepository
  ) {}

  async execute(input: { session_id: string; merchant_id: string; carrier_key: string }) {
    const quote = await this.quotes.findBySession(input.session_id, input.merchant_id);
    if (!quote) throw new NotFoundException("shipping_quote_not_found");
    if (quote.isExpired()) throw new ConflictException("shipping_quote_expired");

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
    realCost: result.is_free ? 0 : price,
    carrier: result.carrier_key,
    method: result.label,
    deliveryDays: result.eta_days,
    destinationZip: snapshot.destination_zip
  };
}

function centsToMajorUnits(cents: number): number {
  return Math.round(cents) / 100;
}
