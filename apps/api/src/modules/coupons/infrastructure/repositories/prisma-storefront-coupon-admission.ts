/** Compatibility path retained for PaymentModule, callers and native workers.
 * The supplied-transaction coordinator spans several aggregate repositories. */
export { captureStorefrontCouponForPayment, readStorefrontCouponForCheckout,
} from "../../../../shared/persistence/storefront-coupon/admission.js";
export { StorefrontCouponEligibilityReviewRequired,
} from "../../../../shared/persistence/storefront-coupon/contracts.js";
export type { StorefrontCouponAdmissionScope, StorefrontCouponCheckoutCandidate,
  StorefrontCouponReviewReason,
} from "../../../../shared/persistence/storefront-coupon/contracts.js";
