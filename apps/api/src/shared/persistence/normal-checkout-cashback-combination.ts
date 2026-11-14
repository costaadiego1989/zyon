import type { Prisma, CheckoutSession as StoredSession } from "@prisma/client";
import type { Cart } from "@zyon/shared-types";
import { toCheckoutSession } from "../../modules/checkout/domain/services/checkout-session-projection.js";
import { paymentCartFingerprint } from "../../modules/checkout/domain/services/payment-cart-fingerprint.js";
import { readCashbackCouponComposition } from "./storefront-coupon/cashback-composition.js";
import { readNormalCrossSellCouponAuthority } from "./storefront-coupon/admission.js";
import { readNormalCheckoutCouponOwner } from "./normal-checkout-coupon-owner.js";
import { readNormalCheckoutCommercialBenefitOwner } from "./normal-checkout-commercial-benefits.js";
import { normalCheckoutCashbackCombinationOwnerSchema, type NormalCheckoutCashbackCombinationOwner } from "../../modules/checkout/domain/contracts/normal-checkout-cashback-owner.schemas.js";

const conflict = (): never => { throw new Error("normal_checkout_coupon_review_required"); };

/** No owner is created from a cart label or id. Every monetary component needs
 * its existing real reservation/application event or approved benefit proof. */
export async function readNormalCashbackCombinationOwner(tx: Prisma.TransactionClient,
  stored: StoredSession, canonicalCart: Cart, now: Date,
  pinned?: NormalCheckoutCashbackCombinationOwner): Promise<NormalCheckoutCashbackCombinationOwner | undefined> {
  const session = toCheckoutSession(stored);
  const composition = await readCashbackCouponComposition(tx, session, { cashbackRuleVersion: pinned?.cashbackRuleVersion });
  if (!composition || !composition.combinedDiscountCents) return undefined;
  if (paymentCartFingerprint({ ...session, cart: canonicalCart }) !== paymentCartFingerprint(session)) return conflict();
  let coupon: NormalCheckoutCashbackCombinationOwner["coupon"];
  if (composition.coupon) {
    const component = composition.coupon;
    if (session.cart.source === "storefront") {
      const { candidate } = await readNormalCrossSellCouponAuthority(tx, { merchantId: session.merchantId, sessionId: session.sessionId }, { cashbackRuleVersion: pinned?.cashbackRuleVersion });
      if (candidate.couponId !== component.id || candidate.redemptionId !== component.redemptionId || candidate.discountCents !== component.amountCents) return conflict();
      coupon = { kind: "storefront_coupon", merchantId: session.merchantId, checkoutSessionId: session.sessionId, buyerId: session.globalUserId,
        cartId: candidate.cartId, reservationBuyerId: candidate.reservationBuyerId, redemptionId: candidate.redemptionId,
        couponId: candidate.couponId, code: candidate.couponCode, discountCents: candidate.discountCents };
    } else {
      coupon = await readNormalCheckoutCouponOwner(tx, session, { ...canonicalCart, currentDiscount: component.amountCents / 100,
        commercialNudge: { kind: "coupon", title: "Cupom aplicado", message: "Cupom autorizado", couponCode: component.code },
        appliedBenefits: [{ kind: "discount", label: `Cupom ${component.code}`, amount: component.amountCents / 100 }] }, now, { cashbackRuleVersion: pinned?.cashbackRuleVersion });
      if (coupon.couponId !== component.id || coupon.redemptionId !== component.redemptionId || coupon.discountCents !== component.amountCents) return conflict();
    }
  }
  let advanced: NormalCheckoutCashbackCombinationOwner["advanced"];
  if (composition.advanced) {
    advanced = await readNormalCheckoutCommercialBenefitOwner(tx, { stored, now, cashbackRuleVersion: pinned?.cashbackRuleVersion, canonicalCart: { ...canonicalCart,
      currentDiscount: composition.advanced.amountCents / 100,
      commercialNudge: { kind: "advanced_rule", title: "Regra aplicada", message: "Condição autorizada", ruleId: composition.advanced.id },
      appliedBenefits: [{ kind: "discount", label: "Regra avançada", amount: composition.advanced.amountCents / 100 }] } });
    if (!advanced || advanced.discountCents !== composition.advanced.amountCents
      || (advanced.kind === "accepted_offer" ? advanced.authorizedOfferId : `normal_policy:${advanced.origin}:${advanced.ruleId ?? advanced.settingsHash}`) !== composition.advanced.id) return conflict();
  }
  return normalCheckoutCashbackCombinationOwnerSchema.parse({ kind: "cashback_combination", version: 1,
    merchantId: session.merchantId, checkoutSessionId: session.sessionId, buyerId: session.globalUserId,
    discountCents: composition.combinedDiscountCents, commercialBenefitsVersion: composition.commercialBenefitsVersion,
    cashbackRuleVersion: composition.cashbackRuleVersion,
    journalHash: composition.journalHash, ...(coupon ? { coupon } : {}), ...(advanced ? { advanced } : {}) });
}
