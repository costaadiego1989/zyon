import type { Product, TenantCustomer } from "../../../api-client.js";
import type { ServiceAppointmentAdminDetail } from "@zyon/shared-types";
import type { ManualServiceAppointmentInput } from "../../../api/endpoints/service-appointment-operations.js";
import type { ServiceProfessionalDTO, ServiceBusinessPolicyDTO, ServiceAvailabilitySlotsDTO } from "../../../api/endpoints/service-attendance.js";
import { availabilityWallInstant } from "./availability-form.js";
import { FIXED_SERVICE_UI_TIME_ZONE } from "./fixed-service-time-zone.js";

export interface ManualAppointmentDraft {
  customerMode: "contact" | "known"; knownCustomerId: string; name: string; phone: string; email: string;
  categoryId: string; productId: string; variantId: string; professionalId: string;
  fromDate: string; toDate: string; date: string; slotStartsAt: string; explicitOneOff: boolean; oneOffStart: string; reason: string;
}
export function createManualAppointmentDraft(period: { fromDate: string; toDate: string }): ManualAppointmentDraft {
  return { customerMode: "contact", knownCustomerId: "", name: "", phone: "", email: "", categoryId: "", productId: "", variantId: "", professionalId: "",
    fromDate: period.fromDate, toDate: period.toDate, date: "", slotStartsAt: "", explicitOneOff: false, oneOffStart: "", reason: "" };
}
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const id = (value: unknown): value is string => typeof value === "string" && !!value && value.trim() === value && value.length <= 191 && !/[\x00-\x1f\x7f]/.test(value);
const integer = (value: unknown, min = 0): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= min && value <= 2_147_483_647;
const text = (value: unknown, max = 200): value is string => typeof value === "string" && !!value.trim() && value.length <= max && !/[\x00-\x1f\x7f]/.test(value);
const instant = (value: unknown): value is string => typeof value === "string" && /T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value));
export function manualPolicyReady(value: ServiceBusinessPolicyDTO | null | undefined): value is Extract<ServiceBusinessPolicyDTO, { status: "configured" }> {
  return !!value && value.status === "configured" && integer(value.version, 1) && !!value.policy && value.policy.admissionsEnabled === true
    && ["online", "at_attendance"].includes(value.policy.paymentMode) && typeof value.policy.holdEnabled === "boolean"
    && (value.policy.holdEnabled ? integer(value.policy.holdMinutes, 1) : value.policy.holdMinutes === null);
}
export interface ManualCommandContext { merchantId: string; product: Product | undefined; professional: ServiceProfessionalDTO | undefined;
  policy: ServiceBusinessPolicyDTO | null; availability: ServiceAvailabilitySlotsDTO | null; customers: TenantCustomer[]; commandId: string }
