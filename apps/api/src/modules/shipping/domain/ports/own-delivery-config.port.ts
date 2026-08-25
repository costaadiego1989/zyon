export interface OwnDeliveryNeighborhood {
  name: string;
  priceCents: number;
}

// A radius pricing zone: delivery up to `maxKm` costs `priceCents`.
// Zones are ordered ascending by maxKm; the smallest zone that contains the
// distance wins. A zone with maxKm=null means "beyond the last tier" (10+ km).
export interface OwnDeliveryRadiusZone {
  maxKm: number | null;
  priceCents: number;
}

export type EstimatedUnit = "minutes" | "days";

export type OwnDeliveryMode = "flat" | "neighborhood" | "radius";

export interface OwnDeliveryConfig {
  id: string;
  merchantId: string;
  enabled: boolean;
  mode: OwnDeliveryMode;
  flatPriceCents: number | null;
  freeAboveCents: number | null;
  neighborhoods: OwnDeliveryNeighborhood[] | null;
  radiusZones: OwnDeliveryRadiusZone[] | null;
  estimatedValue: number;
  estimatedUnit: EstimatedUnit;
}

export interface OwnDeliveryConfigRepository {
  getByMerchantId(merchantId: string): Promise<OwnDeliveryConfig | null>;
  save(config: OwnDeliveryConfig): Promise<OwnDeliveryConfig>;
}

export const OWN_DELIVERY_CONFIG_REPOSITORY = Symbol("OWN_DELIVERY_CONFIG_REPOSITORY");
