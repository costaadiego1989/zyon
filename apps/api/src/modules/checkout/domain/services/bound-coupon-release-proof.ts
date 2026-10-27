import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { parseCheckoutCouponBinding, type CheckoutCouponBinding } from "./checkout-coupon-binding.js";
import { readPaymentCouponAuthority } from "../../../payment/domain/payment-coupon-authority.js";
import { isPaymentCreationRejectionCode } from "../../../payment/domain/payment-creation-rejected.error.js";

const reference = z.string().min(1).max(191).refine(value => value.trim().length > 0 && !value.includes("\0"));
const noLease = z.nullish(z.never());
const journalInput = z.object({ intentId: reference, merchantId: reference, sessionId: reference,
  amountCents: z.number().int().positive().max(Number.MAX_SAFE_INTEGER), currency: z.literal("BRL"),
  method: z.enum(["pix", "card", "boleto", "crypto"]) });
const cancellation = z.object({ operationId: reference, idempotencyKey: reference, buyerId: reference,
  providerPaymentId: reference, startedAt: z.iso.datetime({ offset: true }), mutationAttemptedAt: z.iso.datetime({ offset: true }).optional(),
  state: z.literal("cancelled"), leaseToken: noLease, leaseUntil: noLease });
const payment = z.object({ id: reference, merchantId: reference, sessionId: reference,
  amountCents: z.number().int().positive().max(Number.MAX_SAFE_INTEGER), currency: z.literal("BRL"),
  method: z.enum(["pix", "card", "boleto", "crypto"]), status: z.enum(["failed", "cancelled"]),
  providerPaymentId: reference.nullish(), approvedAmountCents: z.literal(0).nullish(),
  creation: z.object({ state: z.literal("complete"), input: z.unknown(), couponAuthority: z.unknown().optional(),
    reason: z.string().optional(), leaseToken: noLease, leaseUntil: noLease, cancellation: cancellation.optional() }),
});
const paymentsSchema = z.array(payment).min(1).max(1000);

function unconfirmed(): never { throw new Error("checkout_coupon_release_unconfirmed"); }

/** Pure evidence check, not a provider cancellation or a lease. The dedicated
 * release transaction must lock/re-read ALL journals and the completed order,
 * compare exact source/reservation and atomically persist its receipt/tombstone.
 * An absent payment or terminal status label is never sufficient evidence. */
export function assertBoundCouponReleasePaymentsResolved(rawBinding: CheckoutCouponBinding, rawPayments: unknown): void {
  try {
    const binding = parseCheckoutCouponBinding(rawBinding);
    if (binding.state !== "active") return unconfirmed();
    const { state: _state, ...identity } = binding;
    const payments = paymentsSchema.parse(rawPayments);
    let matching = 0;
    for (const row of payments) {
      if (row.merchantId !== binding.merchantId || row.sessionId !== binding.checkoutSessionId) return unconfirmed();
      const authority = readPaymentCouponAuthority(row);
      const input = journalInput.parse(row.creation.input);
      if (input.intentId !== row.id || input.merchantId !== row.merchantId || input.sessionId !== row.sessionId
        || input.amountCents !== row.amountCents || input.currency !== row.currency || input.method !== row.method) return unconfirmed();
      if (authority?.bindingId === binding.bindingId) {
        if (!isDeepStrictEqual(authority, identity)) return unconfirmed();
        matching++;
      }
      if (row.status === "failed") {
        if (row.providerPaymentId || row.creation.cancellation || !isPaymentCreationRejectionCode(row.creation.reason)) return unconfirmed();
      } else {
        const receipt = row.creation.cancellation;
        if (!row.providerPaymentId || !receipt || receipt.providerPaymentId !== row.providerPaymentId
          || receipt.buyerId !== (authority?.buyerId ?? binding.buyerId)) return unconfirmed();
      }
    }
    if (!matching) return unconfirmed();
  } catch { return unconfirmed(); }
}
