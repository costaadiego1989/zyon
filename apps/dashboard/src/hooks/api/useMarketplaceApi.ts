import { useApi } from "../useApi.js";

/**
 * Domain-scoped hook for marketplace operations.
 *
 * Use this hook when your page manages marketplace configuration, orders, settlements, debts, chargebacks, or notifications.
 * It exposes commonly-used marketplace methods without the full API surface.
 *
 * For marketplace operations not listed here, fall back to `useApi()` and access `api.methodName()`.
 *
 * @example
 * const marketplace = useMarketplaceApi();
 * const config = await marketplace.getMarketplaceConfig();
 * const settlements = await marketplace.getMarketplaceSettlements();
 */
export function useMarketplaceApi() {
  const api = useApi();
  return {
    getMarketplaceConfig: api.getMarketplaceConfig,
    updateMarketplaceConfig: api.updateMarketplaceConfig,
    getMarketplaceOrders: api.getMarketplaceOrders,
    getMarketplaceStats: api.getMarketplaceStats,
    getMarketplaceSettlements: api.getMarketplaceSettlements,
    getMarketplaceSettlementDetail: api.getMarketplaceSettlementDetail,
    markMarketplaceItemShipped: api.markMarketplaceItemShipped,
    markMarketplaceItemDelivered: api.markMarketplaceItemDelivered,
    getMarketplaceDebts: api.getMarketplaceDebts,
    getMarketplaceDebtDetail: api.getMarketplaceDebtDetail,
    getMarketplaceChargebacks: api.getMarketplaceChargebacks,
    getMarketplaceEvents: api.getMarketplaceEvents,
  };
}
