import { randomUUID } from "node:crypto";

export type ShippingMethodSnapshot = {
  id: string;
  merchant_id: string;
  carrier_key: string;
  label: string;
  estimated_days_min: number;
  estimated_days_max: number;
  is_active: boolean;
  config: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export class ShippingMethodEntity {
  private constructor(private readonly s: ShippingMethodSnapshot) {}

  static create(input: Omit<ShippingMethodSnapshot, "id" | "created_at" | "updated_at">): ShippingMethodEntity {
    const now = new Date().toISOString();
    return new ShippingMethodEntity({ ...input, id: randomUUID(), created_at: now, updated_at: now });
  }

  static rehydrate(s: ShippingMethodSnapshot): ShippingMethodEntity {
    return new ShippingMethodEntity(s);
  }

  update(patch: Partial<Pick<ShippingMethodSnapshot, "label" | "estimated_days_min" | "estimated_days_max" | "is_active" | "config">>): ShippingMethodEntity {
    return new ShippingMethodEntity({ ...this.s, ...patch, updated_at: new Date().toISOString() });
  }

  snapshot(): ShippingMethodSnapshot { return { ...this.s }; }
  get id(): string { return this.s.id; }
  get merchant_id(): string { return this.s.merchant_id; }
  get carrier_key(): string { return this.s.carrier_key; }
}
