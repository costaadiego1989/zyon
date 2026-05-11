import { Injectable, Inject, NotFoundException } from "@nestjs/common";
import { SHIPPING_QUOTE_REPOSITORY, type ShippingQuoteRepository } from "../../domain/ports/shipping-quote-repository.port.js";

@Injectable()
export class SelectShippingMethodUseCase {
  constructor(
    @Inject(SHIPPING_QUOTE_REPOSITORY) private readonly quotes: ShippingQuoteRepository
  ) {}

  async execute(input: { session_id: string; merchant_id: string; carrier_key: string }) {
    const quote = await this.quotes.findBySession(input.session_id, input.merchant_id);
    if (!quote) throw new NotFoundException("shipping_quote_not_found");
    const updated = quote.selectCarrier(input.carrier_key);
    await this.quotes.save(updated);
    return updated.snapshot();
  }
}
