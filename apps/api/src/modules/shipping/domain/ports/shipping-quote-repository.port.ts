import type { ShippingQuoteEntity } from "../entities/shipping-quote.entity.js";

export const SHIPPING_QUOTE_REPOSITORY = Symbol("SHIPPING_QUOTE_REPOSITORY");

export interface ShippingQuoteRepository {
  save(quote: ShippingQuoteEntity): Promise<void>;
  findById(id: string, merchantId: string): Promise<ShippingQuoteEntity | null>;
  findBySession(sessionId: string, merchantId: string): Promise<ShippingQuoteEntity | null>;
}
