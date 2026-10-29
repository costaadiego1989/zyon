import type { CheckoutSessionRepository } from "../../checkout/domain/ports/checkout-session.repository.port.js";
import type { ProductVariantLookupPort } from "../../checkout/domain/ports/product-variant-lookup.port.js";
import type { UpdateCartUseCase } from "../../checkout/application/use-cases/update-cart.use-case.js";
import { GetCheckoutSessionUseCase } from "../../checkout/application/use-cases/get-checkout-session.use-case.js";
import type { ApplyCouponUseCase } from "../../coupons/application/use-cases/apply-coupon.use-case.js";
import { CheckoutSessionMapper } from "./checkout-session.mapper.js";
import { AcpStatusPolicy } from "./acp-status.policy.js";
import { AcpMutabilityPolicy } from "./acp-mutability.policy.js";
import { AcpLineItemsResolver, type AcpLineItemInput } from "./acp-line-items.resolver.js";
import { AcpBuyerMerger, type AcpAddressInput, type AcpBuyerInput } from "./acp-buyer.merger.js";
import { AcpFulfillmentSelector } from "./acp-fulfillment.selector.js";
import { AcpCouponApplier } from "./acp-coupon.applier.js";

export type UpdateSessionBody = {
  fulfillment_option_id?: string;
  line_items?: ReadonlyArray<AcpLineItemInput>;
  coupon_code?: string;
  buyer?: AcpBuyerInput;
  fulfillment_address?: AcpAddressInput;
};

/** All dependencies must belong to the caller's transaction. No provider I/O. */
export async function applyAcpSessionPatch(scope: {
  sessions: CheckoutSessionRepository;
  updateCart: UpdateCartUseCase;
  variantLookup?: ProductVariantLookupPort;
  applyCoupon: Pick<ApplyCouponUseCase, "executeForCheckout">;
}, merchantId: string, sessionId: string, body: UpdateSessionBody) {
  const getSession = new GetCheckoutSessionUseCase(scope.sessions);
  const status = new AcpStatusPolicy(scope.sessions);
  const mutability = new AcpMutabilityPolicy(status);
  let session = await getSession.execute(merchantId, sessionId);
  await mutability.assertMutable(session);

  if (body.line_items) {
    await new AcpLineItemsResolver(scope.updateCart, scope.sessions, scope.variantLookup)
      .resolveAndApply(merchantId, session, body.line_items);
    session = await getSession.execute(merchantId, sessionId);
  }
  if (body.buyer || body.fulfillment_address) {
    await new AcpBuyerMerger(scope.sessions).mergeAndApply(session, body.buyer, body.fulfillment_address);
    session = await getSession.execute(merchantId, sessionId);
  }
  if (body.fulfillment_option_id) {
    await new AcpFulfillmentSelector(scope.sessions).selectAndApply(session, body.fulfillment_option_id);
    session = await getSession.execute(merchantId, sessionId);
  }
  // Authorize shipping coupons against the selected quote, never the old quote.
  if (body.coupon_code) await new AcpCouponApplier(scope.applyCoupon).applyCoupon(session, body.coupon_code);

  const refreshed = await getSession.execute(merchantId, sessionId);
  return CheckoutSessionMapper.toAcp({ session: refreshed, aacpStatus: await status.derive(refreshed) });
}
