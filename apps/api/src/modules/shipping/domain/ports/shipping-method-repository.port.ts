import type { ShippingMethodEntity } from "../entities/shipping-method.entity.js";

export const SHIPPING_METHOD_REPOSITORY = Symbol("SHIPPING_METHOD_REPOSITORY");

export interface ShippingMethodRepository {
  save(method: ShippingMethodEntity): Promise<void>;
  findByCarrierKey(merchantId: string, carrierKey: string): Promise<ShippingMethodEntity | null>;
  findAllByMerchant(merchantId: string): Promise<ShippingMethodEntity[]>;
}
