import { ConflictException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { isDeepStrictEqual } from "node:util";
import { parseCheckoutCouponBinding, type CheckoutCouponBinding } from "../../../modules/checkout/domain/services/checkout-coupon-binding.js";
import { readStoredCheckoutCouponBinding } from "../../../modules/checkout/domain/services/checkout-coupon-storage.js";
import { validateReleasedCheckoutCouponGeneration } from "./generation-release.js";

const reference = z.string().min(1).max(191);
const projection = z.array(z.strictObject({ isolation: z.literal("read committed"), candidates: z.array(z.strictObject({
  merchantId: reference, sessionId: reference, buyerId: reference, cartRef: reference, binding: z.unknown(),
})).max(100) })).length(1);

export function storefrontCartBindingConflict(): never {
  throw new ConflictException("storefront_cart_binding_conflict");
}
export function assertStorefrontCartUnbound(bound: boolean): void {
  if (bound) throw new ConflictException("storefront_cart_checkout_bound");
}

/** Caller MUST already hold this cart's advisory until commit. No checkout lock
 * may be acquired here (checkout -> cart is the global order). Fresh RC snapshot
 * is required after waiting; this read is not a binding issuer or lease alone.
 * All future lifecycle writers MUST participate in the same cart fence.
 * Bounded projection avoids returning public cart/PII/history; LIMIT 101 fails
 * closed above 100 historical candidates. Unproven released rows stay fenced;
 * only a verified immutable release receipt may remove a historical owner. */
export async function readStorefrontCheckoutBindingOwners(tx: Prisma.TransactionClient, merchantId: string, cartId: string): Promise<Array<{
  merchantId: string; sessionId: string; buyerId: string; cartRef: string; binding: CheckoutCouponBinding;
}>> {
  const result = await tx.$queryRaw`SELECT current_setting('transaction_isolation') AS isolation,
    COALESCE(jsonb_agg(candidate), '[]'::jsonb) AS candidates FROM (
      SELECT merchant_id AS "merchantId", session_id AS "sessionId", global_user_id AS "buyerId",
        cart->'cart_ref' AS "cartRef", cart->'_storefrontCouponBinding' AS binding
      FROM checkout_sessions
      WHERE merchant_id = ${merchantId} AND cart ? '_storefrontCouponBinding'
        AND (cart->'_storefrontCouponBinding'->>'cartId' = ${cartId} OR cart->>'cart_ref' = ${cartId})
      LIMIT 101
    ) candidate`;
  const parsed = projection.safeParse(result);
  if (!parsed.success) return storefrontCartBindingConflict();
  const owners = [];
  for (const owner of parsed.data[0]!.candidates) {
    let binding;
    try { binding = parseCheckoutCouponBinding(owner.binding); }
    catch { return storefrontCartBindingConflict(); }
    if (owner.merchantId !== merchantId || owner.cartRef !== cartId || binding.merchantId !== merchantId
      || binding.cartId !== cartId || binding.checkoutSessionId !== owner.sessionId || binding.buyerId !== owner.buyerId) {
      return storefrontCartBindingConflict();
    }
    if (binding.state === "released") {
      try {
        const current = await tx.checkoutSession.findUnique({ where: { merchantId_sessionId: { merchantId, sessionId: owner.sessionId } } });
        if (!current || !isDeepStrictEqual(readStoredCheckoutCouponBinding(current.cart), binding)) return storefrontCartBindingConflict();
        await validateReleasedCheckoutCouponGeneration(tx, current);
      } catch {
        // Preserve legacy read-only getOrCreate behavior, never manufacture a
        // release permission from state alone. Mutations still see an owner.
        owners.push({ ...owner, binding });
      }
    } else owners.push({ ...owner, binding });
  }
  if (owners.length > 1) return storefrontCartBindingConflict();
  return owners;
}

export async function storefrontCartHasCheckoutBinding(tx: Prisma.TransactionClient, merchantId: string, cartId: string): Promise<boolean> {
  return (await readStorefrontCheckoutBindingOwners(tx, merchantId, cartId)).length > 0;
}
