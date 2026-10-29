import { isDeepStrictEqual } from "node:util";
import { ConflictException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import type { CheckoutEventName, CheckoutSession } from "@zyon/shared-types";
import type { CheckoutCommercialMutation } from "../../domain/ports/checkout-session.repository.port.js";
import { prepareCommercialMutation } from "../../domain/services/checkout-commercial-mutation.js";
import { readStoredCheckoutCouponBinding } from "../../domain/services/checkout-coupon-storage.js";
import { paymentCartFingerprint } from "../../domain/services/payment-cart-fingerprint.js";
import { checkoutBenefitsPolicy } from "../../domain/services/checkout-benefits-policy.js";
import type { AdvancedRule } from "../../domain/services/advanced-rule-evaluator.service.js";
import { readStorefrontCouponForCheckout } from "../../../../shared/persistence/storefront-coupon/admission.js";
import { StorefrontCouponEligibilityReviewRequired,
  type StorefrontCouponCheckoutCandidate } from "../../../../shared/persistence/storefront-coupon/contracts.js";
import { lockStorefrontCart } from "../../../../shared/persistence/storefront-cart-lock.js";
import { storefrontCartHasCheckoutBinding, assertStorefrontCartUnbound } from "../../../../shared/persistence/storefront-coupon/cart-owner-fence.js";
import { validateReleasedCheckoutCouponGeneration } from "../../../../shared/persistence/storefront-coupon/generation-release.js";
import { toCheckoutSession } from "./checkout-session.mapper.js";
import { toMerchantRules } from "./merchant-rules.mapper.js";

type Row = Parameters<typeof toCheckoutSession>[0] & { id: string; version: number };
const REVIEW_NOTICE = { version: 1 as const, code: "benefit_conditions_not_met" as const,
  message: "As condições do cupom mudaram. O desconto está em revisão; revise o pedido antes de pagar." };
function conflict(): never { throw new ConflictException("checkout_coupon_binding_conflict"); }
function needsReview(): never {
  throw new ConflictException({ code: "checkout_review_required", message: "As condições do cupom mudaram. Revise o pedido antes de pagar." });
}
function merchandise(session: CheckoutSession) {
  return JSON.stringify([paymentCartFingerprint({ cart: { ...session.cart, currentDiscount: 0 }, shipping: undefined }),
    session.cart.source, session.cart.cart_ref, session.cart.discountBudget, session.crossStoreItems ?? [],
    session.cart.items.map(line => line.variantId ?? null)]);
}
async function readCandidate(tx: Prisma.TransactionClient, session: CheckoutSession) {
  try { return { candidate: await readStorefrontCouponForCheckout(tx, session), review: false }; }
  catch (error) {
    if (!(error instanceof StorefrontCouponEligibilityReviewRequired)) throw error;
    return { candidate: error.candidate, review: true };
  }
}
async function lockSource(tx: Prisma.TransactionClient, row: Row) {
  const current = toCheckoutSession(row), cartId = current.cart.cart_ref;
  if (current.cart.source !== "storefront" || !cartId) return undefined;
  const binding = readStoredCheckoutCouponBinding(row.cart);
  if (binding && binding.state !== "released") return conflict();
  await lockStorefrontCart(tx, current.merchantId, cartId);
  if (binding) await validateReleasedCheckoutCouponGeneration(tx, row);
  assertStorefrontCartUnbound(await storefrontCartHasCheckoutBinding(tx, current.merchantId, cartId));
  return { current, binding };
}

/** Read/prepare only. Repository owns merchant/rules and checkout anchor/row;
 * persistence is a dedicated versioned write in that same transaction, never a
 * generic-save exception or a browser-supplied preserve-discount flag. */
export async function prepareStorefrontCouponFormMutation(tx: Prisma.TransactionClient, row: Row, input: CheckoutCommercialMutation) {
  const locked = await lockSource(tx, row);
  if (!locked) return undefined;
  const { current, binding } = locked;
  if (current.merchantId !== input.next.merchantId || current.sessionId !== input.next.sessionId
    || current.globalUserId !== input.next.globalUserId || !input.cancel && merchandise(current) !== merchandise(input.next)) return conflict();
  const prior = binding && !input.cancel ? undefined : await readCandidate(tx, current);
  if (!binding && !prior?.candidate) return undefined;
  if (input.cancel) return { ...prepareCommercialMutation(input), candidate: prior?.candidate, binding, review: false };
  const mutation = prepareCommercialMutation(binding ? { ...input, next: { ...input.next, cart: {
    ...input.next.cart, currentDiscount: current.cart.currentDiscount,
    commercialNudge: current.cart.commercialNudge,
  } } } : input), next = mutation.session;
  // Only the exact previously read reservation supplies D. A released session
  // may present a NEW canonical source only after this read validates it.
  next.cart.currentDiscount = binding ? input.next.cart.currentDiscount ?? 0 : prior!.candidate!.discountCents / 100;
  next.cart.commercialNudge = binding ? structuredClone(input.next.cart.commercialNudge) : structuredClone(current.cart.commercialNudge);
  const addressChanged = !isDeepStrictEqual(current.customer?.address ?? null, next.customer?.address ?? null);
  if (!addressChanged) {
    if (input.next.shipping && !isDeepStrictEqual(input.next.shipping, current.shipping)
      && !current.shippingOptions?.some(option => isDeepStrictEqual(option, input.next.shipping))) {
      throw new ConflictException("CHECKOUT_SHIPPING_OPTION_CHANGED");
    }
    next.shipping = structuredClone(input.next.shipping);
    next.shippingOptions = structuredClone(input.next.shippingOptions);
  }
  const checked = await readCandidate(tx, next), candidate = checked.candidate;
  if (!candidate && (next.cart.currentDiscount ?? 0) > 0) return conflict();
  if (!candidate && !binding) return conflict();
  if (candidate) {
    next.cart.commercialNudge = { kind: "coupon", title: current.cart.commercialNudge?.title ?? "Cupom aplicado",
      message: checked.review ? REVIEW_NOTICE.message : "Cupom aplicado conforme as condições da loja.", couponCode: candidate.couponCode };
    next.cart.appliedBenefits = [{ kind: "discount", label: "Cupom aplicado", amount: candidate.discountCents / 100 },
      ...(!addressChanged && isDeepStrictEqual(next.shipping, current.shipping)
        ? (current.cart.appliedBenefits ?? []).filter(benefit => benefit.kind === "shipping") : [])];
  }
  const notices = (next.cart.commercialNotices ?? []).filter(notice => !isDeepStrictEqual(notice, REVIEW_NOTICE));
  next.cart.commercialNotices = checked.review ? [...notices, REVIEW_NOTICE] : notices;
  return { ...mutation, session: next, candidate, binding, review: checked.review };
}

/** Revalidate coupon authority before payment preparation. No anonymous grant,
 * automatic second coupon or progressive substitution. The existing deterministic
 * shipping engine still controls any independent allowed subsidy. */
export async function prepareStorefrontCouponPaymentBenefits(tx: Prisma.TransactionClient, row: Row, method: string) {
  const locked = await lockSource(tx, row);
  if (!locked) return undefined;
  const { current, binding } = locked;
  let candidate: StorefrontCouponCheckoutCandidate | undefined;
  try { candidate = await readStorefrontCouponForCheckout(tx, current, { requireVerifiedBuyer: true, requireRegion: true }); }
  catch (error) { if (error instanceof StorefrontCouponEligibilityReviewRequired) return needsReview(); throw error; }
  if (!candidate) return undefined;
  const rulesRow = await tx.merchantRule.findUnique({ where: { merchantId: current.merchantId } });
  if (!rulesRow) return conflict();
  const configuration = await tx.checkoutSetting.findUnique({ where: { merchantId: current.merchantId }, select: { advancedRules: true } });
  const history = await tx.checkoutEvent.findMany({ where: { merchantId: current.merchantId, sessionId: current.sessionId },
    orderBy: { occurredAt: "asc" }, select: { eventName: true } });
  const session = structuredClone(current);
  session.cart.commercialNudge = { kind: "coupon", title: current.cart.commercialNudge?.title ?? "Cupom aplicado",
    message: "Cupom aplicado conforme as condições da loja.", couponCode: candidate.couponCode };
  const evaluated = checkoutBenefitsPolicy({ session, rules: toMerchantRules(rulesRow),
    advancedRules: (configuration?.advancedRules ?? []) as unknown as AdvancedRule[],
    events: [...history.map(event => event.eventName as CheckoutEventName), "payment_method_selected"], paymentMethod: method });
  if (evaluated.couponCode || Math.round((evaluated.session.cart.currentDiscount ?? 0) * 100) !== candidate.discountCents) return conflict();
  try { await readStorefrontCouponForCheckout(tx, evaluated.session, { requireVerifiedBuyer: true, requireRegion: true }); }
  catch (error) { if (error instanceof StorefrontCouponEligibilityReviewRequired) return needsReview(); throw error; }
  evaluated.session.cart.commercialNotices = (evaluated.session.cart.commercialNotices ?? []).filter(notice => !isDeepStrictEqual(notice, REVIEW_NOTICE));
  return { session: evaluated.session, binding, history: history.map(event => event.eventName) };
}
