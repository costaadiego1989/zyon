import { Injectable } from "@nestjs/common";
import type { SuggestedProduct } from "@zyon/shared-types";
import type { CheckoutCrossSellRecommenderPort } from "../../../checkout/domain/ports/cross-sell-recommender.port.js";
import { ListEligibleCrossSellsUseCase } from "../use-cases/list-eligible-cross-sells.use-case.js";
import { resolveCrossSellProduct } from "./cross-sell-product-resolver.js";

@Injectable()
export class CheckoutCrossSellRecommender implements CheckoutCrossSellRecommenderPort {
  constructor(private readonly listEligible: ListEligibleCrossSellsUseCase) {}

  async suggest(input: Parameters<CheckoutCrossSellRecommenderPort["suggest"]>[0]): Promise<SuggestedProduct[]> {
    const suggestions = await this.listEligible.execute({
      merchant_id: input.merchant_id,
      session_id: input.session_id,
      cart: input.cart
    });

    return suggestions.flatMap((suggestion) =>
      suggestion.ranked_items.map((sku) => resolveCrossSellProduct(sku, suggestion.id))
    );
  }
}
