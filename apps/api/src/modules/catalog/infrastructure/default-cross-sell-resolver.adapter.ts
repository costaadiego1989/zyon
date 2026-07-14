import { Injectable } from "@nestjs/common";
import type { CartItem } from "@zyon/shared-types";
import { resolveCrossSellCartItem } from "../../cross-sell/application/services/cross-sell-product-resolver.js";
import type { CrossSellResolverPort } from "../domain/ports/cross-sell-resolver.port.js";

/**
 * Default implementation of CrossSellResolverPort.
 * Delegates to the cross-sell module's resolver. Catalog depends on the
 * port abstraction; this adapter is wired by the module config.
 * (CAT-H3: Introduce CrossSellResolverPort)
 */

const CROSS_SELL_SKUS = new Set(["NECS-001", "NECS-002", "CART-COE-01"]);

@Injectable()
export class DefaultCrossSellResolverAdapter implements CrossSellResolverPort {
  isKnownCrossSellSku(sku: string): boolean {
    return CROSS_SELL_SKUS.has(sku);
  }

  resolveCartItem(sku: string): CartItem {
    return resolveCrossSellCartItem(sku);
  }
}
