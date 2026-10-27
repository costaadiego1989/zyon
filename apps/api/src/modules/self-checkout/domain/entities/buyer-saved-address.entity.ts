import { randomUUID } from "crypto";

export interface BuyerSavedAddressSnapshot {
  id: string;
  wallet_id: string;
  label: string;
  zip_code: string;
  street: string;
  city: string;
  state: string;
  country: string;
  is_default: boolean;
}

export class BuyerSavedAddressEntity {
  private constructor(private readonly data: BuyerSavedAddressSnapshot) {}

  static create(input: Omit<BuyerSavedAddressSnapshot, "id">): BuyerSavedAddressEntity {
    return new BuyerSavedAddressEntity({ id: randomUUID(), ...input });
  }

  static rehydrate(data: BuyerSavedAddressSnapshot): BuyerSavedAddressEntity {
    return new BuyerSavedAddressEntity(data);
  }

  get id() { return this.data.id; }
  get wallet_id() { return this.data.wallet_id; }
  get label() { return this.data.label; }
  get zip_code() { return this.data.zip_code; }
  get street() { return this.data.street; }
  get city() { return this.data.city; }
  get state() { return this.data.state; }
  get country() { return this.data.country; }
  get is_default() { return this.data.is_default; }

  setDefault(value: boolean): BuyerSavedAddressEntity {
    return new BuyerSavedAddressEntity({ ...this.data, is_default: value });
  }

  snapshot(): BuyerSavedAddressSnapshot {
    return { ...this.data };
  }
}
