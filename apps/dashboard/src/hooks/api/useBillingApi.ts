import { useApi } from "../useApi.js";

/**
 * Domain-scoped hook for billing and payment operations.
 *
 * Use this hook when your page manages billing subscriptions, payment connections, or onboarding flows.
 * It exposes billing and payment connection methods without exposing the full API surface.
 *
 * For other billing operations not listed here, fall back to `useApi()` and access `api.methodName()`.
 *
 * @example
 * const billing = useBillingApi();
 * const subscription = await billing.getBillingSubscription();
 * const connections = await billing.getPaymentConnections();
 */
export function useBillingApi() {
  const api = useApi();
  return {
    getBillingSubscription: api.getBillingSubscription,
    createBillingCheckoutSession: api.createBillingCheckoutSession,
    createBillingPortalSession: api.createBillingPortalSession,
    getPaymentConnections: api.getPaymentConnections,
    createStripeOnboardingLink: api.createStripeOnboardingLink,
    syncStripeConnection: api.syncStripeConnection,
    connectAsaas: api.connectAsaas,
    createAsaasOnboardingLink: api.createAsaasOnboardingLink,
    syncAsaasConnection: api.syncAsaasConnection,
    createMercadoPagoOAuthLink: api.createMercadoPagoOAuthLink,
    syncMercadoPagoConnection: api.syncMercadoPagoConnection,
    enableCryptoPayments: api.enableCryptoPayments,
  };
}
