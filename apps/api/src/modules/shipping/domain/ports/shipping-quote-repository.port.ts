import type { ShippingQuoteEntity } from "../entities/shipping-quote.entity.js";

export const SHIPPING_QUOTE_REPOSITORY = Symbol("SHIPPING_QUOTE_REPOSITORY");

export interface ShippingQuoteRepository {
  /**
   * Persists the quote aggregate and its pending domain events atomically.
   * Production (Prisma) wraps both writes in a single transaction so the
   * aggregate and the outbox can never diverge.
   */
  saveWithEvents(quote: ShippingQuoteEntity): Promise<void>;
  findById(id: string, merchantId: string): Promise<ShippingQuoteEntity | null>;
  findBySession(sessionId: string, merchantId: string): Promise<ShippingQuoteEntity | null>;
  /**
   * Returns a non-expired quote matching the deterministic idempotency key so
   * a valid quote can be reused instead of re-hitting the carrier.
   */
  findValidByKey(quoteKey: string, merchantId: string, now?: Date): Promise<ShippingQuoteEntity | null>;
}
