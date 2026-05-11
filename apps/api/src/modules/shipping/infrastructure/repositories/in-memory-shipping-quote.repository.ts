import { Injectable } from "@nestjs/common";
import { ShippingQuoteEntity } from "../../domain/entities/shipping-quote.entity.js";
import type { ShippingQuoteRepository } from "../../domain/ports/shipping-quote-repository.port.js";

@Injectable()
export class InMemoryShippingQuoteRepository implements ShippingQuoteRepository {
  private readonly store = new Map<string, ShippingQuoteEntity>();

  async save(quote: ShippingQuoteEntity): Promise<void> {
    this.store.set(quote.id, quote);
  }

  async findById(id: string, merchantId: string): Promise<ShippingQuoteEntity | null> {
    const q = this.store.get(id);
    if (!q || q.merchant_id !== merchantId) return null;
    return q;
  }

  async findBySession(sessionId: string, merchantId: string): Promise<ShippingQuoteEntity | null> {
    for (const q of this.store.values()) {
      if (q.snapshot().session_id === sessionId && q.merchant_id === merchantId) return q;
    }
    return null;
  }
}
