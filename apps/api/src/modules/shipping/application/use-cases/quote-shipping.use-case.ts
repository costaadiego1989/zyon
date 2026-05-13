import { Injectable, Inject } from "@nestjs/common";
import { ShippingQuoteEntity } from "../../domain/entities/shipping-quote.entity.js";
import { SHIPPING_QUOTE_REPOSITORY, type ShippingQuoteRepository } from "../../domain/ports/shipping-quote-repository.port.js";
import { CARRIER_ADAPTERS, type CarrierPort } from "../../domain/ports/carrier.port.js";
import { applyFreeShippingPolicy } from "../../domain/policies/free-shipping.policy.js";

@Injectable()
export class QuoteShippingUseCase {
  constructor(
    @Inject(SHIPPING_QUOTE_REPOSITORY) private readonly quotes: ShippingQuoteRepository,
    @Inject(CARRIER_ADAPTERS) private readonly carriers: CarrierPort[]
  ) {}

  async execute(input: {
    session_id: string;
    merchant_id: string;
    destination_zip: string;
    cart_total: number;
    free_shipping_threshold?: number;
  }) {
    let quote = ShippingQuoteEntity.create({
      session_id: input.session_id,
      merchant_id: input.merchant_id,
      destination_zip: input.destination_zip
    });

    const cartTotalCents = Math.round(input.cart_total * 100);
    const ctx = {
      originZip: "",
      destinationZip: input.destination_zip,
      cartTotalCents,
      merchantId: input.merchant_id,
      packages: [],
    };
    const allResults = await Promise.allSettled(
      this.carriers.map((c) => c.fetchQuotes(ctx))
    );

    for (const res of allResults) {
      if (res.status === "fulfilled") {
        quote = quote.addResults(res.value);
      }
    }

    const freeThreshold = input.free_shipping_threshold ?? Infinity;
    const withFreeShipping = quote.addResults(
      applyFreeShippingPolicy(
        quote.snapshot().results,
        input.cart_total,
        { enabled: freeThreshold !== Infinity, min_cart_total: freeThreshold }
      ).filter((r) => r.is_free && !quote.snapshot().results.find((existing) => existing.carrier_key === r.carrier_key && existing.is_free))
    );

    const finalQuote = withFreeShipping;
    await this.quotes.save(finalQuote);
    return finalQuote.snapshot();
  }
}
