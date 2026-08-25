import { dashboardJson } from "../http/client.js";

export interface OwnDeliveryConfig {
  enabled: boolean;
  mode: "fixed" | "by_neighborhood";
  flatPriceCents: number;
  freeAboveCents: number | null;
  estimatedDays: number;
  neighborhoods: Array<{ name: string; priceCents: number }>;
}

export interface DeliveryConfig {
  melhorEnvioEnabled: boolean;
  melhorEnvioConnected: boolean;
  melhorEnvioExpiresAt: string | null;
  originZip: string;
  ownDelivery: OwnDeliveryConfig;
}

export interface Shipment {
  id: string;
  orderId: string;
  carrier: string;
  trackingCode: string | null;
  status: "created" | "sent" | "in_transit" | "delivered";
  labelUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ShipmentsPage {
  items: Shipment[];
  total: number;
  limit: number;
  offset: number;
}

export function deliveryEndpoints(base: string, f: typeof fetch) {
  return {
    async getDeliveryConfig(): Promise<DeliveryConfig> {
      return dashboardJson<DeliveryConfig>(
        base,
        `/merchants/me/delivery/config`,
        { method: "GET" },
        f
      );
    },

    async updateDeliveryConfig(payload: Partial<DeliveryConfig>): Promise<DeliveryConfig> {
      return dashboardJson<DeliveryConfig>(
        base,
        `/merchants/me/delivery/config`,
        { method: "PUT", jsonBody: payload },
        f
      );
    },

    async getShipments(status?: string, limit?: number, offset?: number): Promise<ShipmentsPage> {
      const params = new URLSearchParams();
      if (status) params.set("status", status);
      if (limit) params.set("limit", String(limit));
      if (offset) params.set("offset", String(offset));
      const query = params.toString() ? `?${params.toString()}` : "";
      return dashboardJson<ShipmentsPage>(
        base,
        `/merchants/me/shipments${query}`,
        { method: "GET" },
        f
      );
    },

    async buyShippingLabel(shipmentId: string): Promise<{ labelUrl: string }> {
      return dashboardJson<{ labelUrl: string }>(
        base,
        `/merchants/me/shipments/${encodeURIComponent(shipmentId)}/label`,
        { method: "POST" },
        f
      );
    },

    getMelhorEnvioAuthorizeUrl(): string {
      return `${base}/shipping/melhor-envio/authorize`;
    },
  };
}
