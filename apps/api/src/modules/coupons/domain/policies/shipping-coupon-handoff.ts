import { isDeepStrictEqual } from "node:util";
import { z } from "zod";

// Separate V2 contract; it deliberately does NOT widen the V1 goods-only parser,
// storage boundary, issuer, payment journal or generic cart writers.
const ref = z.string().min(1).max(191).refine(value => value.trim() === value && !value.includes("\0"));
const cents = z.number().int().nonnegative().max(2_147_483_647);
const shippingSchema = z.strictObject({ quoteKey: ref, destination: ref, expiresAt: z.iso.datetime({ offset: true }),
  originalPriceCents: cents, realCostCents: cents, discountCents: cents.min(1), priceCents: cents,
}).refine(value => BigInt(value.originalPriceCents) - BigInt(value.discountCents) === BigInt(value.priceCents));
const identitySchema = z.strictObject({ version: z.literal(2), bindingId: z.uuidv4(), merchantId: ref, cartId: ref, checkoutSessionId: ref,
  buyerId: ref, reservationBuyerId: ref.nullable(), couponId: ref, redemptionId: ref, discountCents: z.literal(0),
  basisHash: z.string().length(64).regex(/^[0-9a-f]{64}$/), shipping: shippingSchema,
}).refine(value => value.reservationBuyerId === null || value.reservationBuyerId === value.buyerId);
const bindingSchema = z.discriminatedUnion("state", [
  identitySchema.extend({ state: z.literal("active") }),
  identitySchema.extend({ state: z.literal("released") }),
  identitySchema.extend({ state: z.literal("redeemed"), orderId: ref }),
]);
const orderSchema = identitySchema.extend({ orderId: ref });
const redemptionSchema = z.strictObject({ id: ref, merchantId: ref, sessionId: ref, couponId: ref, buyerGlobalUserId: ref.nullable(),
  discountCents: z.literal(0), status: z.enum(["applied", "redeemed", "cancelled"]), orderId: ref.nullable(),
}).refine(value => value.status === "redeemed" ? value.orderId !== null : value.orderId === null);
const planSchema = z.strictObject({ binding: bindingSchema, orderAuthority: orderSchema, redemption: redemptionSchema });
export const shippingCouponRedemptionPlanSchema = z.strictObject({ version: z.literal(2), kind: z.enum(["redeem", "already_redeemed"]),
  merchantId: ref, checkoutSessionId: ref, cartId: ref, redemptionId: ref, couponId: ref, orderId: ref,
  discountCents: z.literal(0), shippingDiscountCents: cents.min(1) });
export type ShippingCouponPaymentAuthority = z.output<typeof identitySchema>;
export type ShippingCouponBinding = z.output<typeof bindingSchema>;
export type ShippingCouponOrderAuthority = z.output<typeof orderSchema>;

function conflict(): never { throw new Error("shipping_coupon_binding_conflict"); }
function checked<S extends z.ZodType>(schema: S, value: unknown): z.output<S> {
  try { const result = schema.safeParse(value); if (result.success) return result.data; } catch { /* fixed boundary */ }
  return conflict();
}
function identity(value: ShippingCouponBinding | ShippingCouponOrderAuthority): ShippingCouponPaymentAuthority {
  return checked(identitySchema, Object.fromEntries(Object.keys(identitySchema.shape).map(key => [key, Reflect.get(value, key)])));
}

/** Detached immutable-source snapshot shape, NOT proof, issuer or permission. */
export function parseShippingCouponPaymentAuthority(raw: unknown): ShippingCouponPaymentAuthority {
  return checked(identitySchema, raw);
}
export function parseShippingCouponBinding(raw: unknown): ShippingCouponBinding { return checked(bindingSchema, raw); }
export function parseShippingCouponOrderAuthority(raw: unknown): ShippingCouponOrderAuthority { return checked(orderSchema, raw); }

/** Dedicated fenced commands must issue/release/redeem V2. Generic saves may
 * neither add/remove a generation nor change its source, quote or lifecycle. */
export function assertShippingCouponBindingPreserved(current: unknown, next: unknown): void {
  if (current === undefined && next === undefined) return;
  const before = parseShippingCouponBinding(current), after = parseShippingCouponBinding(next);
  if (!isDeepStrictEqual(before, after)) return conflict();
}

/** Pure plan. A real adapter must validate admitted payment + frozen order
 * source and atomically CAS exact redemption, binding, usage and outbox. Expiry
 * belongs to fenced admission/first-send, never a late paid-event quota leak. */
export function planShippingCouponRedemption(raw: unknown): z.output<typeof shippingCouponRedemptionPlanSchema> {
  const { binding, orderAuthority, redemption } = checked(planSchema, raw);
  if (!isDeepStrictEqual(identity(binding), identity(orderAuthority)) || binding.state === "released"
    || redemption.id !== binding.redemptionId || redemption.merchantId !== binding.merchantId
    || redemption.sessionId !== binding.cartId || redemption.couponId !== binding.couponId
    || redemption.buyerGlobalUserId !== binding.reservationBuyerId || redemption.status === "cancelled"
    || binding.state === "redeemed" && (binding.orderId !== orderAuthority.orderId || redemption.status !== "redeemed")
    || redemption.status === "redeemed" && redemption.orderId !== orderAuthority.orderId) return conflict();
  return checked(shippingCouponRedemptionPlanSchema, { version: 2, kind: redemption.status === "redeemed" ? "already_redeemed" : "redeem", merchantId: binding.merchantId,
    checkoutSessionId: binding.checkoutSessionId, cartId: binding.cartId, redemptionId: binding.redemptionId,
    couponId: binding.couponId, orderId: orderAuthority.orderId, discountCents: 0, shippingDiscountCents: binding.shipping.discountCents });
}
