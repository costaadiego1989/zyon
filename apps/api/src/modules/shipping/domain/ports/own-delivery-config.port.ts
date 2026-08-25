export interface OwnDeliveryNeighborhood {
  name: string;
  priceCents: number;
}

export type EstimatedUnit = "minutes" | "days";

export interface OwnDeliveryConfig {
  id: string;
  merchantId: string;
  enabled: boolean;
  mode: "flat" | "neighborhood";
  flatPriceCents: number | null;
  freeAboveCents: number | null;
  neighborhoods: OwnDeliveryNeighborhood[] | null;
  estimatedValue: number;
  estimatedUnit: EstimatedUnit;
}

export interface OwnDeliveryConfigRepository {
  getByMerchantId(merchantId: string): Promise<OwnDeliveryConfig | null>;
  save(config: OwnDeliveryConfig): Promise<OwnDeliveryConfig>;
}

export const OWN_DELIVERY_CONFIG_REPOSITORY = Symbol("OWN_DELIVERY_CONFIG_REPOSITORY");
