import { z } from "zod";

const id = z.string().min(1).max(200).refine(value => value.trim() === value && !/[\u0000-\u001f\u007f]/.test(value));
const uuid = z.uuid(), version = z.number().int().min(1).max(2_147_483_647);
export const checkoutEmailOtpDeliveryScopeSchema = z.strictObject({ merchantId: id, sessionId: id });
export const checkoutEmailOtpIssueRequestSchema = z.strictObject({
  expectedVersion: version.max(2_147_483_646), action: z.enum(["issue", "resend"]),
});
export const checkoutEmailOtpDeliveryRequestSchema = z.strictObject({ expectedVersion: version, deliveryId: uuid });
export const checkoutEmailOtpDeliveryAcknowledgementSchema = checkoutEmailOtpDeliveryScopeSchema.extend({
  version: z.literal(1), deliveryId: uuid, persistenceVersion: version,
  status: z.enum(["pending", "sent", "unknown", "cancelled"]),
});
export const checkoutEmailOtpIssueAcknowledgementSchema = checkoutEmailOtpDeliveryAcknowledgementSchema.extend({ status: z.literal("pending") });
const settled = checkoutEmailOtpDeliveryAcknowledgementSchema.extend({ kind: z.literal("settled"),
  status: z.enum(["sent", "unknown", "cancelled"]),
});
/** SERVER-ONLY, returned only after a durable claim commits. Not an HTTP DTO,
 * event payload, public ACK or bearer capability; Zod is not issuance proof. */
const claimed = checkoutEmailOtpDeliveryScopeSchema.extend({ version: z.literal(1), kind: z.literal("claimed"),
  deliveryId: uuid, persistenceVersion: version, claimToken: uuid,
  email: z.email().max(254), code: z.string().regex(/^\d{6}$/), expiresAt: z.iso.datetime({ offset: true }),
  merchantName: z.string().max(200).optional(),
});
export const checkoutEmailOtpDeliveryClaimSchema = z.discriminatedUnion("kind", [claimed, settled]);
export const checkoutEmailOtpDeliveryOutcomeSchema = z.discriminatedUnion("status", [
  z.strictObject({ status: z.literal("sent"), providerMessageId: z.string().trim().min(1).max(500) }),
  z.strictObject({ status: z.literal("unknown") }),
]);
export const checkoutEmailOtpDeliveryCompletionSchema = z.strictObject({
  deliveryId: uuid, claimToken: uuid, outcome: checkoutEmailOtpDeliveryOutcomeSchema,
});
export type CheckoutEmailOtpDeliveryScope = z.infer<typeof checkoutEmailOtpDeliveryScopeSchema>;
export type CheckoutEmailOtpIssueRequest = z.infer<typeof checkoutEmailOtpIssueRequestSchema>;
export type CheckoutEmailOtpDeliveryRequest = z.infer<typeof checkoutEmailOtpDeliveryRequestSchema>;
export type CheckoutEmailOtpDeliveryAcknowledgement = z.infer<typeof checkoutEmailOtpDeliveryAcknowledgementSchema>;
export type CheckoutEmailOtpIssueAcknowledgement = z.infer<typeof checkoutEmailOtpIssueAcknowledgementSchema>;
export type CheckoutEmailOtpDeliveryClaim = z.infer<typeof checkoutEmailOtpDeliveryClaimSchema>;
export type CheckoutEmailOtpDeliveryCompletion = z.infer<typeof checkoutEmailOtpDeliveryCompletionSchema>;
