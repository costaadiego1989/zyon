import type { MerchantProfile } from "../types.js";
import type { ProductCategoryDTO } from "./catalog.js";
import { dashboardJson } from "../http/client.js";
import { DashboardHttpError, DashboardJsonParseError } from "../http/error.js";

export interface ServiceProfessionalProfile { description?: string; specialties?: string[] }
export interface ServiceProfessionalInput {
  publicName: string;
  publicProfile?: ServiceProfessionalProfile;
  timeZone: string;
  isPublished?: boolean;
  isActive?: boolean;
  productIds?: string[];
}
export interface ServiceProfessionalDTO {
  id: string;
  merchantId: string;
  publicName: string;
  publicProfile: unknown;
  timeZone: string;
  isPublished: boolean;
  isActive: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
  services: Array<{ id: string; productId: string; version: number }>;
}
export interface ServiceProfessionalPage { items: ServiceProfessionalDTO[]; nextCursor: string | null }
export interface EligibleServiceProfessionalDTO {
  merchantId: string;
  professionalId: string;
  professionalVersion: number;
  professionalServiceId: string;
  productId: string;
  variantId: string;
  categoryId: string | null;
  durationMinutes: number;
  timeZone: string;
  priceInCents: number;
  currency: string;
  publicName: string;
  publicProfile: ServiceProfessionalProfile;
}
export interface ServicePageQuery { limit?: number; cursor?: string }
export interface EligibleServiceProfessionalQuery extends ServicePageQuery { productId: string; variantId: string }
export interface RecurringServiceInterval {
  weekday: number;
  startMinute: number;
  endMinute: number;
  validFrom?: string | null;
  validUntil?: string | null;
}
export interface ServiceRecurringAvailabilityInput { expectedVersion: number; timeZone: string; rows: RecurringServiceInterval[] }
export interface ServiceRecurringAvailabilityDTO extends Omit<RecurringServiceInterval, "validFrom" | "validUntil"> {
  id: string;
  merchantId: string;
  professionalId: string;
  validFrom: string | null;
  validUntil: string | null;
  timeZone: string;
  isActive: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
}
export interface ServiceAvailabilityExceptionInput {
  expectedVersion: number;
  kind: "one_off" | "block";
  startsAt: string;
  endsAt: string;
  timeZone: string;
  reason?: string | null;
  isActive?: boolean;
}
export interface ServiceAvailabilityExceptionDTO extends Omit<ServiceAvailabilityExceptionInput, "expectedVersion" | "reason" | "isActive"> {
  id: string;
  merchantId: string;
  professionalId: string;
  reason: string | null;
  isActive: boolean;
  actorId: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}
export interface SavedServiceAvailability {
  professionalId: string;
  version: number;
  timeZone: string;
  rows: ServiceRecurringAvailabilityDTO[];
}
export interface ServiceProfessionalAvailabilityDTO extends SavedServiceAvailability {
  exceptions: ServiceAvailabilityExceptionDTO[];
  nextCursor: string | null;
}
export interface ServiceAvailabilityExceptionResult {
  professionalId: string;
  version: number;
  exception: ServiceAvailabilityExceptionDTO;
}
interface AvailabilityResources { productId: string; variantId: string; professionalId: string; expectedVersion?: number }
export interface ServiceAvailabilityDatesQuery extends AvailabilityResources { fromDate: string; toDate: string }
export interface ServiceAvailabilitySlotsQuery extends AvailabilityResources { date: string }
export interface ServiceAvailabilityDatesDTO {
  status: "ready" | "empty" | "stale";
  professionalVersion: number;
  policyVersion: number | null;
  timeZone: string;
  durationMinutes: number;
  asOf: string;
  dates: string[];
}
export interface ServiceAvailabilitySlot {
  startsAt: string;
  endsAt: string;
  date: string;
  startTime: string;
  timeZone: string;
  durationMinutes: number;
}
export interface ServiceAvailabilitySlotsDTO extends ServiceAvailabilityDatesDTO { slots: ServiceAvailabilitySlot[] }
export interface ServiceBusinessPolicyConfiguration {
  holdEnabled: boolean;
  holdMinutes: number | null;
  paymentMode: "online" | "at_attendance";
  admissionsEnabled: boolean;
}
export type ServiceBusinessPolicyDTO =
  | { status: "configured"; version: number; policy: ServiceBusinessPolicyConfiguration }
  | { status: "unconfigured" | "invalid"; version: number; policy: null };
