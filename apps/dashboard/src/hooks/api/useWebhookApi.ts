import { useApi } from "../useApi.js";

/**
 * Domain-scoped hook for webhook management operations.
 *
 * Use this hook when your page creates, updates, tests, or monitors webhook endpoints and deliveries.
 * It exposes commonly-used webhook methods without the full API surface.
 *
 * For webhook operations not listed here, fall back to `useApi()` and access `api.methodName()`.
 *
 * @example
 * const webhooks = useWebhookApi();
 * const endpoints = await webhooks.getWebhookEndpoints();
 * const delivery = await webhooks.testWebhookEndpoint(endpointId);
 */
export function useWebhookApi() {
  const api = useApi();
  return {
    getWebhookEndpoints: api.getWebhookEndpoints,
    createWebhookEndpoint: api.createWebhookEndpoint,
    updateWebhookEndpoint: api.updateWebhookEndpoint,
    testWebhookEndpoint: api.testWebhookEndpoint,
    getWebhookDeliveries: api.getWebhookDeliveries,
    replayWebhookDelivery: api.replayWebhookDelivery,
  };
}
