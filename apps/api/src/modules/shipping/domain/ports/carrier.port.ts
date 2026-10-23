import type { ShippingContext } from "@zyon/shared-types";
import type { ShippingQuoteResult } from "../entities/shipping-quote.entity.js";

export const CARRIER_ADAPTERS = Symbol("CARRIER_ADAPTERS");
/** Internal reference-only composition: real merchant-connected carriers only. */
export const SHIPPING_REFERENCE_CARRIERS = Symbol("SHIPPING_REFERENCE_CARRIERS");

export type { ShippingContext };

export interface CarrierPort {
  readonly carrierKey: string;
  fetchQuotes(ctx: ShippingContext): Promise<ShippingQuoteResult[]>;
}
