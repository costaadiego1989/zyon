import type { ServiceAppointmentAdminListQuery } from "@zyon/shared-types";
import { appointmentReadQuery } from "../../api/endpoints/service-appointments.js";
export type AppointmentPageQuery = Omit<ServiceAppointmentAdminListQuery, "cursor">;
export function appointmentPageQuery(hash: string, brasiliaDay: string): AppointmentPageQuery | null {
  const params = new URLSearchParams(hash.split("?")[0] === "#service-appointments" ? hash.split("?")[1] ?? "" : "");
  const raw: AppointmentPageQuery = { fromDate: params.get("fromDate") ?? brasiliaDay, toDate: params.get("toDate") ?? brasiliaDay,
    ...(params.get("professionalId") ? { professionalId: params.get("professionalId")! } : {}), ...(params.get("categoryId") ? { categoryId: params.get("categoryId")! } : {}),
    ...(params.get("productId") ? { productId: params.get("productId")! } : {}),
    ...(params.get("status") ? { status: params.get("status") as ServiceAppointmentAdminListQuery["status"] } : {}) };
  try { return appointmentReadQuery(raw); } catch { return null; }
}
export function appointmentPageHash(query: AppointmentPageQuery): string { const canonical = appointmentReadQuery({ ...query, cursor: undefined }); return "#service-appointments?" + new URLSearchParams(Object.entries(canonical)); }
export function currentBrasiliaDay(): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const part = (key: string) => parts.find(value => value.type === key)!.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}