export function manualAppointmentCommand(draft: ManualAppointmentDraft, context: ManualCommandContext): ManualServiceAppointmentInput {
  const { product, professional, policy, availability } = context;
  if (!manualPolicyReady(policy)) throw Error("Confira a política de agendamento antes de continuar.");
  if (!id(context.commandId) || !product || product.id !== draft.productId || product.merchantId !== context.merchantId || product.type !== "service" || !product.isActive
    || !Array.isArray(product.variants) || !product.variants.some(row => row.id === draft.variantId && row.isActive) || !professional || professional.id !== draft.professionalId
    || professional.merchantId !== context.merchantId || !professional.isActive || !professional.isPublished || !integer(professional.version, 1)
    || !Array.isArray(professional.services) || !professional.services.some(link => link.productId === product.id)) throw Error("Selecione um serviço e um profissional ativo vinculado.");
  let customer: ManualServiceAppointmentInput["customer"];
  if (draft.customerMode === "known") {
    if (!context.customers.some(row => row.id === draft.knownCustomerId)) throw Error("Selecione um cliente da lista consultada.");
    customer = { kind: "known", customerId: draft.knownCustomerId };
  } else {
    const name = draft.name.trim(), phone = draft.phone.trim(), email = draft.email.trim().toLowerCase();
    if (!text(name) || (!phone && !email) || phone && (!/^[+\d(). -]+$/.test(phone) || !/^\d{10,15}$/.test(phone.replace(/\D/g, "")))
      || email && (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) throw Error("Informe nome e um telefone ou e-mail válido.");
    customer = { kind: "contact", name, ...(phone ? { phone } : {}), ...(email ? { email } : {}) };
  }
  let startsAt: string;
  if (draft.explicitOneOff) {
    startsAt = availabilityWallInstant(draft.oneOffStart, FIXED_SERVICE_UI_TIME_ZONE);
    if (draft.reason.length > 1200) throw Error("O motivo deve ter até 1.200 caracteres.");
  } else {
    const slot = availability?.slots.find(row => row.startsAt === draft.slotStartsAt && row.date === draft.date);
    if (!availability || availability.status !== "ready" || availability.professionalVersion !== professional.version || availability.policyVersion !== policy.version
      || availability.timeZone !== FIXED_SERVICE_UI_TIME_ZONE || !slot || slot.timeZone !== FIXED_SERVICE_UI_TIME_ZONE
      || !instant(slot.startsAt) || !instant(slot.endsAt) || Date.parse(slot.endsAt) - Date.parse(slot.startsAt) !== slot.durationMinutes * 60_000)
      throw Error("Consulte e selecione um horário atual oferecido pelo servidor.");
    startsAt = slot.startsAt;
  }
  return { commandId: context.commandId, professionalId: professional.id, productId: product.id, variantId: draft.variantId,
    expectedProfessionalVersion: professional.version, expectedPolicyVersion: policy.version, startsAt, customer,
    ...(draft.explicitOneOff ? { explicitOneOff: draft.reason.trim() ? { reason: draft.reason } : {} } : {}) };
}

/** Validate the actual detail DTO; missing finance stays unknown, never free. */
export function readManualAppointmentDetail(value: unknown, expected: { merchantId: string; appointmentId: string; productId: string; variantId: string; minimumVersion: number }): ServiceAppointmentAdminDetail | null {
  if (!object(value) || value.id !== expected.appointmentId || value.merchantId !== expected.merchantId || value.productId !== expected.productId || value.variantId !== expected.variantId
    || !id(value.professionalId) || !text(value.professionalName) || !text(value.serviceName) || value.categoryId !== null && !id(value.categoryId)
    || !integer(value.version, expected.minimumVersion) || !integer(value.policyVersion, 1) || value.origin !== "manual"
    || !["pending", "scheduled", "in_service", "completed", "no_show", "cancelled"].includes(value.operationalStatus as string)
    || !instant(value.startsAt) || !instant(value.endsAt) || !integer(value.durationMinutes, 5) || value.durationMinutes > 480
    || Date.parse(value.endsAt) - Date.parse(value.startsAt) !== value.durationMinutes * 60_000 || !text(value.timeZone, 80)
    || !integer(value.priceInCents) || typeof value.currency !== "string" || !/^[A-Z]{3}$/.test(value.currency) || !object(value.customer)
    || !Array.isArray(value.payments) || value.payments.length > 100 || !Array.isArray(value.history) || value.history.length > 100
    || typeof value.historyPartial !== "boolean" || !instant(value.asOf)) return null;
  try { new Intl.DateTimeFormat("pt-BR", { timeZone: value.timeZone }); } catch { return null; }
  for (const key of ["name", "phone", "email"]) if (value.customer[key] !== undefined && !text(value.customer[key], key === "email" ? 254 : key === "phone" ? 32 : 200)) return null;
  const paymentIds = new Set<string>(), historyIds = new Set<string>();
  const payments: ServiceAppointmentAdminDetail["payments"] = [], history: ServiceAppointmentAdminDetail["history"] = [];
  for (const row of value.payments) {
    if (!object(row) || !id(row.id) || paymentIds.has(row.id) || !["online", "at_attendance"].includes(row.mode as string)
      || !["pending", "approved", "failed", "cancelled", "refunded", "partially_refunded"].includes(row.status as string)
      || !integer(row.amountCents) || !integer(row.version, 1) || typeof row.currency !== "string" || !/^[A-Z]{3}$/.test(row.currency)
      || typeof row.requiresRegularization !== "boolean" || row.receivedAt !== null && !instant(row.receivedAt)) return null;
    paymentIds.add(row.id);
    payments.push({ id: row.id, mode: row.mode as "online" | "at_attendance", status: row.status as ServiceAppointmentAdminDetail["payments"][number]["status"],
      amountCents: row.amountCents, currency: row.currency, version: row.version, requiresRegularization: row.requiresRegularization, receivedAt: row.receivedAt as string | null });
  }
  for (const row of value.history) {
    if (!object(row) || !id(row.id) || historyIds.has(row.id) || !text(row.action) || row.actorId !== null && !id(row.actorId)
      || !text(row.origin) || !integer(row.version, 1) || !instant(row.occurredAt)) return null;
    historyIds.add(row.id);
    history.push({ id: row.id, action: row.action, actorId: row.actorId as string | null, origin: row.origin, version: row.version, occurredAt: row.occurredAt });
  }
  const customer: ServiceAppointmentAdminDetail["customer"] = {};
  for (const key of ["name", "phone", "email"] as const) if (typeof value.customer[key] === "string") customer[key] = value.customer[key];
  return { id: value.id, merchantId: value.merchantId, professionalId: value.professionalId, professionalName: value.professionalName,
    productId: value.productId, serviceName: value.serviceName, categoryId: value.categoryId as string | null, variantId: value.variantId,
    startsAt: value.startsAt, endsAt: value.endsAt, timeZone: value.timeZone, durationMinutes: value.durationMinutes,
    priceInCents: value.priceInCents, currency: value.currency, policyVersion: value.policyVersion,
    operationalStatus: value.operationalStatus as ServiceAppointmentAdminDetail["operationalStatus"], origin: "manual", version: value.version,
    customer, payments, history, historyPartial: value.historyPartial, asOf: value.asOf };
}
