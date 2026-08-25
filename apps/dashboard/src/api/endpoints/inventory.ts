import { dashboardJson } from "../http/client.js";

export interface InventorySummaryDTO {
  totalSkus: number;
  lowStockCount: number;
  outOfStockCount: number;
  totalValueCents: number;
}

export interface InventoryItemDTO {
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
  createdAt: string;
  updatedAt: string;
}

export interface InventoryMovementDTO {
  id: string;
  merchantId: string;
  itemId: string;
  sku?: string;
  productName?: string;
  kind: string;
  quantity: number;
  reason: string | null;
  externalRef: string | null;
  source: string;
  actorUserId: string | null;
  createdAt: string;
}

export interface InventoryAlertDTO {
  id: string;
  merchantId: string;
  itemId: string;
  sku?: string;
  productName?: string;
  severity: string;
  message: string;
  acknowledged: boolean;
  createdAt: string;
  acknowledgedAt: string | null;
}

export interface InventoryLocationDTO {
  id: string;
  merchantId: string;
  name: string;
  kind: string;
  isDefault: boolean;
  isActive: boolean;
}

export interface ErpConnectionDTO {
  id: string;
  merchantId: string;
  provider: "bling" | "tiny" | "omie";
  status: "connected" | "disconnected" | "error";
  lastSyncAt: string | null;
  directionMode: "push" | "pull" | "bidirectional";
  createdAt: string;
}

export function inventoryEndpoints(base: string, f: typeof fetch) {
  return {
    getInventorySummary(merchantId: string): Promise<InventorySummaryDTO> {
      return dashboardJson<InventorySummaryDTO>(
        base,
        `/dashboard/inventory/summary`,
        { method: "GET" },
        f,
      );
    },

    listInventoryItems(
      merchantId: string,
      opts?: { status?: string; locationId?: string; search?: string; page?: number; pageSize?: number },
    ): Promise<{ items: InventoryItemDTO[]; total: number }> {
      return dashboardJson<{ items: InventoryItemDTO[]; total: number }>(
        base,
        `/dashboard/inventory/items`,
        { method: "POST", jsonBody: opts ?? {} },
        f,
      );
    },

    recordMovement(
      merchantId: string,
      itemId: string,
      data: { kind: string; quantity: number; reason?: string; externalRef?: string },
    ): Promise<InventoryItemDTO> {
      return dashboardJson<InventoryItemDTO>(
        base,
        `/dashboard/inventory/items/${encodeURIComponent(itemId)}/movements`,
        { method: "POST", jsonBody: data },
        f,
      );
    },

    transferStock(
      merchantId: string,
      data: { itemId: string; quantity: number; fromLocationId: string; toLocationId: string; reason?: string },
    ): Promise<InventoryItemDTO> {
      return dashboardJson<InventoryItemDTO>(
        base,
        `/dashboard/inventory/items/transfer`,
        { method: "POST", jsonBody: data },
        f,
      );
    },

    listMovements(
      merchantId: string,
      opts?: { itemId?: string; kind?: string; from?: string; to?: string; page?: number; pageSize?: number },
    ): Promise<{ movements: InventoryMovementDTO[]; total: number }> {
      return dashboardJson<{ movements: InventoryMovementDTO[]; total: number }>(
        base,
        `/dashboard/inventory/movements`,
        { method: "POST", jsonBody: opts ?? {} },
        f,
      );
    },

    listAlerts(
      merchantId: string,
      acknowledged?: boolean,
    ): Promise<InventoryAlertDTO[]> {
      return dashboardJson<InventoryAlertDTO[]>(
        base,
        `/dashboard/inventory/alerts`,
        { method: "POST", jsonBody: acknowledged !== undefined ? { acknowledged } : {} },
        f,
      );
    },

    acknowledgeAlert(merchantId: string, alertId: string): Promise<void> {
      return dashboardJson<void>(
        base,
        `/dashboard/inventory/alerts/${encodeURIComponent(alertId)}/acknowledge`,
        { method: "POST" },
        f,
      );
    },

    listLocations(merchantId: string): Promise<InventoryLocationDTO[]> {
      return dashboardJson<InventoryLocationDTO[]>(
        base,
        `/dashboard/inventory/locations`,
        { method: "GET" },
        f,
      );
    },

    createLocation(
      merchantId: string,
      data: { name: string; kind?: string; isDefault?: boolean },
    ): Promise<InventoryLocationDTO> {
      return dashboardJson<InventoryLocationDTO>(
        base,
        `/dashboard/inventory/locations`,
        { method: "POST", jsonBody: data },
        f,
      );
    },

    // --- ERP Connections ---

    getErpConnections(merchantId: string): Promise<ErpConnectionDTO[]> {
      return dashboardJson<ErpConnectionDTO[]>(
        base,
        `/dashboard/inventory/erp-connections`,
        { method: "GET" },
        f,
      );
    },

    connectErp(
      merchantId: string,
      provider: string,
      credentials?: Record<string, string>,
    ): Promise<ErpConnectionDTO> {
      return dashboardJson<ErpConnectionDTO>(
        base,
        `/dashboard/inventory/erp-connections/${encodeURIComponent(provider)}/connect`,
        { method: "POST", jsonBody: credentials ?? {} },
        f,
      );
    },

    disconnectErp(merchantId: string, connectionId: string): Promise<void> {
      return dashboardJson<void>(
        base,
        `/dashboard/inventory/erp-connections/${encodeURIComponent(connectionId)}/disconnect`,
        { method: "POST" },
        f,
      );
    },

    syncErp(merchantId: string, connectionId: string): Promise<void> {
      return dashboardJson<void>(
        base,
        `/dashboard/inventory/erp-connections/${encodeURIComponent(connectionId)}/sync`,
        { method: "POST" },
        f,
      );
    },
  };
}
