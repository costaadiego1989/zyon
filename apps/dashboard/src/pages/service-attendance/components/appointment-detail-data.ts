import type { ServiceAppointmentAdminDetail, ServiceAppointmentOperationSummary } from "@zyon/shared-types";
import { projectAppointmentBoard } from "../../service-appointments/appointment-board.js";
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown, max = 200): value is string => typeof value === "string" && !!value && value.length <= max && !/[\x00-\x1f\x7f]/.test(value);
const instant = (value: unknown): value is string => typeof value === "string" && /T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value));

/** A real detail DTO projection, never a synthetic list/page or clone of raw private data. */
export function readOperationDetail(value: unknown, merchantId: string, appointmentId: string): ServiceAppointmentAdminDetail | null {
  if (!object(value) || value.id !== appointmentId || value.merchantId !== merchantId || !text(value.professionalName) || !text(value.serviceName)
    || value.categoryId !== null && !text(value.categoryId, 191) || !Number.isSafeInteger(value.policyVersion) || (value.policyVersion as number) < 1
    || !["manual", "whatsapp", "storefront"].includes(value.origin as string) || !instant(value.startsAt) || !instant(value.endsAt) || !object(value.customer) || !Array.isArray(value.payments) || value.payments.length > 100
    || !Array.isArray(value.history) || value.history.length > 100 || typeof value.historyPartial !== "boolean" || !instant(value.asOf)) return null;
  const board = projectAppointmentBoard(merchantId, [value]);
  if (board.status !== "ready" || board.entries.length !== 1) return null;
  const row = board.entries[0]!, customer: ServiceAppointmentAdminDetail["customer"] = {}, payments: ServiceAppointmentAdminDetail["payments"] = [], history: ServiceAppointmentAdminDetail["history"] = [];
  for (const key of ["name", "phone", "email"] as const) if (value.customer[key] !== undefined) {
    if (!text(value.customer[key], key === "email" ? 254 : key === "phone" ? 32 : 200)) return null;
    customer[key] = value.customer[key];
  }
  const paymentIds = new Set<string>(), historyIds = new Set<string>();
  for (const payment of value.payments) {
    if (!object(payment) || typeof payment.requiresRegularization !== "boolean" || payment.receivedAt !== null && !instant(payment.receivedAt) || paymentIds.has(payment.id as string)) return null;
    paymentIds.add(payment.id as string);
    payments.push({ id: payment.id as string, mode: payment.mode as "online" | "at_attendance", status: payment.status as ServiceAppointmentAdminDetail["payments"][number]["status"], amountCents: payment.amountCents as number,
      currency: payment.currency as string, version: payment.version as number, requiresRegularization: payment.requiresRegularization, receivedAt: payment.receivedAt as string | null });
  }
  for (const audit of value.history) {
    if (!object(audit) || !text(audit.id, 191) || historyIds.has(audit.id) || !text(audit.action) || !text(audit.origin) || audit.actorId !== null && !text(audit.actorId, 191)
      || !Number.isSafeInteger(audit.version) || (audit.version as number) < 1 || !instant(audit.occurredAt)) return null;
    historyIds.add(audit.id); history.push({ id: audit.id, action: audit.action, actorId: audit.actorId as string | null, origin: audit.origin, version: audit.version as number, occurredAt: audit.occurredAt });
  }
  return { id: row.id, merchantId, professionalId: row.professionalId, professionalName: value.professionalName, productId: row.productId, serviceName: value.serviceName,
    categoryId: value.categoryId as string | null, variantId: row.variantId, startsAt: row.startsAt, endsAt: row.endsAt, timeZone: row.timeZone, durationMinutes: row.durationMinutes,
    priceInCents: row.priceInCents, currency: row.currency, policyVersion: value.policyVersion as number, operationalStatus: row.operationalStatus, origin: value.origin as ServiceAppointmentAdminDetail["origin"],
    version: row.version, customer, payments, history, historyPartial: value.historyPartial, asOf: value.asOf };
}

/** Both reads must agree on operational and independently versioned financial facts. */
export function coherentOperationSummary(detail: ServiceAppointmentAdminDetail, summary: ServiceAppointmentOperationSummary): boolean {
  if (summary.merchantId !== detail.merchantId || summary.appointmentId !== detail.id || summary.appointmentVersion !== detail.version) return false;
  const local = detail.payments.filter(row => row.mode === "at_attendance");
  if (local.length !== summary.localPayments.length) return false;
  return summary.localPayments.every(balance => {
    const payment = local.find(row => row.id === balance.paymentId);
    if (!payment || payment.version !== balance.paymentVersion || payment.currency !== balance.currency) return false;
    if (balance.balanceStatus === "unavailable") return balance.receivedCents === null && balance.remainingCents === null && !balance.canRecordReceipt;
    if (balance.receivedCents === null || balance.remainingCents === null || balance.receivedCents + balance.remainingCents !== payment.amountCents) return false;
    return balance.balanceStatus === "available" ? payment.status === "pending" && payment.receivedAt === null && balance.remainingCents > 0 && balance.canRecordReceipt
      : payment.status === "approved" && payment.receivedAt !== null && balance.remainingCents === 0 && !balance.canRecordReceipt;
  });
}
