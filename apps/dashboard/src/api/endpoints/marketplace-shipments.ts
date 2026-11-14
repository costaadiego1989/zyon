import { dashboardJson, SESSION_EXPIRED_EVENT } from "../http/client.js";
import { DashboardHttpError } from "../http/error.js";
import { mergeUrl } from "../http/url.js";

export const CARRIER_ORDER_UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
export type ShipmentRecoveryState = "required" | "in_flight" | "confirmed" | "not_applicable";
export type ShipmentState = "prepared" | "cart_unknown" | "cart_created" | "purchase_unknown" | "purchased" | "generate_unknown" | "generated" | "blocked";
export type ShipmentRecovery = {
  shipment_id: string; origin_merchant_id: string; reference: string; status: ShipmentState;
  carrier_order_id: string | null; recovery_status: ShipmentRecoveryState;
};
export type DashboardMarketplaceShipment = ShipmentRecovery & {
  payment_intent_id: string; origin_name: string; created_at: string; can_recover: boolean; can_print: boolean;
  volume_index: number; volume_count: number;
};
export type MarketplaceShipmentPrivateLabel = {
  shipmentId: string; originMerchantId: string; carrierOrderId: string; mode: "private"; requiresCarrierLogin: true; url: string;
};
export type MarketplaceShipmentPage = { shipments: DashboardMarketplaceShipment[]; next_cursor: string | null };
const root = "/marketplace/dashboard/shipments";
const validId = (value: unknown) => typeof value === "string" && /^[A-Za-z0-9_-]{1,200}$/.test(value);
function validRecovery(row: ShipmentRecovery): boolean {
  return !!row && validId(row.shipment_id) && validId(row.origin_merchant_id) && typeof row.reference === "string" && /^mship_[a-f0-9]{64}$/.test(row.reference) &&
    ["prepared", "cart_unknown", "cart_created", "purchase_unknown", "purchased", "generate_unknown", "generated", "blocked"].includes(row.status) &&
    ["required", "in_flight", "confirmed", "not_applicable"].includes(row.recovery_status) &&
    (row.carrier_order_id === null || (typeof row.carrier_order_id === "string" && CARRIER_ORDER_UUID.test(row.carrier_order_id))) &&
    (row.recovery_status !== "confirmed" || row.carrier_order_id !== null);
}
function requireRecovery(row: ShipmentRecovery, id: string): ShipmentRecovery {
  if (!validRecovery(row) || row.shipment_id !== id) throw new Error("invalid_marketplace_shipment_response");
  return row;
}

export function marketplaceShipmentEndpoints(base: string, fetchImpl: typeof fetch) {
  return {
    async listMarketplaceShipments(cursor?: string): Promise<MarketplaceShipmentPage> {
      const result = await dashboardJson<MarketplaceShipmentPage>(base, `${root}?limit=20${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`, { method: "GET", cache: "no-store" }, fetchImpl);
      if (!result || !Array.isArray(result.shipments) || result.shipments.length > 20 || (result.next_cursor !== null && !validId(result.next_cursor)) ||
        result.shipments.some(row => !validRecovery(row) || !validId(row.payment_intent_id) || typeof row.origin_name !== "string" || !row.origin_name.trim() ||
          !Number.isFinite(Date.parse(row.created_at)) || typeof row.can_recover !== "boolean" || (row.can_recover && row.recovery_status !== "required") ||
          typeof row.can_print !== "boolean" || (row.can_print && (row.status !== "generated" || !row.carrier_order_id)) ||
          !Number.isSafeInteger(row.volume_count) || row.volume_count < 1 || row.volume_count > 100 ||
          !Number.isSafeInteger(row.volume_index) || row.volume_index < 0 || row.volume_index >= row.volume_count)) {
        throw new Error("invalid_marketplace_shipment_list");
      }
      return result;
    },
    async getMarketplaceShipmentRecovery(id: string): Promise<ShipmentRecovery> {
      return requireRecovery(await dashboardJson(base, `${root}/${encodeURIComponent(id)}/recovery`, { method: "GET", cache: "no-store" }, fetchImpl), id);
    },
    async getMarketplaceShipmentPrintLink(row: DashboardMarketplaceShipment): Promise<MarketplaceShipmentPrivateLabel> {
      if (!validId(row.shipment_id) || !row.can_print || row.status !== "generated" || !row.carrier_order_id) throw new Error("invalid_marketplace_shipment_print_request");
      const response = await fetchImpl(mergeUrl(base, `${root}/${encodeURIComponent(row.shipment_id)}/print-link`), {
        method: "POST", credentials: "include", cache: "no-store", headers: { "Content-Type": "application/json" }, body: "{}",
      });
      if (response.status === 401) window.dispatchEvent(new CustomEvent(SESSION_EXPIRED_EVENT));
      if (!response.ok) throw new DashboardHttpError(response.status, "marketplace_shipment_print_unavailable");
      const result = await response.json() as MarketplaceShipmentPrivateLabel;
      if (!result || result.shipmentId !== row.shipment_id || result.originMerchantId !== row.origin_merchant_id ||
          result.carrierOrderId !== row.carrier_order_id || result.mode !== "private" || result.requiresCarrierLogin !== true ||
          typeof result.url !== "string" || result.url.length > 4096 || /[\u0000-\u0020\u007f\\]/.test(result.url)) throw new Error("invalid_marketplace_shipment_print_response");
      const url = new URL(result.url);
      if (url.protocol !== "https:" || !["melhorenvio.com.br", "sandbox.melhorenvio.com.br"].includes(url.hostname) ||
          url.port || url.username || url.password || url.hash || !/^\/imprimir\/[A-Za-z0-9_-]{1,256}$/.test(url.pathname)) throw new Error("invalid_marketplace_shipment_print_response");
      return result;
    },
    async recoverMarketplaceShipment(id: string, carrierOrderId: string): Promise<ShipmentRecovery> {
      if (!validId(id) || !CARRIER_ORDER_UUID.test(carrierOrderId)) throw new Error("invalid_marketplace_shipment_request");
      // No transport or auth-refresh retry for explicit operator commands.
      const response = await fetchImpl(mergeUrl(base, `${root}/${encodeURIComponent(id)}/recover-cart`), {
        method: "POST", credentials: "include", cache: "no-store", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ carrierOrderId: carrierOrderId.toLowerCase() }),
      });
      if (response.status === 401) window.dispatchEvent(new CustomEvent(SESSION_EXPIRED_EVENT));
      if (!response.ok) throw new DashboardHttpError(response.status, "marketplace_shipment_recovery_unavailable");
      const result = requireRecovery(await response.json(), id);
      if (result.recovery_status === "confirmed" && result.carrier_order_id?.toLowerCase() !== carrierOrderId.toLowerCase()) throw new Error("invalid_marketplace_shipment_receipt");
      return result;
    },
  };
}
