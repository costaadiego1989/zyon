import { Injectable, Inject } from "@nestjs/common";
import { buildQuoteKey } from "@aacp/shipping-engine";
import { ShippingQuoteEntity, type ShippingQuoteResult } from "../../domain/entities/shipping-quote.entity.js";
import { SHIPPING_QUOTE_REPOSITORY, type ShippingQuoteRepository } from "../../domain/ports/shipping-quote-repository.port.js";
import { CARRIER_ADAPTERS, type CarrierPort } from "../../domain/ports/carrier.port.js";
import { applyFreeShippingPolicy } from "../../domain/policies/free-shipping.policy.js";
import type { PackageDimensions } from "@aacp/shared-types";

export interface QuoteShippingInput {
  session_id: string;
  merchant_id: string;
  destination_zip: string;
  cart_total: number;
  free_shipping_threshold?: number;
  origin_zip?: string;
  packages?: PackageDimensions[];
  items?: { sku: string; quantity: number }[];
}

@Injectable()
export class QuoteShippingUseCase {
  constructor(
    @Inject(SHIPPING_QUOTE_REPOSITORY) private readonly quotes: ShippingQuoteRepository,
    @Inject(CARRIER_ADAPTERS) private readonly carriers: CarrierPort[]
  ) {}

  async execute(input: QuoteShippingInput) {
    const cartTotalCents = Math.round(input.cart_total * 100);
    const quoteKey = buildQuoteKey({
      merchantId: input.merchant_id,
      destinationZip: input.destination_zip,
      cartTotalCents,
      items: input.items
    });

    const reusable = await this.quotes.findValidByKey(quoteKey, input.merchant_id);
    if (reusable) {
      return reusable.snapshot();
    }

    let quote = ShippingQuoteEntity.create({
      session_id: input.session_id,
      merchant_id: input.merchant_id,
      destination_zip: input.destination_zip,
      quote_key: quoteKey
    });

    const ctx = {
      originZip: input.origin_zip ?? "",
      destinationZip: input.destination_zip,
      cartTotalCents,
      merchantId: input.merchant_id,
      packages: input.packages ?? [],
    };
    const allResults = await Promise.allSettled(
      this.carriers.map((c) => c.fetchQuotes(ctx))
    );

    const liveResults: ShippingQuoteResult[] = [];
    const fallbackResults: ShippingQuoteResult[] = [];

    for (let i = 0; i < allResults.length; i++) {
      const res = allResults[i];
      const carrier = this.carriers[i];
      if (res.status === "fulfilled" && res.value.length > 0) {
        if (carrier.carrierKey === "flat-rate") {
          fallbackResults.push(...res.value);
        } else {
          liveResults.push(...res.value);
        }
      }
    }

    const resultsToAdd = dedupeQuoteResults([...liveResults, ...fallbackResults]);
    quote = quote.addResults(resultsToAdd);

    const freeThreshold = input.free_shipping_threshold ?? Infinity;
    const withFreeShipping = quote.addResults(
      applyFreeShippingPolicy(
        quote.snapshot().results,
        input.cart_total,
        { enabled: freeThreshold !== Infinity, min_cart_total: freeThreshold }
      ).filter((r) => r.is_free && !quote.snapshot().results.find((existing) => existing.carrier_key === r.carrier_key && existing.is_free))
    );

    const finalQuote = withFreeShipping.recordCreated();
    await this.quotes.saveWithEvents(finalQuote);
    return finalQuote.snapshot();
  }
}

function dedupeQuoteResults(results: ShippingQuoteResult[]): ShippingQuoteResult[] {
  const seen = new Set<string>();
  const deduped: ShippingQuoteResult[] = [];
  for (const result of results) {
    const key = `${normalize(result.carrier_key)}:${normalize(result.label)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(result);
  }
  return deduped.sort((a, b) => {
    if (a.price !== b.price) return a.price - b.price;
    if (a.eta_days !== b.eta_days) return a.eta_days - b.eta_days;
    return a.label.localeCompare(b.label, "pt-BR");
  });
}

function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim();
}
