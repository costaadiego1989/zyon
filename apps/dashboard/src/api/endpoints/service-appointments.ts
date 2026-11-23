import type { ServiceAppointmentAdminDetail, ServiceAppointmentAdminList, ServiceAppointmentAdminListQuery } from "@zyon/shared-types";
import type { MerchantProfile } from "../types.js";
import { dashboardJson } from "../http/client.js";
import type { ServiceReadOptions } from "./service-attendance.js";

const states = ["pending", "scheduled", "in_service", "completed", "no_show", "cancelled"];
function resourceId(value: unknown): string {
  if (typeof value !== "string" || !value || value.trim() !== value || value.length > 191 || value === "." || value === ".." || /[\x00-\x1f\x7f]/.test(value))
    throw new TypeError("invalid_service_appointment_resource_id");
  return encodeURIComponent(value);
}
function date(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const epoch = Date.parse(value + "T00:00:00Z");
  return Number.isFinite(epoch) && new Date(epoch).toISOString().slice(0, 10) === value;
}
export function appointmentReadQuery(input: ServiceAppointmentAdminListQuery): ServiceAppointmentAdminListQuery {
  if (!input || !date(input.fromDate) || !date(input.toDate) || input.toDate < input.fromDate
    || Date.parse(input.toDate) - Date.parse(input.fromDate) >= 31 * 86_400_000) throw new TypeError("invalid_service_appointment_period");
  const result: ServiceAppointmentAdminListQuery = { fromDate: input.fromDate, toDate: input.toDate };
  for (const key of ["professionalId", "categoryId", "productId"] as const) {
    if (input[key] !== undefined) { resourceId(input[key]); result[key] = input[key]; }
  }
  if (input.status !== undefined) {
    if (!states.includes(input.status)) throw new TypeError("invalid_service_appointment_state");
    result.status = input.status;
  }
  if (input.limit !== undefined) {
    if (typeof input.limit !== "string" || !/^\d+$/.test(input.limit) || Number(input.limit) < 1 || Number(input.limit) > 100)
      throw new TypeError("invalid_service_appointment_limit");
    result.limit = input.limit;
  }
  if (input.cursor !== undefined) {
    if (typeof input.cursor !== "string" || input.cursor.length > 1024 || !/^[A-Za-z0-9_-]+$/.test(input.cursor))
      throw new TypeError("invalid_service_appointment_cursor");
    result.cursor = input.cursor;
  }
  return result;
}

/** Administrative reads only; all capacity and money writers stay canonical. */
export function serviceAppointmentEndpoints(base: string, fetchImpl: typeof fetch) {
  return {
    serviceAppointments(profile: Pick<MerchantProfile, "id" | "user_id">) {
      if (!profile) throw new TypeError("authenticated_service_profile_required");
      const merchant = resourceId(profile.id); resourceId(profile.user_id);
      const path = `/merchants/${merchant}/service-appointments`;
      return {
        list(input: ServiceAppointmentAdminListQuery, options?: ServiceReadOptions) {
          const query = new URLSearchParams(Object.entries(appointmentReadQuery(input)));
          return dashboardJson<ServiceAppointmentAdminList>(base, path + "?" + query, { method: "GET", signal: options?.signal }, fetchImpl);
        },
        detail(appointmentId: string, options?: ServiceReadOptions) {
          return dashboardJson<ServiceAppointmentAdminDetail>(base, path + "/" + resourceId(appointmentId), { method: "GET", signal: options?.signal }, fetchImpl);
        },
      };
    },
  };
}
export type ServiceAppointmentsApi = ReturnType<ReturnType<typeof serviceAppointmentEndpoints>["serviceAppointments"]>;
