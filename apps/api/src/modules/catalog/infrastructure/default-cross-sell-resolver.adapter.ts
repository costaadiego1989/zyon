import { Injectable } from "@nestjs/common";
import type { CartItem } from "@zyon/shared-types";
import type { CrossSellResolverPort } from "../domain/ports/cross-sell-resolver.port.js";

/**
 * Default implementation of CrossSellResolverPort.
 * Bug-L2-caller-1: This adapter is out-of-sync with the refactored
 * cross-sell resolver (now async, real catalog, returns Promise|null).
 * The port itself is synchronous, so this adapter is temporarily broken.
 * Unblock: convert CrossSellResolverPort and all callers to async.
 * Affected: accept-cross-sell-from-widget.use-case (widget legacy, out of scope).
 */

const CROSS_SELL_SKUS = new Set(["NECS-001", "NECS-002", "CART-COE-01"]);

@Injectable()
export class DefaultCrossSellResolverAdapter implements CrossSellResolverPort {
  isKnownCrossSellSku(sku: string): boolean {
    return CROSS_SELL_SKUS.has(sku);
  }

  resolveCartItem(sku: string): CartItem | null {
    // FIXME: Bug-L2-caller-4
    // The cross-sell resolver is now async (Bug 2: real catalog). This adapter
    // must also become async, which requires refactoring the CrossSellResolverPort
    // and all its callers (currently accept-cross-sell-from-widget.use-case).
    // Until that refactor, this adapter rejects unknown SKUs (returns null) to
    // prevent phantom prices (the hardcoded R$59,90 bug). Known SKUs from the
    // legacy CATALOG are also rejected to force the use of real catalog lookup.
    // TODO: make this async, inject productRepo, call the real resolver.
    return null;
  }
}
