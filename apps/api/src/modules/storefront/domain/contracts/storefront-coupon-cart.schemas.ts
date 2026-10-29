import { z } from "zod";
import { storefrontWriteScopeSchema } from "./storefront-local-cart-write.schemas.js";
import { storefrontToolOutputSchemas } from "./storefront-tool-output.schemas.js";
const id = storefrontWriteScopeSchema.shape.cartId;
export const storefrontCouponCartScopeSchema = storefrontWriteScopeSchema.pick({ merchantId: true, cartId: true });
export const storefrontCouponCartInputSchema = z.strictObject({ code: z.string().trim().min(1).max(191)
  .refine(value => !value.includes("\0")).transform(value => value.toUpperCase()), trustedBuyerGlobalUserId: id.optional() });
const success = storefrontToolOutputSchemas.apply_coupon.options[1];
const applied = success.strict().extend({ reason: z.literal("success"),
  items: z.array(success.shape.items.element.strict()).max(200),
}).superRefine((value, ctx) => {
  const toCents = (value: number) => Math.round(value * 100);
  const subtotal = value.items.reduce((sum, line) => sum + BigInt(toCents(line.unitPrice)) * BigInt(line.quantity), 0n);
  if (!Number.isSafeInteger(value.discountCents) || value.discountCents > 2_147_483_647
    || toCents(value.discount) !== value.discountCents || toCents(value.total) > 2_147_483_647
    || subtotal !== BigInt(toCents(value.total)) || toCents(value.total) - value.discountCents !== toCents(value.newTotal)
    || value.items.some(line => line.quantity > 99 || toCents(line.lineTotal) !== toCents(line.unitPrice) * line.quantity)
    || value.itemCount !== value.items.reduce((sum, line) => sum + line.quantity, 0)) {
    ctx.addIssue({ code: "custom", message: "storefront_coupon_result_inconsistent" });
  }
});
export const storefrontCouponCartResultSchema = z.discriminatedUnion("applied", [storefrontToolOutputSchemas.apply_coupon.options[0].strict(), applied]);
export type StorefrontCouponCartScope = z.infer<typeof storefrontCouponCartScopeSchema>;
export type StorefrontCouponCartInput = z.input<typeof storefrontCouponCartInputSchema>;
export type StorefrontCouponCartResult = z.infer<typeof storefrontCouponCartResultSchema>;

