import { randomUUID } from "node:crypto";

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
  results: ShippingQuoteResult[];
  selected_carrier_key: string | null;
  created_at: string;
};

export class ShippingQuoteEntity {
  private constructor(private readonly s: ShippingQuoteSnapshot) {}

  static create(input: { session_id: string; merchant_id: string; destination_zip: string }): ShippingQuoteEntity {
    return new ShippingQuoteEntity({
      id: randomUUID(),
      session_id: input.session_id,
      merchant_id: input.merchant_id,
      destination_zip: input.destination_zip,
      results: [],
      selected_carrier_key: null,
      created_at: new Date().toISOString()
    });
  }

  static rehydrate(s: ShippingQuoteSnapshot): ShippingQuoteEntity {
    return new ShippingQuoteEntity(s);
  }

  addResults(results: ShippingQuoteResult[]): ShippingQuoteEntity {
    return new ShippingQuoteEntity({ ...this.s, results: [...this.s.results, ...results] });
  }

  selectCarrier(carrierKey: string): ShippingQuoteEntity {
    const found = this.s.results.find((r) => r.carrier_key === carrierKey);
    if (!found) throw new Error("shipping_carrier_not_in_quote");
    return new ShippingQuoteEntity({ ...this.s, selected_carrier_key: carrierKey });
  }

  snapshot(): ShippingQuoteSnapshot { return { ...this.s, results: [...this.s.results] }; }
  get id(): string { return this.s.id; }
  get merchant_id(): string { return this.s.merchant_id; }
}
