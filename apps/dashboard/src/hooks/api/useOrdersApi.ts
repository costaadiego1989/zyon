import { useApi } from "../useApi.js";

/**
 * Domain-scoped hook for orders and shipments operations.
 *
 * Use this hook when your page lists, tracks, or manages orders and shipping labels.
 * It exposes commonly-used order and shipping methods without the full API surface.
 *
 * For order operations not listed here, fall back to `useApi()` and access `api.methodName()`.
 *
 * @example
 * const orders = useOrdersApi();
 * const page = await orders.getOrders(50);
 * await orders.updateOrderTracking(orderId, { tracking_code: "ABC123" });
 */
export function useOrdersApi() {
  const api = useApi();
  return {
    getOrders: api.getOrders,
    updateOrderTracking: api.updateOrderTracking,
    updateOrderStatus: api.updateOrderStatus,
    purchaseShippingLabel: api.purchaseShippingLabel,
  };
}
