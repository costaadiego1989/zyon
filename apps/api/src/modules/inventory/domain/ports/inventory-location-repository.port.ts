export const INVENTORY_LOCATION_REPOSITORY = Symbol("INVENTORY_LOCATION_REPOSITORY");

export interface LocationRow {
  id: string;
  merchantId: string;
  name: string;
  kind: string;
  isDefault: boolean;
  isActive: boolean;
}

export interface InventoryLocationRepositoryPort {
  list(merchantId: string): Promise<LocationRow[]>;
  create(merchantId: string, data: { name: string; kind?: string; isDefault?: boolean }): Promise<LocationRow>;
  update(
    merchantId: string,
    id: string,
    data: { name?: string; kind?: string; isActive?: boolean },
  ): Promise<LocationRow>;
  getDefault(merchantId: string): Promise<LocationRow | null>;
}
