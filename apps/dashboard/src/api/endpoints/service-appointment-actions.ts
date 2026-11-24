import type { ServiceAppointmentOperationSummary, ServiceAppointmentAdminState } from "@zyon/shared-types";
import type { MerchantProfile } from "../types.js";
import { dashboardJson } from "../http/client.js";
import { DashboardJsonParseError } from "../http/error.js";
import type { ServiceReadOptions } from "./service-attendance.js";

export type AttendanceAction = "start_service" | "complete_service" | "no_show";
export interface TransitionInput { commandId: string; expectedVersion: number; action: AttendanceAction }
export interface CancellationInput { commandId: string; expectedVersion: number; operatorRequestId: string; policyHash: string }
export interface DestinationInput { professionalId: string; expectedProfessionalVersion: number; startsAt: string }
export interface ReschedulePreviewInput { expectedVersion: number; destination: DestinationInput }
export interface RescheduleInput extends ReschedulePreviewInput { commandId: string; operatorRequestId: string; policyHash: string; acceptedQuoteHash: string }
export interface AttendanceReceiptInput { commandId: string; paymentId: string; expectedPaymentVersion: number; amountCents: number; currency: string; paymentMethod: string }
export interface OperationAck { appointmentId: string; appointmentVersion?: number; appliedVersion?: number; paymentId?: string; paymentVersion?: number; replayed: boolean }
export interface OperationPolicyReference { sourceId: string; sourceVersion: string; sourceHash: string; publicationState: "draft" | "published" | "withdrawn" }
export interface OperationPolicies { hash: string; references: OperationPolicyReference[]; policies: Array<OperationPolicyReference & { text: string | null }> }
export interface OperationQuote { merchantId: string; appointmentId: string; version: number; productId: string; variantId: string; professionalId: string;
  professionalVersion: number; policyVersion: number; policyHash: string; startsAt: string; endsAt: string; timeZone: string; durationMinutes: number; priceInCents: number;
  currency: string; paymentMode: "online" | "at_attendance"; holdEnabled: boolean; holdMinutes: number | null }
