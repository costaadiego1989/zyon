import { z } from "zod";

const id = z.string().min(1).max(191).refine(value => value.trim() === value && !value.includes("\0"));
export const CHECKOUT_BUYER_IDENTITY_DETACHMENT_PROTOCOL = "checkout_buyer_identity_detachment_v1";
/** Reference-only proof of revocation and an anonymous principal. This is NOT
 * an OTP result, account/email verification, payment or coupon permission. */
export const checkoutBuyerIdentityDetachmentSchema = z.strictObject({ protocol: z.literal(CHECKOUT_BUYER_IDENTITY_DETACHMENT_PROTOCOL),
  merchantId: id, sessionId: id, fromBuyerId: id,
  toBuyerId: z.string().regex(/^usr_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/),
  fromVersion: z.number().int().positive(), toVersion: z.number().int().positive(),
  acceptanceEventIds: z.array(id).min(1).max(200), basisHash: z.string().regex(/^[a-f0-9]{64}$/), detachedAt: z.iso.datetime({ offset: true }),
}).superRefine((value, context) => {
  if (value.fromBuyerId === value.toBuyerId || value.toVersion !== value.fromVersion + 1
    || new Set(value.acceptanceEventIds).size !== value.acceptanceEventIds.length
    || value.acceptanceEventIds.some((id, index) => id !== [...value.acceptanceEventIds].sort()[index]))
    context.addIssue({ code: "custom", message: "identity_detachment_invalid" });
});
export type CheckoutBuyerIdentityDetachment = z.output<typeof checkoutBuyerIdentityDetachmentSchema>;
