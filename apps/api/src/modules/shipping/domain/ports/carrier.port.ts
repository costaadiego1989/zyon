import type { ShippingQuoteResult } from "../entities/shipping-quote.entity.js";

export const CARRIER_ADAPTERS = Symbol("CARRIER_ADAPTERS");

export interface CarrierPort {
  readonly carrierKey: string;
  fetchQuotes(destinationZip: string, cartTotalCents: number, merchantId: string): Promise<ShippingQuoteResult[]>;
}
