import { z } from "zod";

// Internal contract only. Nothing here issues a binding, reads storage or proves
// ownership. Future adapters must capture these snapshots under the same fence
// and retain the order authority immutably, not reconstruct it from a live cart.
const reference = z.string().min(1).max(191).refine(value => value.trim().length > 0 && !value.includes("\0"));
const positiveCents = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER);
const identityShape = {
  version: z.literal(1),
  bindingId: z.uuidv4(),
  merchantId: reference,
  cartId: reference,
  checkoutSessionId: reference,
  buyerId: reference,
  reservationBuyerId: reference.nullable(),
  redemptionId: reference,
  couponId: reference,
  discountCents: positiveCents,
  basisHash: z.string().length(64).regex(/^[0-9a-f]{64}$/),
};
const identitySchema = z.strictObject(identityShape);
type BindingIdentity = z.output<typeof identitySchema>;

function reservationBuyerMatches(identity: BindingIdentity): boolean {
  return identity.reservationBuyerId === null || identity.reservationBuyerId === identity.buyerId;
}

const bindingSchema = z.discriminatedUnion("state", [
  z.strictObject({ ...identityShape, state: z.literal("active") }),
  z.strictObject({ ...identityShape, state: z.literal("released") }),
  z.strictObject({ ...identityShape, state: z.literal("redeemed"), orderId: reference }),
]).refine(reservationBuyerMatches);
const orderAuthoritySchema = z.strictObject({ ...identityShape, orderId: reference }).refine(reservationBuyerMatches);
const redemptionSchema = z.strictObject({
  id: reference,
  merchantId: reference,
  sessionId: reference,
  couponId: reference,
  buyerGlobalUserId: reference.nullable(),
  discountCents: positiveCents,
  status: z.enum(["applied", "redeemed", "cancelled"]),
  orderId: reference.nullable(),
}).refine(row => row.status === "redeemed" ? row.orderId !== null : row.orderId === null);
const planInputSchema = z.strictObject({
  binding: bindingSchema,
  orderAuthority: orderAuthoritySchema,
  redemption: redemptionSchema,
});

export type CheckoutCouponBinding = z.output<typeof bindingSchema>;
export type CheckoutCouponPaymentAuthority = z.output<typeof identitySchema>;
export type CheckoutCouponOrderAuthority = z.output<typeof orderAuthoritySchema>;
export type BoundCouponRedemptionPlan = {
  kind: "redeem" | "already_redeemed";
  merchantId: string;
  checkoutSessionId: string;
  cartId: string;
  redemptionId: string;
  couponId: string;
  orderId: string;
  discountCents: number;
};

function conflict(): never {
  throw new Error("checkout_coupon_binding_conflict");
}

function parseSnapshot<Schema extends z.ZodType>(schema: Schema, value: unknown): z.output<Schema> {
  try {
    const result = schema.safeParse(value);
    if (result.success) return result.data;
  } catch {
    // Accessors/proxies can throw before validation; never expose their payload.
  }
  return conflict();
}

function sameIdentity(left: BindingIdentity, right: BindingIdentity): boolean {
  return (Object.keys(identityShape) as Array<keyof BindingIdentity>).every(key => left[key] === right[key]);
}

/** Strict detached snapshot, with no coercion, normalization or raw Zod errors. */
export function parseCheckoutCouponBinding(value: unknown): CheckoutCouponBinding {
  return parseSnapshot(bindingSchema, value);
}

/** Snapshot frozen by the order publisher, not a grant from request metadata. */
export function parseCheckoutCouponOrderAuthority(value: unknown): CheckoutCouponOrderAuthority {
  return parseSnapshot(orderAuthoritySchema, value);
}

/** Frozen journal identity, not a binding issuer or proof of ownership. No
 * lifecycle state or order reference may be smuggled into this snapshot. */
export function parseCheckoutCouponPaymentAuthority(value: unknown): CheckoutCouponPaymentAuthority {
  const identity = parseSnapshot(identitySchema, value);
  if (!reservationBuyerMatches(identity)) return conflict();
  return identity;
}

/** Generic saves cannot introduce, erase or transition a canonical binding.
 * Dedicated fenced commands must handle issuance/release/redemption separately. */
export function assertCheckoutCouponBindingPreserved(current: unknown, next: unknown): void {
  if (current === undefined && next === undefined) return;
  const before = parseCheckoutCouponBinding(current);
  const after = parseCheckoutCouponBinding(next);
  if (!sameIdentity(before, after) || before.state !== after.state) return conflict();
  if (before.state === "redeemed" && (after.state !== "redeemed" || before.orderId !== after.orderId)) return conflict();
}

/** Plan only: the caller must perform exact-row CAS, usage increment, binding
 * transition and outbox in ONE transaction. A returned plan is not a receipt.
 * V1 covers item-discount coupons, not shipping benefits with zero item discount. */
export function planBoundCouponRedemption(input: unknown): BoundCouponRedemptionPlan {
  const { binding, orderAuthority, redemption } = parseSnapshot(planInputSchema, input);
  if (!sameIdentity(binding, orderAuthority)
    || binding.state === "released"
    || redemption.id !== binding.redemptionId
    || redemption.merchantId !== binding.merchantId
    || redemption.sessionId !== binding.cartId
    || redemption.couponId !== binding.couponId
    || redemption.buyerGlobalUserId !== binding.reservationBuyerId
    || redemption.discountCents !== binding.discountCents
    || redemption.status === "cancelled") return conflict();

  const orderId = orderAuthority.orderId;
  if (binding.state === "redeemed" && binding.orderId !== orderId) return conflict();
  if (redemption.status === "redeemed" && redemption.orderId !== orderId) return conflict();
  if (binding.state === "redeemed" && redemption.status !== "redeemed") return conflict();

  return {
    kind: redemption.status === "redeemed" ? "already_redeemed" : "redeem",
    merchantId: binding.merchantId,
    checkoutSessionId: binding.checkoutSessionId,
    cartId: binding.cartId,
    redemptionId: binding.redemptionId,
    couponId: binding.couponId,
    orderId,
    discountCents: binding.discountCents,
  };
}
