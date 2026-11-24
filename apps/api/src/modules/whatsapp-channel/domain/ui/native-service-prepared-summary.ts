import { z } from "zod";
import { canonicalServiceSelectionSchema } from "../../../storefront/domain/contracts/service-booking-tool.schemas.js";

/** Projection of T40 prepare, not a capability or provider receipt. Kept in
 * server-owned UI state; native messages do not expose fingerprints. */
export const nativeServicePreparedSummarySchema = z.object({
  session_id: z.string().min(1).max(191), cart_fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  payment_mode: z.enum(["online", "at_attendance"]), policy_version: z.number().int().positive(), requires_hold: z.boolean(),
  service_slot_hold: z.object({ expiresAt: z.string().datetime({ offset: true }), slots: z.array(z.object({ resourceId: z.string().min(1),
    slotId: z.string().min(1), startsAt: z.string(), endsAt: z.string() })).min(1).max(100) }).nullable(),
  selections: z.array(canonicalServiceSelectionSchema.extend({ productName: z.string().min(1).max(4000), professionalName: z.string().min(1).max(4000) })).min(1).max(100),
  source_cart_fingerprint: z.string().regex(/^[a-f0-9]{64}$/).optional(),
});
export type NativeServicePreparedSummary = z.infer<typeof nativeServicePreparedSummarySchema>;
export const nativeServiceConfirmedSchema = z.strictObject({ step: z.literal("confirmed"), appointments: z.array(z.strictObject({
  id: z.string().min(1).max(191), serviceName: z.string().min(1).max(4000), professionalName: z.string().min(1).max(4000),
  startsAt: z.string().datetime({ offset: true }), endsAt: z.string().datetime({ offset: true }), timeZone: z.string().min(1).max(80),
  priceInCents: z.number().int().nonnegative(), currency: z.string().regex(/^[A-Z]{3}$/),
  operationalStatus: z.enum(["pending", "scheduled", "in_service", "completed", "no_show", "cancelled"]),
  paymentStatus: z.string().min(1).max(80),
})).min(1).max(100) });
