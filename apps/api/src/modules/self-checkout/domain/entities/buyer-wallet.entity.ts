import { randomUUID } from "crypto";
import { BuyerSavedAddressEntity, type BuyerSavedAddressSnapshot } from "./buyer-saved-address.entity.js";
import { BuyerSavedPaymentMethodEntity, type BuyerSavedPaymentMethodSnapshot } from "./buyer-saved-payment-method.entity.js";

export interface BuyerWalletSnapshot {
  id: string;
  buyer_user_id: string;
  saved_addresses: BuyerSavedAddressSnapshot[];
  saved_payment_methods: BuyerSavedPaymentMethodSnapshot[];
}

export class BuyerWalletEntity {
  private constructor(private readonly data: BuyerWalletSnapshot) {}

  static create(buyer_user_id: string): BuyerWalletEntity {
    return new BuyerWalletEntity({ id: randomUUID(), buyer_user_id, saved_addresses: [], saved_payment_methods: [] });
  }

  static rehydrate(data: BuyerWalletSnapshot): BuyerWalletEntity {
    return new BuyerWalletEntity(data);
  }

  get id() { return this.data.id; }
  get buyer_user_id() { return this.data.buyer_user_id; }

  get saved_addresses(): BuyerSavedAddressEntity[] {
    return this.data.saved_addresses.map(BuyerSavedAddressEntity.rehydrate);
  }

  get saved_payment_methods(): BuyerSavedPaymentMethodEntity[] {
    return this.data.saved_payment_methods.map(BuyerSavedPaymentMethodEntity.rehydrate);
  }

  addAddress(input: Omit<BuyerSavedAddressSnapshot, "id" | "wallet_id">): BuyerWalletEntity {
    const address = BuyerSavedAddressEntity.create({ ...input, wallet_id: this.data.id });
    return new BuyerWalletEntity({ ...this.data, saved_addresses: [...this.data.saved_addresses, address.snapshot()] });
  }

  removeAddress(address_id: string): BuyerWalletEntity {
    return new BuyerWalletEntity({ ...this.data, saved_addresses: this.data.saved_addresses.filter((a) => a.id !== address_id) });
  }

  addPaymentMethod(input: Omit<BuyerSavedPaymentMethodSnapshot, "id" | "wallet_id">): { wallet: BuyerWalletEntity; method: BuyerSavedPaymentMethodEntity } {
    const method = BuyerSavedPaymentMethodEntity.create({ ...input, wallet_id: this.data.id });
    const wallet = new BuyerWalletEntity({ ...this.data, saved_payment_methods: [...this.data.saved_payment_methods, method.snapshot()] });
    return { wallet, method };
  }

  removePaymentMethod(method_id: string): BuyerWalletEntity {
    return new BuyerWalletEntity({ ...this.data, saved_payment_methods: this.data.saved_payment_methods.filter((m) => m.id !== method_id) });
  }

  snapshot(): BuyerWalletSnapshot {
    return { ...this.data, saved_addresses: [...this.data.saved_addresses], saved_payment_methods: [...this.data.saved_payment_methods] };
  }
}
