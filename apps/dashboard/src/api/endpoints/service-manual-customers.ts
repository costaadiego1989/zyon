import { dashboardJson } from "../http/client.js";
import { DashboardJsonParseError } from "../http/error.js";
import type { CursorPage, MerchantProfile, TenantCustomer } from "../types.js";
import type { ServiceReadOptions } from "./service-attendance.js";

const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const id = (value: unknown): value is string => typeof value === "string" && !!value && value.trim() === value && value.length <= 191 && value !== "." && value !== ".." && !/[\x00-\x1f\x7f]/.test(value);
function page(value: unknown): CursorPage<TenantCustomer> {
  const invalid = (): never => { throw new DashboardJsonParseError("invalid_manual_customer_page"); };
  if (!object(value) || !Array.isArray(value.data) || value.data.length > 25 || typeof value.has_more !== "boolean"
    || value.next_cursor !== null && (typeof value.next_cursor !== "string" || !value.next_cursor || value.next_cursor.length > 4096)
    || value.has_more !== (value.next_cursor !== null) || value.has_more && value.data.length === 0) return invalid();
  const seen = new Set<string>(), rows: TenantCustomer[] = [];
  for (const row of value.data) {
    if (!object(row) || !id(row.id) || seen.has(row.id) || !object(row.profile) || typeof row.first_seen_at !== "string"
      || typeof row.last_seen_at !== "string" || !Number.isFinite(Date.parse(row.first_seen_at)) || !Number.isFinite(Date.parse(row.last_seen_at))) return invalid();
    const contact: TenantCustomer["profile"] = {};
    for (const key of ["name", "fullName", "email", "phone"] as const) {
      const value = row.profile[key], max = key === "email" ? 254 : key === "phone" ? 32 : 200;
      if (typeof value === "string" && value.length <= max && !/[\x00-\x1f\x7f]/.test(value)) contact[key] = value;
    }
    seen.add(row.id); rows.push({ id: row.id, profile: contact, first_seen_at: row.first_seen_at, last_seen_at: row.last_seen_at });
  }
  return { data: rows, next_cursor: value.next_cursor as string | null, has_more: value.has_more };
}

/** Existing /customers route. TenantInterceptor validates this captured query
 * after TenantCredentialGuard; server principal still owns customer authority. */
export function serviceManualCustomerEndpoints(base: string, fetchImpl: typeof fetch) {
  return {
    serviceManualCustomers(profile: Pick<MerchantProfile, "id" | "user_id">) {
      if (!profile || !id(profile.id) || !id(profile.user_id)) throw new TypeError("authenticated_service_profile_required");
      const merchantId = profile.id;
      return {
        async list(options: ServiceReadOptions & { cursor?: string } = {}): Promise<CursorPage<TenantCustomer>> {
          if (options.cursor !== undefined && (typeof options.cursor !== "string" || !options.cursor || options.cursor.length > 4096)) throw new TypeError("invalid_manual_customer_cursor");
          const query = new URLSearchParams({ merchantId, limit: "25", ...(options.cursor ? { cursor: options.cursor } : {}) });
          return page(await dashboardJson<unknown>(base, "/customers?" + query, { method: "GET", signal: options.signal }, fetchImpl));
        },
      };
    },
  };
}
