import { DashboardHttpError } from "../api-client.js";

/**
 * Shared error formatting utility.
 * Extracts error message, truncates DashboardHttpError response bodies,
 * and converts unknown values to strings.
 * Used by audit-log, billing, integrations, and merchant-rules pages.
 */
export function readError(error: unknown): string {
  return error instanceof DashboardHttpError
    ? error.responseBody.slice(0, 180) || `HTTP ${error.status}`
    : error instanceof Error
      ? error.message
      : String(error);
}
