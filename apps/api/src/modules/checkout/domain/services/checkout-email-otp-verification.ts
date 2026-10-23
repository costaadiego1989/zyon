import { z } from "zod";
const reference = z.string().min(1).max(191).refine(value => value.trim() === value && !value.includes("\0"));
export const checkoutEmailOtpVerificationScopeSchema = z.strictObject({ merchantId: reference, sessionId: reference });
export const checkoutEmailOtpVerificationCommandSchema = z.strictObject({ expectedVersion: z.number().int().nonnegative(), code: z.string().regex(/^\d{6}$/) });
export type CheckoutEmailOtpVerificationScope = z.output<typeof checkoutEmailOtpVerificationScopeSchema>;
export type CheckoutEmailOtpVerificationCommand = z.output<typeof checkoutEmailOtpVerificationCommandSchema>;
export class CheckoutEmailOtpVerificationError extends Error {
  constructor(readonly reason: "invalid" | "expired") { super(`checkout_email_otp_${reason}`); this.name = "CheckoutEmailOtpVerificationError"; }
}