export interface OperationPreview { quote: OperationQuote; quoteHash: string; requiresSeparateFinancialReview: boolean }
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const id = (value: unknown): value is string => typeof value === "string" && !!value && value.trim() === value && value.length <= 191 && ![".", ".."].includes(value) && !/[\x00-\x1f\x7f]/.test(value);
const integer = (value: unknown, min = 0): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= min && value <= 2_147_483_647;
const digest = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const currency = (value: unknown): value is string => typeof value === "string" && /^[A-Z]{3}$/.test(value);
const instant = (value: unknown): value is string => typeof value === "string" && /T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value));
const states: ServiceAppointmentAdminState[] = ["pending", "scheduled", "in_service", "completed", "no_show", "cancelled"];
const invalid = (): never => { throw new DashboardJsonParseError("invalid_service_appointment_operation"); };
function command(value: { commandId: string }) { if (!id(value?.commandId)) throw new TypeError("invalid_service_command"); }
function version(value: number) { if (!integer(value, 1)) throw new TypeError("invalid_service_expected_version"); }
function routeId(value: string) { if (!id(value)) throw new TypeError("invalid_service_appointment_id"); return encodeURIComponent(value); }
function destination(value: DestinationInput): DestinationInput { if (!value || !id(value.professionalId) || !instant(value.startsAt)) throw new TypeError("invalid_service_destination"); version(value.expectedProfessionalVersion); return { professionalId: value.professionalId, expectedProfessionalVersion: value.expectedProfessionalVersion, startsAt: value.startsAt }; }
function summary(value: unknown, merchantId: string, appointmentId: string): ServiceAppointmentOperationSummary {
  if (!object(value) || value.merchantId !== merchantId || value.appointmentId !== appointmentId || !integer(value.appointmentVersion, 1) || !instant(value.asOf)
    || !Array.isArray(value.attendanceActions) || value.attendanceActions.some(action => !["start_service", "complete_service", "no_show"].includes(action))
    || new Set(value.attendanceActions).size !== value.attendanceActions.length || typeof value.canReviewCancellation !== "boolean" || typeof value.canReviewRescheduling !== "boolean"
    || !Array.isArray(value.localPayments) || value.localPayments.length > 100) return invalid();
  const seen = new Set<string>(), localPayments: ServiceAppointmentOperationSummary["localPayments"] = [];
  for (const row of value.localPayments) {
    if (!object(row) || !id(row.paymentId) || seen.has(row.paymentId) || !integer(row.paymentVersion, 1) || !currency(row.currency)
      || !["available", "not_payable", "unavailable"].includes(row.balanceStatus as string) || typeof row.canRecordReceipt !== "boolean") return invalid();
    if (row.balanceStatus === "unavailable" ? row.receivedCents !== null || row.remainingCents !== null || row.canRecordReceipt
      : !integer(row.receivedCents) || !integer(row.remainingCents) || (row.balanceStatus === "available" ? !row.canRecordReceipt || row.remainingCents <= 0 : row.canRecordReceipt || row.remainingCents !== 0)) return invalid();
    seen.add(row.paymentId); localPayments.push({ paymentId: row.paymentId, paymentVersion: row.paymentVersion, currency: row.currency,
      balanceStatus: row.balanceStatus as "available" | "not_payable" | "unavailable", receivedCents: row.receivedCents as number | null, remainingCents: row.remainingCents as number | null, canRecordReceipt: row.canRecordReceipt });
  }
  return { merchantId, appointmentId, appointmentVersion: value.appointmentVersion, asOf: value.asOf, attendanceActions: [...value.attendanceActions] as AttendanceAction[], canReviewCancellation: value.canReviewCancellation, canReviewRescheduling: value.canReviewRescheduling, localPayments };
}
function policies(value: unknown): OperationPolicies {
  if (!object(value) || !digest(value.hash) || !Array.isArray(value.references) || !Array.isArray(value.policies) || value.references.length !== value.policies.length || value.references.length > 100) return invalid();
  const references: OperationPolicyReference[] = [], result: OperationPolicies["policies"] = [], seen = new Set<string>();
  for (let index = 0; index < value.references.length; index++) {
    const row = value.references[index], content = value.policies[index];
    if (!object(row) || !id(row.sourceId) || seen.has(row.sourceId) || typeof row.sourceVersion !== "string" || !row.sourceVersion || !digest(row.sourceHash)
      || !["draft", "published", "withdrawn"].includes(row.publicationState as string) || !object(content)
      || ["sourceId", "sourceVersion", "sourceHash", "publicationState"].some(key => row[key] !== content[key])
      || (row.publicationState === "published" ? typeof content.text !== "string" : content.text !== null)) return invalid();
    const reference: OperationPolicyReference = { sourceId: row.sourceId, sourceVersion: row.sourceVersion, sourceHash: row.sourceHash, publicationState: row.publicationState as OperationPolicyReference["publicationState"] };
    seen.add(row.sourceId); references.push(reference); result.push({ ...reference, text: content.text as string | null });
  }
  return { hash: value.hash, references, policies: result };
}
function ack(value: unknown, merchantId: string, appointmentId: string, expectedVersion: number): OperationAck {
  if (!object(value) || !object(value.appointment) || value.appointment.id !== appointmentId || value.appointment.merchantId !== merchantId
    || !integer(value.appliedVersion, expectedVersion + 1) || value.appliedVersion !== expectedVersion + 1 || !integer(value.appointment.version, value.appliedVersion)
    || !states.includes(value.appointment.operationalStatus as ServiceAppointmentAdminState) || typeof value.replayed !== "boolean") return invalid();
  return { appointmentId, appointmentVersion: value.appointment.version, appliedVersion: value.appliedVersion, replayed: value.replayed };
}
function quote(value: unknown, merchantId: string, appointmentId: string, input: ReschedulePreviewInput): OperationPreview {
  if (!object(value) || !object(value.quote) || !digest(value.quoteHash) || typeof value.requiresSeparateFinancialReview !== "boolean") return invalid();
  const q = value.quote;
  if (q.merchantId !== merchantId || q.appointmentId !== appointmentId || q.version !== input.expectedVersion || !id(q.productId) || !id(q.variantId)
    || q.professionalId !== input.destination.professionalId || q.professionalVersion !== input.destination.expectedProfessionalVersion
    || !instant(q.startsAt) || Date.parse(q.startsAt) !== Date.parse(input.destination.startsAt) || !instant(q.endsAt) || q.timeZone !== "America/Sao_Paulo"
    || !integer(q.durationMinutes, 5) || q.durationMinutes > 480 || Date.parse(q.endsAt) - Date.parse(q.startsAt) !== q.durationMinutes * 60000 || !integer(q.priceInCents, 1)
    || !currency(q.currency) || !integer(q.policyVersion, 1) || !digest(q.policyHash) || !["online", "at_attendance"].includes(q.paymentMode as string)
    || typeof q.holdEnabled !== "boolean" || (q.holdEnabled ? !integer(q.holdMinutes, 1) : q.holdMinutes !== null)) return invalid();
  return { quoteHash: value.quoteHash, requiresSeparateFinancialReview: value.requiresSeparateFinancialReview, quote: { merchantId, appointmentId, version: q.version,
    productId: q.productId, variantId: q.variantId, professionalId: q.professionalId, professionalVersion: q.professionalVersion, policyVersion: q.policyVersion, policyHash: q.policyHash,
    startsAt: q.startsAt, endsAt: q.endsAt, timeZone: q.timeZone, durationMinutes: q.durationMinutes, priceInCents: q.priceInCents, currency: q.currency, paymentMode: q.paymentMode as OperationQuote["paymentMode"], holdEnabled: q.holdEnabled, holdMinutes: q.holdMinutes as number | null } };
}

