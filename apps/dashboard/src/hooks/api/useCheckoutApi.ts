import { useApi } from "../useApi.js";

/**
 * Domain-scoped hook for checkout settings operations.
 *
 * Use this hook when your page manages checkout widget configuration, triggers, or suppression rules.
 * It exposes only checkout-settings methods.
 *
 * For other checkout-related operations, fall back to `useApi()` and access `api.methodName()`.
 *
 * @example
 * const checkout = useCheckoutApi();
 * const settings = await checkout.getCheckoutSettings();
 * const updated = await checkout.patchCheckoutSettings({ widget_enabled: true });
 */
export function useCheckoutApi() {
  const api = useApi();
  return {
    getCheckoutSettings: api.getCheckoutSettings,
    patchCheckoutSettings: api.patchCheckoutSettings,
  };
}
