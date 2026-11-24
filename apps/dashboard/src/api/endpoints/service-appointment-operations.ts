import type { ServiceAppointmentAdminState } from "@zyon/shared-types";
import type { MerchantProfile } from "../types.js";
import { dashboardJson } from "../http/client.js";
import { DashboardJsonParseError } from "../http/error.js";
import type { ServiceReadOptions } from "./service-attendance.js";

export interface ManualServiceAppointmentInput {
  commandId: string;
  professionalId: string;
  productId: string;
  variantId: string;
  expectedProfessionalVersion: number;
  expectedPolicyVersion: number;
  startsAt: string;
  customer: { kind: "known"; customerId: string } | { kind: "contact"; name: string; phone?: string; email?: string };
  explicitOneOff?: { reason?: string };
}
export interface ManualServiceAppointmentReceipt {
  replayed: boolean;
  professionalVersion: number;
  availabilityExceptionId: string | null;
  appointment: { id: string; merchantId: string; professionalId: string; productId: string; variantId: string;
    version: number; operationalStatus: ServiceAppointmentAdminState };
}
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const id = (value: unknown): value is string => typeof value === "string" && !!value && value.trim() === value && value.length <= 191
  && value !== "." && value !== ".." && !/[\x00-\x1f\x7f]/.test(value);
const version = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value > 0;
const text = (value: unknown, max: number): value is string => typeof value === "string" && !!value.trim() && value.length <= max && !/[\x00-\x1f\x7f]/.test(value);
function body(input: ManualServiceAppointmentInput): ManualServiceAppointmentInput {
  if (!object(input) || ![input.commandId, input.professionalId, input.productId, input.variantId].every(id)
    || !version(input.expectedProfessionalVersion) || !version(input.expectedPolicyVersion)
    || typeof input.startsAt !== "string" || !/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(input.startsAt) || !Number.isFinite(Date.parse(input.startsAt))
    || !object(input.customer)) throw new TypeError("invalid_manual_service_appointment");
  let customer: ManualServiceAppointmentInput["customer"];
  if (input.customer.kind === "known" && id(input.customer.customerId)) customer = { kind: "known", customerId: input.customer.customerId };
  else if (input.customer.kind === "contact" && text(input.customer.name, 200)
    && (input.customer.phone !== undefined || input.customer.email !== undefined)
    && (input.customer.phone === undefined || text(input.customer.phone, 32)) && (input.customer.email === undefined || text(input.customer.email, 254)))
    customer = { kind: "contact", name: input.customer.name, ...(input.customer.phone === undefined ? {} : { phone: input.customer.phone }),
      ...(input.customer.email === undefined ? {} : { email: input.customer.email }) };
  else throw new TypeError("invalid_manual_service_customer");
  if (input.explicitOneOff !== undefined && (!object(input.explicitOneOff) || input.explicitOneOff.reason !== undefined
    && (typeof input.explicitOneOff.reason !== "string" || input.explicitOneOff.reason.length > 1200))) throw new TypeError("invalid_manual_service_one_off");
  return { commandId: input.commandId, professionalId: input.professionalId, productId: input.productId, variantId: input.variantId,
    expectedProfessionalVersion: input.expectedProfessionalVersion, expectedPolicyVersion: input.expectedPolicyVersion, startsAt: input.startsAt, customer,
    ...(input.explicitOneOff === undefined ? {} : { explicitOneOff: input.explicitOneOff.reason === undefined ? {} : { reason: input.explicitOneOff.reason } }) };
}
function receipt(value: unknown, merchantId: string, input: ManualServiceAppointmentInput): ManualServiceAppointmentReceipt {
  const invalid = (): never => { throw new DashboardJsonParseError("invalid_manual_service_receipt"); };
  if (!object(value) || typeof value.replayed !== "boolean" || !version(value.professionalVersion)
    || value.availabilityExceptionId !== null && !id(value.availabilityExceptionId) || !object(value.appointment)) return invalid();
  const row = value.appointment;
  if (!id(row.id) || row.merchantId !== merchantId || !id(row.professionalId) || !value.replayed && row.professionalId !== input.professionalId || row.productId !== input.productId
    || row.variantId !== input.variantId || !version(row.version) || !["pending", "scheduled", "in_service", "completed", "no_show", "cancelled"].includes(row.operationalStatus as string)) return invalid();
  return { replayed: value.replayed, professionalVersion: value.professionalVersion, availabilityExceptionId: value.availabilityExceptionId as string | null,
    appointment: { id: row.id, merchantId, professionalId: row.professionalId, productId: input.productId, variantId: input.variantId,
      version: row.version, operationalStatus: row.operationalStatus as ServiceAppointmentAdminState } };
}

export function serviceAppointmentOperationEndpoints(base: string, fetchImpl: typeof fetch) {
  return {
    serviceAppointmentOperations(profile: Pick<MerchantProfile, "id" | "user_id">) {
      if (!profile || !id(profile.id) || !id(profile.user_id)) throw new TypeError("authenticated_service_profile_required");
      const merchantId = profile.id, path = `/merchants/${encodeURIComponent(merchantId)}/service-appointments`;
      return {
        async createManual(value: ManualServiceAppointmentInput, options: ServiceReadOptions = {}): Promise<ManualServiceAppointmentReceipt> {
          const input = body(value);
          const result = await dashboardJson<unknown>(base, path + "/manual", { method: "POST", jsonBody: input,
            headers: { "Idempotency-Key": input.commandId }, signal: options.signal }, fetchImpl);
          return receipt(result, merchantId, input);
        },
      };
    },
  };
}
