import { randomUUID } from "crypto";

export interface BuyerSavedPaymentMethodSnapshot {
  id: string;
  wallet_id: string;
  label: string;
  gateway: "asaas";
  gateway_token: string;
  last_four: string;
  brand: string;
  expires_at: Date;
  is_default: boolean;
}

export class BuyerSavedPaymentMethodEntity {
  private constructor(private readonly data: BuyerSavedPaymentMethodSnapshot) {}

  static create(input: Omit<BuyerSavedPaymentMethodSnapshot, "id">): BuyerSavedPaymentMethodEntity {
    return new BuyerSavedPaymentMethodEntity({ id: randomUUID(), ...input });
  }

  static rehydrate(data: BuyerSavedPaymentMethodSnapshot): BuyerSavedPaymentMethodEntity {
    return new BuyerSavedPaymentMethodEntity(data);
  }

  get id() { return this.data.id; }
  get wallet_id() { return this.data.wallet_id; }
  get label() { return this.data.label; }
  get gateway() { return this.data.gateway; }
  get gateway_token() { return this.data.gateway_token; }
  get last_four() { return this.data.last_four; }
  get brand() { return this.data.brand; }
  get expires_at() { return this.data.expires_at; }
  get is_default() { return this.data.is_default; }

  setDefault(value: boolean): BuyerSavedPaymentMethodEntity {
    return new BuyerSavedPaymentMethodEntity({ ...this.data, is_default: value });
  }

  snapshot(): BuyerSavedPaymentMethodSnapshot {
    return { ...this.data };
  }
}
