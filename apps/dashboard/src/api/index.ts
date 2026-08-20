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
import { webhookEndpoints } from "./endpoints/webhook.js";
import { orderEndpoints } from "./endpoints/order.js";
import {
  customerEndpoints,
  paymentEndpoints,
} from "./endpoints/customer.js";
import { billingEndpoints } from "./endpoints/billing.js";
import { onboardingEndpoints } from "./endpoints/onboarding.js";
import { agentEndpoints } from "./endpoints/agent.js";
import { negotiationEndpoints } from "./endpoints/negotiation.js";
import { auditEndpoints } from "./endpoints/audit.js";
import { funnelEndpoints } from "./endpoints/funnel.js";
import {
  integrationEndpoints,
  commerceEndpoints,
  installationEndpoints,
} from "./endpoints/integration.js";
import { revenueLiftEndpoints } from "./endpoints/revenue-lift.js";
import { revenueManagerEndpoints } from "./endpoints/revenue-manager.js";
import { cartRecoveryEndpoints } from "./endpoints/cart-recovery.js";

export * from "./http/index.js";
export * from "./types.js";
export * from "./endpoints/catalog.js";
export * from "./endpoints/marketplace-v2.js";
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
    ...webhookEndpoints(base, f),
    ...orderEndpoints(base, f),
    ...customerEndpoints(base, f),
    ...paymentEndpoints(base, f),
    ...billingEndpoints(base, f),
    ...onboardingEndpoints(base, f),
    ...agentEndpoints(base, f),
    ...negotiationEndpoints(base, f),
    ...auditEndpoints(base, f),
    ...integrationEndpoints(base, f),
    ...commerceEndpoints(base, f),
    ...installationEndpoints(base, f),
    ...catalogEndpoints(base, f),
    ...experimentsEndpoints(base, f),
    ...marketplaceEndpoints(base, f),
    ...funnelEndpoints(base, f),
    ...revenueLiftEndpoints(base, f),
    ...revenueManagerEndpoints(base, f),
    ...cartRecoveryEndpoints(base, f),
    ...otherEndpoints(base, f),
  };
}
