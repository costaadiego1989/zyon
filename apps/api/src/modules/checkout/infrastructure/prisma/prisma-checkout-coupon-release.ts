/** Compatibility path. Multi-aggregate SQL coordination lives at its shared
 * integration boundary; domain policies and payment evidence remain pure. */
export { checkoutCouponReleaseReceiptId, validateReleasedCheckoutCouponGeneration,
  releaseBoundCheckoutCouponForEdit, cancelUnboundStorefrontCouponSource,
} from "../../../../shared/persistence/storefront-coupon/generation-release.js";
