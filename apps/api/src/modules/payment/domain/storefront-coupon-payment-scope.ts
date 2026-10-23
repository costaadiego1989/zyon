import { z } from "zod";

const identifier = z.string().min(1).max(191).refine(value => value === value.trim());
export const storefrontCouponPaymentScopeSchema = z.strictObject({
  merchantId: identifier, checkoutSessionId: identifier, cartId: identifier, buyerId: identifier,
});
/** Internal verified embed context, never a public request or PSP input. */
export type StorefrontCouponPaymentScope = z.infer<typeof storefrontCouponPaymentScopeSchema>;
export function parseStorefrontCouponPaymentScope(input: unknown): StorefrontCouponPaymentScope {
  try { return storefrontCouponPaymentScopeSchema.parse(input); }
  catch { throw new Error("payment_coupon_authority_conflict"); }
}
