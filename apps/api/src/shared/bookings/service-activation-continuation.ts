import { ConflictException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { isDeepStrictEqual } from "node:util";
import { assertServiceActivationWithin } from "./service-activation-readiness.js";
import { captureAppointmentLease } from "./appointment-lease-proof.js";
import { readProfessionalCheckoutSelections, professionalHoldRequests, type ProfessionalCheckoutSelection, type ProfessionalSelectionCart } from "./service-checkout-selection.js";
import type { RedisServiceSlots } from "./redis-service-slots.js";
import { stripStoredCheckoutCouponBinding } from "../../modules/checkout/domain/services/checkout-coupon-storage.js";

interface AcceptedCheckoutTerms {
  sessionId: string;
  selections: ProfessionalCheckoutSelection[];
  cart?: ProfessionalSelectionCart["cart"];
  store: () => Pick<RedisServiceSlots, "assertActive">;
  now: Date;
}
/** Existing T26/T112 SQL+original active Redis generation. This is only a
 * release-readiness continuation; it grants no buyer/payment/admission scope. */
async function hasAcceptedCheckoutLease(tx: Prisma.TransactionClient, merchantId: string, terms: AcceptedCheckoutTerms): Promise<boolean> {
  if (!terms.sessionId || !terms.selections.length || !Number.isFinite(terms.now.getTime())) return false;
  const row = await tx.checkoutSession.findUnique({ where: { merchantId_sessionId: { merchantId, sessionId: terms.sessionId } } });
  if (!row || row.merchantId !== merchantId || row.sessionId !== terms.sessionId) return false;
  if (terms.cart && !isDeepStrictEqual(stripStoredCheckoutCouponBinding(row.cart), JSON.parse(JSON.stringify(stripStoredCheckoutCouponBinding(terms.cart))))) return false;
  const selected = readProfessionalCheckoutSelections({ merchantId, cart: row.cart as unknown as ProfessionalSelectionCart["cart"] });
  if (!isDeepStrictEqual(selected, terms.selections)) return false;
  try {
    const proof = await terms.store().assertActive(merchantId, terms.sessionId, professionalHoldRequests(selected));
    for (const target of professionalHoldRequests(selected)) {
      const capture = captureAppointmentLease(merchantId, terms.sessionId, proof, target);
      if (Date.parse(capture.expiresAt) <= terms.now.getTime()) return false;
    }
    return true;
  } catch (error) { if (error instanceof ConflictException) return false; throw error; }
}
/** A hold-off draft without AP/accepted financial evidence is still a new
 * confirmation/first send. A channel-history flag never exempts that draft. */
export async function assertNewOrAcceptedServiceCapacityWithin(tx: Prisma.TransactionClient, merchantId: string, accepted?: AcceptedCheckoutTerms): Promise<void> {
  if (accepted && await hasAcceptedCheckoutLease(tx, merchantId, accepted)) return;
  await assertServiceActivationWithin(tx, merchantId);
}
