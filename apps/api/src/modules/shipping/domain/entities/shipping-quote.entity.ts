import { randomUUID } from "node:crypto";
import { computeQuoteExpiry, isQuoteExpired } from "@aacp/shipping-engine";
import type { DomainEventEnvelope } from "@aacp/shared-types";
import { createShippingEventEnvelope } from "../events/shipping-domain-event.js";

export type ShippingQuoteResult = {
  carrier_key: string;
  label: string;
  price: number;
  eta_days: number;
  is_free: boolean;
};

export type ShippingQuoteSnapshot = {
  id: string;
  session_id: string;
  merchant_id: string;
  destination_zip: string;
  quote_key: string;
  results: ShippingQuoteResult[];
  selected_carrier_key: string | null;
  created_at: string;
  expires_at: string;
};

export class ShippingQuoteEntity {
  private readonly events: DomainEventEnvelope[] = [];

  private constructor(private readonly s: ShippingQuoteSnapshot) {}

  static create(input: {
    session_id: string;
    merchant_id: string;
    destination_zip: string;
    quote_key?: string;
    ttl_seconds?: number;
    created_at?: Date;
  }): ShippingQuoteEntity {
    const createdAt = input.created_at ?? new Date();
    return new ShippingQuoteEntity({
      id: randomUUID(),
      session_id: input.session_id,
      merchant_id: input.merchant_id,
      destination_zip: input.destination_zip,
      quote_key: input.quote_key ?? "",
      results: [],
      selected_carrier_key: null,
      created_at: createdAt.toISOString(),
      expires_at: computeQuoteExpiry(createdAt, input.ttl_seconds).toISOString()
    });
  }

  static rehydrate(s: ShippingQuoteSnapshot): ShippingQuoteEntity {
    return new ShippingQuoteEntity(s);
  }

  addResults(results: ShippingQuoteResult[]): ShippingQuoteEntity {
    return new ShippingQuoteEntity({ ...this.s, results: [...this.s.results, ...results] });
  }

  recordCreated(): this {
    this.events.push(
      createShippingEventEnvelope({
        eventType: "shipping.quote.created",
        merchantId: this.s.merchant_id,
        causationId: this.s.id,
        payload: {
          quote_id: this.s.id,
          session_id: this.s.session_id,
          destination_zip: this.s.destination_zip,
          quote_key: this.s.quote_key,
          option_count: this.s.results.length,
          expires_at: this.s.expires_at
        }
      })
    );
    return this;
  }

  selectCarrier(carrierKey: string, now: Date = new Date()): ShippingQuoteEntity {
    if (this.isExpired(now)) throw new Error("shipping_quote_expired");
    const found = this.s.results.find((r) => r.carrier_key === carrierKey);
    if (!found) throw new Error("shipping_carrier_not_in_quote");
    const next = new ShippingQuoteEntity({ ...this.s, selected_carrier_key: carrierKey });
    next.events.push(
      createShippingEventEnvelope({
        eventType: "shipping.method.selected",
        merchantId: this.s.merchant_id,
        causationId: this.s.id,
        payload: {
          quote_id: this.s.id,
          session_id: this.s.session_id,
          carrier_key: carrierKey,
          price: found.price,
          is_free: found.is_free
        }
      })
    );
    return next;
  }

  isExpired(now: Date = new Date()): boolean {
    return isQuoteExpired(new Date(this.s.expires_at), now);
  }

  pullEvents(): DomainEventEnvelope[] {
    const drained = [...this.events];
    this.events.length = 0;
    return drained;
  }

  snapshot(): ShippingQuoteSnapshot {
    return { ...this.s, results: [...this.s.results] };
  }

  get id(): string {
    return this.s.id;
  }

  get merchant_id(): string {
    return this.s.merchant_id;
  }

  get quote_key(): string {
    return this.s.quote_key;
  }
}
