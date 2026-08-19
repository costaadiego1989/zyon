/**
 * Dashboard API client factory and type exports.
 * Composes HTTP layer + endpoint groups into a single API object.
 * This module maintains full backward compatibility with the original api-client.ts.
 */

import { authEndpoints } from "./endpoints/auth.js";
import { merchantEndpoints } from "./endpoints/merchants.js";
import { checkoutSettingsEndpoints } from "./endpoints/checkout-settings.js";
import { supportEndpoints } from "./endpoints/support.js";
import { otherEndpoints } from "./endpoints/other.js";
import { catalogEndpoints } from "./endpoints/catalog.js";
import { experimentsEndpoints } from "./endpoints/experiments.js";
import { marketplaceEndpoints } from "./endpoints/marketplace-v2.js";

export * from "./http/index.js";
export * from "./types.js";
export * from "./endpoints/catalog.js";
export {
  mapWebhookEndpoint,
  mapWebhookDelivery,
  type WebhookEndpointApi,
  type WebhookDeliveryApi,
} from "./adapters/webhook-mappers.js";

/**
 * Create and return a complete dashboard API client.
 * Merges all endpoint groups (auth, merchants, checkout, support, etc.) into one object.
 */
export function createDashboardApi(options: {
  baseUrl: string;
  fetchImpl?: typeof fetch;
}) {
  const base = options.baseUrl.trimEnd().replace(/\/+$/, "");
  const f = options.fetchImpl ?? globalThis.fetch;

  return {
    ...authEndpoints(base, f),
    ...merchantEndpoints(base, f),
    ...checkoutSettingsEndpoints(base, f),
    ...supportEndpoints(base, f),
    ...otherEndpoints(base, f),
    ...catalogEndpoints(base, f),
    ...experimentsEndpoints(base, f),
    ...marketplaceEndpoints(base, f),
  };
}
