import { Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { PriceSourcePort } from "../../domain/ports/price-source.port.js";
import type { ProductQuery, PriceQuoteResult } from "../../domain/entities/price-quote-job.entity.js";
import { calculateTotalCost } from "../../domain/policies/total-cost.policy.js";

@Injectable()
export class FlatRateSourceAdapter implements PriceSourcePort {
  readonly sourceKey = "flat-rate";

  async fetchQuote(query: ProductQuery, _merchantId: string): Promise<PriceQuoteResult[]> {
    const price = 99.9;
    const shipping = 15.0;
    return [
      {
        id: randomUUID(),
        source_key: this.sourceKey,
        product_title: query.normalized_name,
        url: "https://example.com/product",
        price,
        shipping_estimate: shipping,
        total_cost: calculateTotalCost({ price, shipping_estimate: shipping }),
        currency: "BRL",
        availability: "in_stock",
        raw_snapshot: {},
        ingested_at: new Date().toISOString()
      }
    ];
  }
}
