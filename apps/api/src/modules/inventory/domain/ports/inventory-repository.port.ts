export const INVENTORY_REPOSITORY = Symbol("INVENTORY_REPOSITORY");

export interface InventoryItemRow {
  id: string;
  merchantId: string;
  sku: string;
  productName: string;
  variantName: string | null;
  locationId: string;
  locationName?: string;
  quantity: number;
  reserved: number;
  reorderPoint: number | null;
  lowStockThreshold: number | null;
  avgCostCents: number | null;
  salePriceCents: number | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface InventoryListFilter {
  merchantId: string;
  status?: "in_stock" | "low_stock" | "out_of_stock";
  locationId?: string;
  search?: string;
  page?: number;
  pageSize?: number;
}

export interface InventorySummary {
  totalSkus: number;
  lowStockCount: number;
  outOfStockCount: number;
  totalValueCents: number;
}

export interface InventoryRepositoryPort {
  list(filter: InventoryListFilter): Promise<{ items: InventoryItemRow[]; total: number }>;
  findById(merchantId: string, id: string): Promise<InventoryItemRow | null>;
  findBySku(merchantId: string, sku: string, locationId: string): Promise<InventoryItemRow | null>;
  upsert(
    merchantId: string,
    data: {
      sku: string;
      productName: string;
      variantName?: string;
      locationId: string;
      quantity: number;
      avgCostCents?: number;
      salePriceCents?: number;
    },
  ): Promise<InventoryItemRow>;
  adjustQuantity(merchantId: string, itemId: string, delta: number): Promise<InventoryItemRow>;
  adjustReserved(merchantId: string, itemId: string, delta: number): Promise<InventoryItemRow>;
  setReorderPoint(merchantId: string, itemId: string, point: number): Promise<void>;
  setLowStockThreshold(merchantId: string, itemId: string, threshold: number): Promise<void>;
  getSummary(merchantId: string): Promise<InventorySummary>;
  findItemsBelowThreshold(merchantId: string): Promise<InventoryItemRow[]>;
}
