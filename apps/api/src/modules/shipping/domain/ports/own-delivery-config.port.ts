export interface OwnDeliveryNeighborhood {
  name: string;
  priceCents: number;
}

export interface OwnDeliveryConfig {
  id: string;
  merchantId: string;
  enabled: boolean;
  mode: "flat" | "neighborhood";
  flatPriceCents: number | null;
  freeAboveCents: number | null;
  neighborhoods: OwnDeliveryNeighborhood[] | null;
  estimatedDays: number;
}

export interface OwnDeliveryConfigRepository {
  getByMerchantId(merchantId: string): Promise<OwnDeliveryConfig | null>;
  save(config: OwnDeliveryConfig): Promise<OwnDeliveryConfig>;
}

export const OWN_DELIVERY_CONFIG_REPOSITORY = Symbol("OWN_DELIVERY_CONFIG_REPOSITORY");