export interface ServiceBusinessPolicyUpdate extends ServiceBusinessPolicyConfiguration { expectedVersion: number }
export type ServiceCategoryDTO = Omit<ProductCategoryDTO, "merchant_id" | "product_count">;
export interface ServiceCategoryCreate {
  name: string;
  slug?: string;
  parentId?: string;
  description?: string;
  imageUrl?: string;
}
export interface ServiceCategoryUpdate {
  name?: string;
  parentId?: string | null;
  description?: string;
  imageUrl?: string;
  isActive?: boolean;
  sortOrder?: number;
}
export interface ServiceReadOptions { signal?: AbortSignal }
export interface ServiceMutationOptions extends ServiceReadOptions { idempotencyKey?: string }
export type ServiceAttendanceErrorKind = "invalid" | "unauthorized" | "forbidden" | "not_found" | "conflict" | "rate_limited" | "network" | "server" | "invalid_response" | "unknown";

/** Classification never replaces the original HTTP error or its server body. */
export function classifyServiceAttendanceError(error: unknown): ServiceAttendanceErrorKind {
  if (error instanceof DashboardJsonParseError) return "invalid_response";
  if (error instanceof TypeError) return "invalid";
  if (!(error instanceof DashboardHttpError)) return "unknown";
  switch (error.status) {
    case 0: return "network";
    case 400: case 422: return "invalid";
    case 401: return "unauthorized";
    case 403: return "forbidden";
    case 404: return "not_found";
    case 409: case 412: return "conflict";
    case 429: return "rate_limited";
    default: return error.status >= 500 ? "server" : "unknown";
  }
}

function resourceId(value: string): string {
  if (typeof value !== "string" || !value.trim() || value.length > 191 || value === "." || value === "..") throw new TypeError("invalid_service_resource_id");
  return encodeURIComponent(value);
}
function fields(value: object, allowed: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("invalid_service_payload");
  const input = value as Record<string, unknown>;
  return Object.fromEntries(allowed.filter(key => input[key] !== undefined).map(key => [key, input[key]]));
}
function queryPath(path: string, value: object, allowed: readonly string[]): string {
  const query = new URLSearchParams(Object.entries(fields(value, allowed)).map(([key, item]) => [key, String(item)]));
  return query.size ? `${path}?${query}` : path;
}
const professionalFields = ["publicName", "publicProfile", "timeZone", "isPublished", "isActive", "productIds"];
const intervalFields = ["weekday", "startMinute", "endMinute", "validFrom", "validUntil"];
const exceptionFields = ["expectedVersion", "kind", "startsAt", "endsAt", "timeZone", "reason", "isActive"];
function professionalBody(input: ServiceProfessionalInput | (Partial<ServiceProfessionalInput> & { expectedVersion: number }), update = false) {
  const body = fields(input, update ? [...professionalFields, "expectedVersion"] : professionalFields);
  if (input.publicProfile !== undefined) body.publicProfile = fields(input.publicProfile, ["description", "specialties"]);
  return body;
}

