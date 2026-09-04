/**
 * Re-export all HTTP-layer primitives from a single barrel.
 */
export { normalizeApiBase, mergeUrl, resolveDashboardApiBaseUrl } from "./url.js";
export { DashboardHttpError, DashboardJsonParseError } from "./error.js";
export { dashboardFetch, dashboardJson, SESSION_EXPIRED_EVENT } from "./client.js";
export { createIdempotencyKey, stableIdempotencyKey } from "./idempotency.js";
