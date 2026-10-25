import { Inject, Injectable } from "@nestjs/common";
import { ShippingQuoteEntity } from "../../domain/entities/shipping-quote.entity.js";
import type { ShippingQuoteRepository } from "../../domain/ports/shipping-quote-repository.port.js";
import {
  OUTBOX_REPOSITORY,
  type OutboxRepository
} from "../../../../shared/messaging/ports/outbox.repository.port.js";

@Injectable()
export class InMemoryShippingQuoteRepository implements ShippingQuoteRepository {
  private readonly store = new Map<string, ShippingQuoteEntity>();

  constructor(@Inject(OUTBOX_REPOSITORY) private readonly outbox: OutboxRepository) {}

  async saveWithEvents(quote: ShippingQuoteEntity): Promise<void> {
    this.store.set(quote.id, quote);
    for (const event of quote.pullEvents()) {
      await this.outbox.appendOutbox(event);
    }
  }

  async findById(id: string, merchantId: string): Promise<ShippingQuoteEntity | null> {
    const q = this.store.get(id);
    if (!q || q.merchant_id !== merchantId) return null;
    return q;
  }

  async findBySession(sessionId: string, merchantId: string): Promise<ShippingQuoteEntity | null> {
    let latest: ShippingQuoteEntity | null = null;
    for (const q of this.store.values()) {
      const snap = q.snapshot();
      if (snap.session_id !== sessionId || snap.merchant_id !== merchantId) continue;
      if (!latest || snap.created_at > latest.snapshot().created_at) latest = q;
    }
    return latest;
  }

  async findValidByKey(
    quoteKey: string,
    merchantId: string,
    now: Date = new Date()
  ): Promise<ShippingQuoteEntity | null> {
    if (!quoteKey) return null;
    let latest: ShippingQuoteEntity | null = null;
    for (const q of this.store.values()) {
      if (q.merchant_id !== merchantId || q.quote_key !== quoteKey) continue;
      if (q.isExpired(now)) continue;
      if (!latest || q.snapshot().created_at > latest.snapshot().created_at) latest = q;
    }
    return latest;
  }
}
