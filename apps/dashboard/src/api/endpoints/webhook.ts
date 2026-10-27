import { dashboardJson } from "../http/client.js";
import {
  mapWebhookEndpoint,
  mapWebhookDelivery,
  type WebhookEndpointApi,
  type WebhookDeliveryApi,
} from "../adapters/webhook-mappers.js";
import type {
  WebhookEndpoint,
  WebhookDelivery,
  CursorPage,
} from "../types.js";

export function webhookEndpoints(base: string, f: typeof fetch) {
  return {
    async getWebhookEndpoints(): Promise<WebhookEndpoint[]> {
      const page = await dashboardJson<CursorPage<WebhookEndpointApi>>(
        base,
        "/webhook-endpoints",
        { method: "GET" },
        f,
      );
      return page.data.map(mapWebhookEndpoint);
    },
    async createWebhookEndpoint(payload: { url: string; events?: string[]; enabled?: boolean; description?: string }): Promise<WebhookEndpoint> {
      return mapWebhookEndpoint(
        await dashboardJson<WebhookEndpointApi>(
          base,
          "/webhook-endpoints",
          { method: "POST", jsonBody: payload },
          f,
        ),
      );
    },
    async updateWebhookEndpoint(endpointId: string, payload: { url: string; events?: string[]; enabled?: boolean; description?: string }): Promise<WebhookEndpoint> {
      return mapWebhookEndpoint(
        await dashboardJson<WebhookEndpointApi>(
          base,
          `/webhook-endpoints/${encodeURIComponent(endpointId)}`,
          { method: "PUT", headers: { "If-Match": "*" }, jsonBody: payload },
          f,
        ),
      );
    },
    async testWebhookEndpoint(endpointId: string): Promise<WebhookDelivery> {
      return mapWebhookDelivery(
        await dashboardJson<WebhookDeliveryApi>(
          base,
          `/webhook-endpoints/${encodeURIComponent(endpointId)}/test`,
          { method: "POST" },
          f,
        ),
      );
    },
    async getWebhookDeliveries(limit?: number): Promise<WebhookDelivery[]> {
      const query = limit ? `?limit=${encodeURIComponent(String(limit))}` : "";
      const endpoints = (
        await dashboardJson<CursorPage<WebhookEndpointApi>>(
          base,
          "/webhook-endpoints",
          { method: "GET" },
          f,
        )
      ).data;
      const pages = await Promise.all(
        endpoints.map((endpoint) =>
          dashboardJson<CursorPage<WebhookDeliveryApi>>(
            base,
            `/webhook-endpoints/${encodeURIComponent(endpoint.id)}/deliveries${query}`,
            { method: "GET" },
            f,
          ),
        ),
      );
      return pages
        .flatMap((page) => page.data.map(mapWebhookDelivery))
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
    },
    async replayWebhookDelivery(endpointId: string, deliveryId: string): Promise<WebhookDelivery> {
      return mapWebhookDelivery(
        await dashboardJson<WebhookDeliveryApi>(
          base,
          `/webhook-endpoints/${encodeURIComponent(endpointId)}/deliveries/${encodeURIComponent(deliveryId)}/replay`,
          { method: "POST" },
          f,
        ),
      );
    },
  };
}