/** Separate from the frozen T79 manual endpoint; no raw appointment/provider DTO enters UI state. */
export function serviceAppointmentActionEndpoints(base: string, fetchImpl: typeof fetch) {
  return { serviceAppointmentActions(profile: Pick<MerchantProfile, "id" | "user_id">) {
    if (!profile || !id(profile.id) || !id(profile.user_id)) throw new TypeError("authenticated_service_profile_required");
    const merchantId = profile.id, userId = profile.user_id, path = `/merchants/${routeId(merchantId)}/service-appointments`;
    const get = (appointmentId: string, suffix: string, options: ServiceReadOptions = {}) => dashboardJson<unknown>(base, `${path}/${routeId(appointmentId)}/${suffix}`, { method: "GET", signal: options.signal }, fetchImpl);
    const post = (appointmentId: string, suffix: string, body: object, commandId?: string, options: ServiceReadOptions = {}) => dashboardJson<unknown>(base, `${path}/${routeId(appointmentId)}/${suffix}`, { method: "POST", jsonBody: body, signal: options.signal, ...(commandId ? { headers: { "Idempotency-Key": commandId } } : {}) }, fetchImpl);
    return {
      async summary(appointmentId: string, options?: ServiceReadOptions) { return summary(await get(appointmentId, "operation-summary", options), merchantId, appointmentId); },
      async policies(appointmentId: string, options?: ServiceReadOptions) { return policies(await get(appointmentId, "operation-policy", options)); },
      async transition(appointmentId: string, input: TransitionInput) { command(input); version(input.expectedVersion); if (!["start_service", "complete_service", "no_show"].includes(input.action)) throw new TypeError("invalid_attendance_action"); return ack(await post(appointmentId, "transitions", { commandId: input.commandId, expectedVersion: input.expectedVersion, action: input.action }, input.commandId), merchantId, appointmentId, input.expectedVersion); },
      async cancel(appointmentId: string, input: CancellationInput) { command(input); version(input.expectedVersion); if (!id(input.operatorRequestId) || !digest(input.policyHash)) throw new TypeError("invalid_cancellation_input"); return ack(await post(appointmentId, "cancel", { commandId: input.commandId, expectedVersion: input.expectedVersion, operatorRequestId: input.operatorRequestId, policyHash: input.policyHash }, input.commandId), merchantId, appointmentId, input.expectedVersion); },
      async preview(appointmentId: string, input: ReschedulePreviewInput, options: ServiceReadOptions = {}) { version(input.expectedVersion); const body = { expectedVersion: input.expectedVersion, destination: destination(input.destination) }; return quote(await post(appointmentId, "reschedule-quote", body, undefined, options), merchantId, appointmentId, body); },
      async reschedule(appointmentId: string, input: RescheduleInput) { command(input); version(input.expectedVersion); if (!id(input.operatorRequestId) || !digest(input.policyHash) || !digest(input.acceptedQuoteHash)) throw new TypeError("invalid_reschedule_input"); const body = { expectedVersion: input.expectedVersion, destination: destination(input.destination), commandId: input.commandId, operatorRequestId: input.operatorRequestId, policyHash: input.policyHash, acceptedQuoteHash: input.acceptedQuoteHash }; return ack(await post(appointmentId, "reschedule", body, input.commandId), merchantId, appointmentId, input.expectedVersion); },
      async receipt(appointmentId: string, input: AttendanceReceiptInput): Promise<OperationAck> {
        command(input); version(input.expectedPaymentVersion);
        if (!id(input.paymentId) || !integer(input.amountCents, 1) || !currency(input.currency) || typeof input.paymentMethod !== "string" || !input.paymentMethod.trim() || input.paymentMethod.length > 64 || /[\x00-\x1f\x7f]/.test(input.paymentMethod)) throw new TypeError("invalid_attendance_receipt_input");
        const body = { commandId: input.commandId, paymentId: input.paymentId, expectedPaymentVersion: input.expectedPaymentVersion, amountCents: input.amountCents, currency: input.currency, paymentMethod: input.paymentMethod.trim() };
        const value = await post(appointmentId, "attendance-receipts", body, input.commandId);
        if (!object(value) || value.source !== "recorded_at_attendance" || typeof value.replayed !== "boolean" || !object(value.receipt) || !object(value.payment)) return invalid();
        const r = value.receipt, p = value.payment;
        if (!id(r.id) || r.appointmentPaymentId !== input.paymentId || r.amountCents !== input.amountCents || r.currency !== input.currency || r.paymentMethod !== body.paymentMethod || r.operatorId !== userId || !instant(r.receivedAt)
          || p.id !== input.paymentId || p.appointmentId !== appointmentId || p.mode !== "at_attendance" || !integer(p.version, input.expectedPaymentVersion + 1) || !integer(p.amountCents, 1) || p.currency !== input.currency
          || !["pending", "approved", "failed", "cancelled", "refunded", "partially_refunded"].includes(p.status as string) || p.receivedAt !== null && !instant(p.receivedAt)) return invalid();
        return { appointmentId, paymentId: input.paymentId, paymentVersion: p.version, replayed: value.replayed };
      },
    };
  } };
}
