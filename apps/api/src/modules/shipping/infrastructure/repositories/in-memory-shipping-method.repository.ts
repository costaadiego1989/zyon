import { Injectable } from "@nestjs/common";
import { ShippingMethodEntity } from "../../domain/entities/shipping-method.entity.js";
import type { ShippingMethodRepository } from "../../domain/ports/shipping-method-repository.port.js";

@Injectable()
export class InMemoryShippingMethodRepository implements ShippingMethodRepository {
  private readonly store = new Map<string, ShippingMethodEntity>();

  async save(method: ShippingMethodEntity): Promise<void> {
    this.store.set(`${method.merchant_id}::${method.carrier_key}`, method);
  }

  async findByCarrierKey(merchantId: string, carrierKey: string): Promise<ShippingMethodEntity | null> {
    return this.store.get(`${merchantId}::${carrierKey}`) ?? null;
  }

  async findAllByMerchant(merchantId: string): Promise<ShippingMethodEntity[]> {
    return [...this.store.values()].filter((m) => m.merchant_id === merchantId);
  }
}
