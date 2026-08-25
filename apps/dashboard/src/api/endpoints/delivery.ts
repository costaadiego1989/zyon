import { dashboardJson } from "../http/client.js";

export interface RadiusZone {
  maxKm: number | null;
  priceCents: number;
}

export interface OwnDeliveryConfig {
  enabled: boolean;
  mode: "fixed" | "by_neighborhood" | "by_radius";
  flatPriceCents: number;
  freeAboveCents: number | null;
  estimatedValue: number;
  estimatedUnit: "minutes" | "days";
  neighborhoods: Array<{ name: string; priceCents: number }>;
  radiusZones: RadiusZone[];
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
      const raw = await dashboardJson<Record<string, any>>(
        base,
        `/merchants/me/delivery/config`,
        { method: "GET" },
        f
      );
      const od = raw.ownDelivery ?? {};
      return {
        melhorEnvioEnabled: raw.melhorEnvioEnabled ?? false,
        melhorEnvioConnected: raw.melhorEnvioConnected ?? false,
        melhorEnvioExpiresAt: raw.melhorEnvioExpiresAt ?? null,
        originZip: raw.originZip ?? "",
        ownDelivery: {
          enabled: od.enabled ?? false,
          mode: od.mode === "neighborhood" ? "by_neighborhood" : od.mode === "radius" ? "by_radius" : "fixed",
          flatPriceCents: od.flatPriceCents ?? 0,
          freeAboveCents: od.freeAboveCents ?? null,
          estimatedValue: od.estimatedValue ?? 60,
          estimatedUnit: od.estimatedUnit ?? "minutes",
          neighborhoods: od.neighborhoods ?? [],
          radiusZones: od.radiusZones ?? [],
        },
      };
    },

    async updateDeliveryConfig(payload: { melhorEnvioEnabled?: boolean; ownDelivery?: Partial<OwnDeliveryConfig> }): Promise<DeliveryConfig> {
      // Transform camelCase → snake_case; map mode values (fixed→flat, by_neighborhood→neighborhood)
      const body: Record<string, unknown> = {};
      if (payload.melhorEnvioEnabled !== undefined) body.melhor_envio_enabled = payload.melhorEnvioEnabled;
      if (payload.ownDelivery !== undefined) {
        const od = payload.ownDelivery;
        const snake: Record<string, unknown> = { enabled: od.enabled ?? false };
        if (od.mode !== undefined) snake.mode = od.mode === "fixed" ? "flat" : od.mode === "by_neighborhood" ? "neighborhood" : "radius";
        if (od.flatPriceCents !== undefined) snake.flat_price_cents = od.flatPriceCents;
        if (od.freeAboveCents !== undefined) snake.free_above_cents = od.freeAboveCents;
        if (od.neighborhoods !== undefined) snake.neighborhoods = od.neighborhoods;
        if (od.radiusZones !== undefined) snake.radius_zones = od.radiusZones.map(z => ({ max_km: z.maxKm, price_cents: z.priceCents }));
        if (od.estimatedValue !== undefined) snake.estimated_value = od.estimatedValue;
        if (od.estimatedUnit !== undefined) snake.estimated_unit = od.estimatedUnit;
        body.own_delivery = snake;
      }
      return dashboardJson<DeliveryConfig>(
        base,
        `/merchants/me/delivery/config`,
        { method: "PUT", jsonBody: body },
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
