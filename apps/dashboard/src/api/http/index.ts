/**
 * Re-export all HTTP-layer primitives from a single barrel.
 */
export { normalizeApiBase, mergeUrl } from "./url.js";
export { DashboardHttpError } from "./error.js";
export { dashboardFetch, dashboardJson, SESSION_EXPIRED_EVENT } from "./client.js";
export { createIdempotencyKey, stableIdempotencyKey } from "./idempotency.js";
