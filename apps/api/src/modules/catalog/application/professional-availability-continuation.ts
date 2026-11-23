import { ConflictException } from "@nestjs/common";
import type { ProfessionalCheckoutSelection } from "../../../shared/bookings/service-checkout-selection.js";
import { professionalLocalDate } from "../domain/services/professional-availability.js";
import { FIXED_SERVICE_TIME_ZONE } from "../domain/services/fixed-service-time-zone.js";

type Selection = Pick<ProfessionalCheckoutSelection, "productId" | "variantId" | "professionalId" | "professionalVersion" | "policyVersion"
  | "date" | "startsAt" | "endsAt" | "timeZone" | "durationMinutes">;
declare const continuationBrand: unique symbol;
export interface ProfessionalAvailabilityContinuation { readonly [continuationBrand]: true }
const continuations = new WeakMap<ProfessionalAvailabilityContinuation, { merchantId: string; selection: Readonly<Selection> }>();

/** In-process transport only, AFTER the caller's existing SQL/payment/lease
 * proof. This neither authenticates a caller nor grants capacity or money.
 * A public body/JSON copy cannot construct this private context. */
export function preserveVerifiedProfessionalAvailability(merchantId: string, selected: Selection): ProfessionalAvailabilityContinuation {
  const context = Object.freeze({}) as ProfessionalAvailabilityContinuation;
  continuations.set(context, { merchantId, selection: Object.freeze({ productId: selected.productId, variantId: selected.variantId,
    professionalId: selected.professionalId, professionalVersion: selected.professionalVersion, policyVersion: selected.policyVersion,
    date: selected.date, startsAt: selected.startsAt, endsAt: selected.endsAt, timeZone: selected.timeZone, durationMinutes: selected.durationMinutes }) });
  return context;
}

export function continuationAvailabilityTimeZone(context: ProfessionalAvailabilityContinuation | undefined,
  input: { merchantId: string; productId: string; variantId: string; professionalId: string; expectedVersion?: number; fromDate: string; toDate: string },
  facts: { timeZone: string; durationMinutes: number; policyVersion: number | null }): string | undefined {
  if (context === undefined) return;
  const preserved = context && typeof context === "object" ? continuations.get(context) : undefined;
  const s = preserved?.selection;
  if (!s || preserved!.merchantId !== input.merchantId || s.productId !== input.productId || s.variantId !== input.variantId
    || s.professionalId !== input.professionalId || s.professionalVersion !== input.expectedVersion || s.policyVersion !== facts.policyVersion
    || s.date !== input.fromDate || s.date !== input.toDate || s.durationMinutes !== facts.durationMinutes
    || s.timeZone !== FIXED_SERVICE_TIME_ZONE && s.timeZone !== facts.timeZone
    || Date.parse(s.endsAt) - Date.parse(s.startsAt) !== s.durationMinutes * 60_000)
    throw new ConflictException("service_timezone_continuation_conflict");
  try { if (professionalLocalDate(new Date(s.startsAt), s.timeZone) === s.date) return s.timeZone; } catch { /* no public fallback */ }
  throw new ConflictException("service_timezone_continuation_conflict");
}
