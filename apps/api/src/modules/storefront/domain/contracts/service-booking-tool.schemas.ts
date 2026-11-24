import { z } from "zod";

const id = z.string().min(1).max(191).refine(value => value.trim() === value && !/[\x00-\x1f\x7f]/.test(value));
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const parsed = new Date(value + "T12:00:00Z"); return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
});
const time = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);
const version = z.number().int().min(1).max(2_147_483_647);
const text = z.string().max(4000);
const offer = { productId: id, variantId: id };
const professional = { ...offer, professionalId: id };
const dateHint = z.discriminatedUnion("kind", [z.strictObject({ kind: z.literal("absolute"), value: date }),
  z.strictObject({ kind: z.literal("relative"), value: z.enum(["today", "tomorrow", "day_after_tomorrow"]) }),
  z.strictObject({ kind: z.literal("ambiguous"), values: z.array(date).max(31).optional() })]);
const timeHint = z.discriminatedUnion("kind", [z.strictObject({ kind: z.literal("exact"), value: time }),
  z.strictObject({ kind: z.literal("ambiguous"), values: z.array(time).max(24).optional() })]);
export const serviceBookingArgumentSchemas = {
  get_service_professionals: z.strictObject(offer),
  get_service_dates: z.strictObject({ ...professional, fromDate: date, toDate: date }),
  get_service_slots: z.strictObject({ ...professional, date }),
  resolve_service_selection: z.strictObject({ ...offer, professionalName: z.string().trim().min(1).max(500), date: dateHint.optional(), time: timeHint.optional() }),
} as const;
export type ServiceBookingToolName = keyof typeof serviceBookingArgumentSchemas;
export const canonicalServiceSelectionSchema = z.object({ ...professional, professionalVersion: version, policyVersion: version, date,
  startsAt: z.string().datetime({ offset: true }), endsAt: z.string().datetime({ offset: true }), timeZone: z.string().min(1).max(80),
  durationMinutes: z.number().int().min(5).max(480), priceInCents: z.number().int().min(0).max(2_147_483_647), currency: z.string().regex(/^[A-Z]{3}$/), slotId: z.string().regex(/^[a-f0-9]{64}$/) });
export const canonicalServiceProfessionalsSchema = z.object({ professionals: z.array(z.object({ id, name: text, version, timeZone: text,
  profile: z.object({ description: text.optional(), specialties: z.array(text).max(20).optional() }).optional() })).max(50), has_more: z.boolean() });
export const canonicalServiceDatesSchema = z.object({ dates: z.array(date).max(31), professional_version: version, policy_version: version, time_zone: text });
export const canonicalServiceSlotsSchema = z.object({ selections: z.array(canonicalServiceSelectionSchema).max(300) });
export const canonicalServiceReviewSchema = z.object({ selection: canonicalServiceSelectionSchema,
  service: z.object({ name: text }), professional: z.object({ name: text }),
  policy: z.object({ version, paymentMode: z.enum(["online", "at_attendance"]), holdEnabled: z.boolean(), holdMinutes: z.number().int().positive().nullable() }) });
const choice = canonicalServiceSelectionSchema.extend({ merchantId: id, productName: text, professionalName: text });
const person = z.object({ merchantId: id, ...professional, professionalName: text, professionalVersion: version });
const safe = { requiresRevalidation: z.literal(true), authorizesPayment: z.literal(false), authorizesConfirmation: z.literal(false) };
// Navigation only, derived from published canonical reads. Never command authority.
export const serviceBookingPublicContextSchema = z.strictObject({ ...offer, serviceName: text,
  professional: z.strictObject({ id, version, name: text.optional() }).optional() });
const context = serviceBookingPublicContextSchema.optional();
const resolution = z.union([
  z.object({ kind: z.literal("resolved"), selection: choice, displayDate: date, displayTime: time, displayTimeZone: z.literal("America/Sao_Paulo"), sourceAsOf: text, ...safe }),
  z.object({ kind: z.literal("clarification"), reason: z.enum(["choose_current_option", "choose_professional", "choose_date", "choose_time", "no_current_match", "refresh_current_options", "more_current_options", "more_current_professionals"]),
    options: z.array(choice).max(20), professionals: z.array(person).max(20), hasMore: z.boolean(), previous: choice.optional(), sourceAsOf: text.optional(), ...safe }),
  z.object({ kind: z.literal("unchanged"), selection: choice.optional(), ...safe }),
]);
export const serviceBookingResultSchema = z.union([
  z.strictObject({ kind: z.literal("authentication_required"), action: z.literal("authenticate") }),
  canonicalServiceProfessionalsSchema.extend({ kind: z.literal("professionals"), context }).strict(),
  canonicalServiceDatesSchema.extend({ kind: z.literal("dates"), context }).strict(),
  z.strictObject({ kind: z.literal("slots"), context, selections: z.array(canonicalServiceSelectionSchema).max(100), has_more: z.boolean() }),
  z.strictObject({ kind: z.literal("selection_resolution"), context, resolution }),
  z.strictObject({ kind: z.literal("selection"), context, selection: canonicalServiceSelectionSchema, serviceName: text, professionalName: text,
    policy: canonicalServiceReviewSchema.shape.policy, action: z.literal("review_service_booking"), ...safe }),
]);
export type ServiceBookingResult = z.infer<typeof serviceBookingResultSchema>;
export function parseCanonicalServiceResult<T>(schema: z.ZodType<T>, value: unknown): T {
  if (value && typeof value === "object" && (Object.hasOwn(value, "error") || ("ok" in value && value.ok === false) || ("success" in value && value.success === false)))
    throw new Error("invalid_service_booking_output");
  const result = schema.safeParse(value); if (!result.success) throw new Error("invalid_service_booking_output"); return result.data;
}
