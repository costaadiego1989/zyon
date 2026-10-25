import type { CheckoutSession } from "@zyon/shared-types";

/** Composition-only SAME-transaction canonical normal authority. No request cart,
 * cached quote, flag or separate transaction may implement this boundary. */
export const NORMAL_CHECKOUT_COUPON_READER=Symbol("NORMAL_CHECKOUT_COUPON_READER");
export type NormalCheckoutCouponReader<TTransaction>=(transaction:TTransaction,
  scope:{merchantId:string;sessionId:string})=>Promise<CheckoutSession>;