export function serviceAttendanceEndpoints(base: string, f: typeof fetch) {
  return {
    /** Bind once to the current authenticated profile. Server guards still
     * authorize every request; this object is not an authorization token. */
    serviceAttendance(profile: Pick<MerchantProfile, "id" | "user_id">) {
      if (!profile || typeof profile.id !== "string" || !profile.id.trim() || typeof profile.user_id !== "string" || !profile.user_id.trim())
        throw new TypeError("authenticated_service_profile_required");
      const merchantPath = `/merchants/${resourceId(profile.id)}`;
      const professionalsPath = `${merchantPath}/service-professionals`;
      const professionalPath = (id: string) => `${professionalsPath}/${resourceId(id)}`;
      const categoriesPath = `${merchantPath}/categories`;
      const policyPath = "/merchants/me/service-business-policy";
      const read = <T>(path: string, options?: ServiceReadOptions) => dashboardJson<T>(base, path, { method: "GET", signal: options?.signal }, f);
      const mutate = <T>(path: string, method: string, jsonBody: unknown, options?: ServiceMutationOptions) => dashboardJson<T>(base, path, {
        method, jsonBody, signal: options?.signal,
        headers: options?.idempotencyKey === undefined ? undefined : { "Idempotency-Key": options.idempotencyKey },
      }, f);
      return {
        listProfessionals(query: ServicePageQuery = {}, options?: ServiceReadOptions) {
          return read<ServiceProfessionalPage>(queryPath(professionalsPath, query, ["limit", "cursor"]), options);
        },
        createProfessional(input: ServiceProfessionalInput, options?: ServiceMutationOptions) {
          return mutate<ServiceProfessionalDTO>(professionalsPath, "POST", professionalBody(input), options);
        },
        updateProfessional(id: string, input: Partial<ServiceProfessionalInput> & { expectedVersion: number }, options?: ServiceMutationOptions) {
          return mutate<ServiceProfessionalDTO>(professionalPath(id), "PATCH", professionalBody(input, true), options);
        },
        deactivateProfessional(id: string, expectedVersion: number, options?: ServiceMutationOptions) {
          return mutate<ServiceProfessionalDTO>(`${professionalPath(id)}/deactivate`, "POST", { expectedVersion }, options);
        },
        listEligibleProfessionals(query: EligibleServiceProfessionalQuery, options?: ServiceReadOptions) {
          return read<{ items: EligibleServiceProfessionalDTO[]; nextCursor: string | null }>(queryPath(`${professionalsPath}/eligible`, query, ["productId", "variantId", "limit", "cursor"]), options);
        },
        getProfessionalAvailability(id: string, query: { cursor?: string } = {}, options?: ServiceReadOptions) {
          return read<ServiceProfessionalAvailabilityDTO>(queryPath(`${professionalPath(id)}/availability`, query, ["cursor"]), options);
        },
        saveProfessionalAvailability(id: string, input: ServiceRecurringAvailabilityInput, options?: ServiceMutationOptions) {
          return mutate<SavedServiceAvailability>(`${professionalPath(id)}/availability`, "PUT", {
            ...fields(input, ["expectedVersion", "timeZone"]), rows: input.rows.map(row => fields(row, intervalFields)),
          }, options);
        },
        createAvailabilityException(id: string, input: ServiceAvailabilityExceptionInput, options?: ServiceMutationOptions) {
          return mutate<ServiceAvailabilityExceptionResult>(`${professionalPath(id)}/availability-exceptions`, "POST", fields(input, exceptionFields), options);
        },
        updateAvailabilityException(id: string, exceptionId: string, input: ServiceAvailabilityExceptionInput, options?: ServiceMutationOptions) {
          return mutate<ServiceAvailabilityExceptionResult>(`${professionalPath(id)}/availability-exceptions/${resourceId(exceptionId)}`, "PATCH", fields(input, exceptionFields), options);
        },
        getAvailableDates(query: ServiceAvailabilityDatesQuery, options?: ServiceReadOptions) {
          return read<ServiceAvailabilityDatesDTO>(queryPath(`${merchantPath}/service-availability/dates`, query, ["productId", "variantId", "professionalId", "fromDate", "toDate", "expectedVersion"]), options);
        },
        getAvailableSlots(query: ServiceAvailabilitySlotsQuery, options?: ServiceReadOptions) {
          return read<ServiceAvailabilitySlotsDTO>(queryPath(`${merchantPath}/service-availability/slots`, query, ["productId", "variantId", "professionalId", "date", "expectedVersion"]), options);
        },
        getPolicy(options?: ServiceReadOptions) { return read<ServiceBusinessPolicyDTO>(policyPath, options); },
        updatePolicy(input: ServiceBusinessPolicyUpdate, options?: ServiceMutationOptions) {
          return mutate<ServiceBusinessPolicyDTO>(policyPath, "PUT", fields(input, ["holdEnabled", "holdMinutes", "paymentMode", "admissionsEnabled", "expectedVersion"]), options);
        },
        listCategories(options?: ServiceReadOptions) { return read<Array<ServiceCategoryDTO & { product_count: number }>>(categoriesPath, options); },
        createCategory(input: ServiceCategoryCreate, options?: ServiceMutationOptions) {
          return mutate<ServiceCategoryDTO>(categoriesPath, "POST", fields(input, ["name", "slug", "parentId", "description", "imageUrl"]), options);
        },
        updateCategory(id: string, input: ServiceCategoryUpdate, options?: ServiceMutationOptions) {
          const body = fields(input, ["name", "parentId", "description", "imageUrl", "isActive", "sortOrder"]);
          if (input.parentId === null) {
            delete body.parentId;
            body.parent_id = null;
          }
          return mutate<ServiceCategoryDTO>(`${categoriesPath}/${resourceId(id)}`, "PUT", body, options);
        },
        deleteCategory(id: string, options?: ServiceMutationOptions) {
          return mutate<{ deleted: true }>(`${categoriesPath}/${resourceId(id)}`, "DELETE", undefined, options);
        },
        reorderCategories(items: Array<{ id: string; sort_order: number }>, options?: ServiceMutationOptions) {
          return mutate<{ reordered: true }>(`${categoriesPath}/reorder`, "PATCH", { items: items.map(item => fields(item, ["id", "sort_order"])) }, options);
        },
      };
    },
  };
}
export type ServiceAttendanceApi = ReturnType<ReturnType<typeof serviceAttendanceEndpoints>["serviceAttendance"]>;
