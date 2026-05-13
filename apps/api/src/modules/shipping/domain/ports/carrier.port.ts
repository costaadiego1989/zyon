import type { ShippingContext } from "@aacp/shared-types";
import type { ShippingQuoteResult } from "../entities/shipping-quote.entity.js";

export const CARRIER_ADAPTERS = Symbol("CARRIER_ADAPTERS");

export type { ShippingContext };

export interface CarrierPort {
  readonly carrierKey: string;
  fetchQuotes(ctx: ShippingContext): Promise<ShippingQuoteResult[]>;
}
