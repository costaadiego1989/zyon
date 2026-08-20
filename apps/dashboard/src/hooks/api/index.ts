/**
 * Domain-scoped API hooks.
 *
 * These hooks allow pages to declare exact API dependencies instead of consuming the entire API surface.
 * Each hook returns a subset of methods relevant to its domain.
 *
 * Use domain-specific hooks when possible; fall back to useApi() only for operations not exposed here.
 */

export { useCatalogApi } from "./useCatalogApi.js";
export { useBillingApi } from "./useBillingApi.js";
export { useCheckoutApi } from "./useCheckoutApi.js";
export { useMerchantApi } from "./useMerchantApi.js";
export { useOrdersApi } from "./useOrdersApi.js";
export { useWebhookApi } from "./useWebhookApi.js";
export { useMarketplaceApi } from "./useMarketplaceApi.js";
