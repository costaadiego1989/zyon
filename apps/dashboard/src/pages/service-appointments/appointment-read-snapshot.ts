import type { ServiceAppointmentAdminItem, ServiceAppointmentAdminList, ServiceAppointmentAdminListQuery } from "@zyon/shared-types";
import { APPOINTMENT_COLUMNS, projectAppointmentBoard, type AppointmentBoardProjection } from "./appointment-board.js";

export interface AppointmentReadSnapshot {
  page: ServiceAppointmentAdminList;
  board: Extract<AppointmentBoardProjection, { status: "ready" }>;
}
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown, max = 200): value is string => typeof value === "string" && !!value && value.length <= max && !/[\x00-\x1f\x7f]/.test(value);
const integer = (value: unknown, min = 0): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= min;
const instant = (value: unknown): value is string => typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value));
const dateFormatter = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" });
function civil(instant: string) {
  const parts = dateFormatter.formatToParts(new Date(instant)), part = (type: string) => parts.find(value => value.type === type)!.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

/** Validate the served read contract. A bad page never becomes an empty cart
 * or a partial set of apparently valid appointments. No permission inference. */
export function readAppointmentSnapshot(merchantId: string, query: ServiceAppointmentAdminListQuery, value: unknown): AppointmentReadSnapshot | null {
  if (!object(value) || !Array.isArray(value.items) || !integer(value.totalCount) || !object(value.countsByStatus)
    || !instant(value.asOf) || value.timeZone !== "America/Sao_Paulo"
    || value.nextCursor !== null && (typeof value.nextCursor !== "string" || value.nextCursor.length > 1024 || !/^[A-Za-z0-9_-]+$/.test(value.nextCursor))) return null;
  const counts = value.countsByStatus;
  if (Object.keys(counts).length !== APPOINTMENT_COLUMNS.length || APPOINTMENT_COLUMNS.some(column => !integer(counts[column.status]))) return null;
  const total = APPOINTMENT_COLUMNS.reduce((sum, column) => sum + (counts[column.status] as number), 0);
  if (!Number.isSafeInteger(total) || total !== value.totalCount || value.items.length > value.totalCount
    || value.items.length > Number(query.limit ?? 25) || value.nextCursor !== null && value.items.length === 0) return null;
  const projected = projectAppointmentBoard(merchantId, value.items);
  if (projected.status !== "ready" || projected.columns.some(column => column.entries.length > (counts[column.status] as number))) return null;
  const items: ServiceAppointmentAdminItem[] = [];
  for (const item of value.items) {
    if (!object(item) || !text(item.professionalName) || !text(item.serviceName) || item.categoryId !== null && !text(item.categoryId, 191)
      || !integer(item.policyVersion, 1) || !["manual", "whatsapp", "storefront"].includes(item.origin as string)
      || !object(item.customer) || !Array.isArray(item.payments)
      || query.professionalId !== undefined && item.professionalId !== query.professionalId
      || query.productId !== undefined && item.productId !== query.productId
      || query.categoryId !== undefined && item.categoryId !== query.categoryId
      || query.status !== undefined && item.operationalStatus !== query.status) return null;
    const date = civil(item.startsAt as string);
    if (date < query.fromDate || date > query.toDate) return null;
    const customer: ServiceAppointmentAdminItem["customer"] = {};
    for (const key of ["name", "phone", "email"] as const) {
      if (item.customer[key] !== undefined) {
        if (!text(item.customer[key], key === "email" ? 254 : key === "phone" ? 32 : 200)) return null;
        customer[key] = item.customer[key];
      }
    }
    const payments: ServiceAppointmentAdminItem["payments"] = [];
    for (const payment of item.payments) {
      if (!object(payment) || typeof payment.requiresRegularization !== "boolean" || payment.receivedAt !== null && !instant(payment.receivedAt)) return null;
      // All remaining financial fields were checked by projectAppointmentBoard.
      payments.push({ id: payment.id as string, mode: payment.mode as "online" | "at_attendance", status: payment.status as ServiceAppointmentAdminItem["payments"][number]["status"],
        amountCents: payment.amountCents as number, currency: payment.currency as string, version: payment.version as number,
        requiresRegularization: payment.requiresRegularization, receivedAt: payment.receivedAt as string | null });
    }
    items.push({ id: item.id as string, merchantId, professionalId: item.professionalId as string, professionalName: item.professionalName,
      productId: item.productId as string, serviceName: item.serviceName, categoryId: item.categoryId as string | null, variantId: item.variantId as string,
      startsAt: item.startsAt as string, endsAt: item.endsAt as string, timeZone: item.timeZone as string, durationMinutes: item.durationMinutes as number,
      priceInCents: item.priceInCents as number, currency: item.currency as string, policyVersion: item.policyVersion,
      operationalStatus: item.operationalStatus as ServiceAppointmentAdminItem["operationalStatus"], origin: item.origin as ServiceAppointmentAdminItem["origin"], version: item.version as number,
      customer, payments });
  }
  const board = projectAppointmentBoard(merchantId, items);
  if (board.status !== "ready") return null;
  return { page: { items, totalCount: value.totalCount, countsByStatus: Object.fromEntries(APPOINTMENT_COLUMNS.map(column => [column.status, counts[column.status]])) as ServiceAppointmentAdminList["countsByStatus"],
    nextCursor: value.nextCursor as string | null, asOf: value.asOf, timeZone: "America/Sao_Paulo" }, board };
}
