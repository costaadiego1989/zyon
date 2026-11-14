import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { evaluateCombinedDiscount, moneyCents } from "@zyon/rules-engine";
import type { Cart, CheckoutSession } from "@zyon/shared-types";
import { parseCheckoutCouponBinding, parseCheckoutCouponPaymentAuthority, type CheckoutCouponPaymentAuthority } from "../../../modules/checkout/domain/services/checkout-coupon-binding.js";
import { hasStoredCheckoutCouponBinding, readStoredCheckoutCouponBinding, stripStoredCheckoutCouponBinding } from "../../../modules/checkout/domain/services/checkout-coupon-storage.js";
import { paymentCartFingerprint } from "../../../modules/checkout/domain/services/payment-cart-fingerprint.js";
import { toCheckoutSession } from "../../../modules/checkout/domain/services/checkout-session-projection.js";
import type { CouponSnapshot } from "../../../modules/coupons/domain/entities/coupon.entity.js";
import { couponNudge } from "../../../modules/coupons/application/services/checkout-coupon.js";
import { toMerchantRules } from "../../../modules/checkout/infrastructure/prisma/merchant-rules.mapper.js";
import { validateReleasedCheckoutCouponGeneration } from "./generation-release.js";
import { assertStorefrontCouponSourceProjection } from "./source-projection-basis.js";
import type { PaymentIntentSnapshot } from "../../../modules/payment/domain/payment-intent.entity.js";
import { readPaymentCouponAuthority } from "../../../modules/payment/domain/payment-coupon-authority.js";
import { readPaymentNormalCrossSellAuthority } from "../../../modules/payment/domain/payment-normal-cross-sell-authority.js";
import { assertPaymentAmount } from "../../../modules/payment/domain/payment-amount.js";
import { validateCoupon } from "../../../modules/coupons/domain/policies/coupon-validity.policy.js";
import { calculateCouponDiscount } from "../../../modules/coupons/domain/policies/coupon-discount-calculator.js";
import { toCouponEntity } from "../../../modules/coupons/infrastructure/repositories/prisma-coupon.converters.js";
import { StorefrontCouponEligibilityReviewRequired, type StorefrontCouponAdmissionScope,
  type StorefrontCouponCheckoutCandidate, type StorefrontCouponReviewReason } from "./contracts.js";
import { readCashbackCouponComposition } from "./cashback-composition.js";

const ref = z.string().min(1).max(191).refine(value => value.trim() === value && !value.includes("\0"));
const scopeSchema = z.strictObject({ merchantId: ref, checkoutSessionId: ref, cartId: ref, buyerId: ref });
const ownersSchema = z.array(z.strictObject({ isolation: z.literal("read committed"), candidates: z.array(z.strictObject({
  merchantId: ref, sessionId: ref, buyerId: ref, cartRef: ref, binding: z.unknown(),
})).max(100) })).length(1);
function conflict(): never { throw new Error("checkout_coupon_binding_conflict"); }
function checked<S extends z.ZodType>(schema: S, value: unknown): z.output<S> {
  try { const result = schema.safeParse(value); if (result.success) return result.data; } catch { /* fixed boundary */ }
  return conflict();
}
function cents(value: unknown): number {
  const result = moneyCents(value);
  return result === null ? conflict() : result;
}
function reservationCents(value: Prisma.Decimal): number {
  if (!Prisma.Decimal.isDecimal(value)) return conflict();
  const result = value.times(100);
  if (!result.isInteger() || result.lte(0) || result.gt(Number.MAX_SAFE_INTEGER)) return conflict();
  return result.toNumber();
}

/** Read-only commercial revalidation for normal prepayment forms. Caller owns
 * merchant/rules → checkout anchor/row → cart locks; this acquires only coupon.
 * A returned candidate is NOT authority or ownership. Admission must additionally
 * require verified buyer/region and issue atomically with the payment journal. */
export async function readStorefrontCouponForCheckout(
  tx: Prisma.TransactionClient,
  session: CheckoutSession,
  options: { requireVerifiedBuyer?: boolean; requireRegion?: boolean; cashbackRuleVersion?: number } = {},
): Promise<StorefrontCouponCheckoutCandidate | undefined> {
  const cartId = session.cart.cart_ref;
  if (session.cart.source !== "storefront" || typeof cartId !== "string" || !cartId.trim()) return undefined;
  const scope = checked(scopeSchema, { merchantId: session.merchantId, checkoutSessionId: session.sessionId, cartId, buyerId: session.globalUserId });
  const cart = await tx.storefrontCart.findUnique({ where: { merchantId_sessionId: { merchantId: scope.merchantId, sessionId: cartId } } });
  if (!cart || cart.couponCode === null || cart.couponCode === undefined) {
    if (session.cart.commercialNudge?.kind === "coupon") return conflict();
    return undefined;
  }
  const verified = session.customer?.email_verified === true && Boolean(session.customer.email?.trim())
    || session.customer?.phone_verified === true && Boolean(session.customer.phone?.replace(/\D/g, ""));
  if (options.requireVerifiedBuyer && !verified || cart.merchantId !== scope.merchantId || cart.sessionId !== cartId
    || !(cart.expiresAt instanceof Date)) return conflict();
  const composition = await readCashbackCouponComposition(tx, session, { cashbackRuleVersion: options.cashbackRuleVersion });
  const combinedDiscountCents = cents(session.cart.currentDiscount ?? 0);
  if (composition && !composition.coupon) return conflict();
  const discountCents = composition?.coupon?.amountCents ?? combinedDiscountCents;
  if (discountCents <= 0 || !Number.isSafeInteger(cart.discount) || cart.discount !== discountCents) return conflict();
  await assertStorefrontCouponSourceProjection(tx, { merchantId: scope.merchantId, cartId }, cart, session.cart);
  const code = checked(ref, cart.couponCode);
  const locked = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM coupons WHERE merchant_id=${scope.merchantId} AND code=${code} FOR UPDATE`;
  if (locked.length !== 1) return conflict();
  const row = await tx.coupon.findFirst({ where: { merchantId: scope.merchantId, id: locked[0]!.id, code } });
  if (!row || row.merchantId !== scope.merchantId || row.id !== locked[0]!.id) return conflict();
  const coupon = toCouponEntity(row).snapshot();
  if (coupon.strategy_incentive_execution_id || !["fixed", "percent"].includes(coupon.discount_type)) return conflict();
  const reservations = await tx.couponRedemption.findMany({ where: { merchantId: scope.merchantId, sessionId: cartId, status: "applied" }, take: 2 });
  if (reservations.length !== 1) return conflict();
  const reservation = reservations[0]!;
  if (reservation.merchantId !== scope.merchantId || reservation.sessionId !== cartId || reservation.couponId !== coupon.id
    || reservation.status !== "applied" || reservation.orderId !== null || reservationCents(reservation.discountApplied) !== discountCents
    || reservation.buyerGlobalUserId !== null && reservation.buyerGlobalUserId !== scope.buyerId
    || options.requireVerifiedBuyer && coupon.max_per_buyer !== null && reservation.buyerGlobalUserId === null) return conflict();
  if (composition && (composition.coupon!.id !== coupon.id || composition.coupon!.code !== code
    || composition.coupon!.redemptionId !== reservation.id)) return conflict();
  const candidate = { ...scope, reservationBuyerId: reservation.buyerGlobalUserId, redemptionId: checked(ref, reservation.id), couponId: checked(ref, coupon.id),
    discountCents, basisHash: paymentCartFingerprint(session), couponCode: code,
    ...(composition ? { combinedDiscountCents, commercialBenefitsVersion: composition.commercialBenefitsVersion } : {}) };
  const review = (reason: StorefrontCouponReviewReason): never => { throw new StorefrontCouponEligibilityReviewRequired(reason, candidate); };
  // Typed commercial review is safe ONLY after the exact source/reservation
  // identity and D have passed. Integrity, proof and storage faults stay hard.
  if (cart.expiresAt.getTime() <= Date.now()) return review("source_expired");
  const region = session.customer?.address?.state?.trim().toUpperCase();
  if (options.requireRegion && !region && (coupon.allowed_regions.length || coupon.blocked_regions.length)) return review("buyer_region_required");
  const validity = validateCoupon(coupon, session.cart, region);
  if (!validity.valid) {
    return review(validity.reason === "COUPON_EXPIRED" ? "coupon_expired"
      : ["COUPON_REGION_NOT_ALLOWED", "COUPON_REGION_BLOCKED"].includes(validity.reason) ? "coupon_region_changed" : "coupon_conditions_changed");
  }
  if (cents(calculateCouponDiscount(coupon, session.cart.total)) < discountCents) return review("coupon_conditions_changed");
  const policy = await tx.merchantRule.findUnique({ where: { merchantId: scope.merchantId } });
  if (!policy) return conflict();
  const rules = composition?.effectiveRules ?? toMerchantRules(policy);
  const decision = evaluateCombinedDiscount(session.cart, rules, combinedDiscountCents);
  if (decision.kind !== "authorized" || decision.cartDiscountCents !== combinedDiscountCents) {
    if (["existing_discount_above_limit", "discount_disabled_by_merchant", "capped_by_combined_discount_limit"].includes(decision.reason)) return review("discount_ceiling_changed");
    return conflict();
  }
  if (session.shipping?.customerPrice === 0) {
    const realShippingCostCents = moneyCents(session.shipping.realCost);
    if (realShippingCostCents === null) return conflict();
    if (realShippingCostCents > 0 && !rules.allowStackDiscountAndFreeShipping) return review("shipping_stacking_changed");
  }
  if (coupon.max_usages !== null && await tx.couponRedemption.count({ where: { merchantId: scope.merchantId, couponId: coupon.id,
    status: { not: "cancelled" } } }) > coupon.max_usages) return review("coupon_quota_changed");
  if (coupon.max_per_buyer !== null && await tx.couponRedemption.count({ where: { merchantId: scope.merchantId, couponId: coupon.id,
    buyerGlobalUserId: scope.buyerId, status: { not: "cancelled" } } }) > coupon.max_per_buyer) return review("coupon_quota_changed");
  return candidate;
}

/** Caller owns one READ COMMITTED transaction and MUST hold merchant/rules →
 * payment advisory → checkout anchor/row → cart advisory until commit. This
 * command never acquires an earlier lock, calls providers, mutates the supplied
 * entity snapshot or commits independently. Its binding CAS and the caller's
 * journal insertion must commit together. Public Cart is NOT an admission grant. */
export async function captureStorefrontCouponForPayment(
  tx: Prisma.TransactionClient,
  snapshot: PaymentIntentSnapshot,
  trustedScope?: StorefrontCouponAdmissionScope,
): Promise<CheckoutCouponPaymentAuthority | undefined> {
  const scope = trustedScope === undefined ? undefined : checked(scopeSchema, trustedScope);
  if (scope && (scope.merchantId !== snapshot.merchantId || scope.checkoutSessionId !== snapshot.sessionId)) return conflict();
  const checkout = await tx.checkoutSession.findUnique({ where: { merchantId_sessionId: {
    merchantId: snapshot.merchantId, sessionId: snapshot.sessionId,
  } } });
  if (!checkout) return conflict();
  const session = toCheckoutSession(checkout);
  const binding = readStoredCheckoutCouponBinding(checkout.cart);
  let frozen: CheckoutCouponPaymentAuthority | undefined;
  try { frozen = readPaymentCouponAuthority(snapshot); } catch { return conflict(); }
  let cashbackRuleVersion: number | undefined;
  if(frozen?.version===2){
    // Only a persisted payment identity may pin an earlier policy. A new body,
    // cart hint or unpersisted snapshot cannot select policy history.
    const actual=await tx.paymentIntent.findUnique({where:{id:snapshot.id}});
    if(!actual||actual.merchantId!==snapshot.merchantId||actual.sessionId!==snapshot.sessionId)return conflict();
    const method=checked(z.enum(["pix","card","boleto","crypto"]),actual.method);
    if(!isDeepStrictEqual(readPaymentCouponAuthority({...actual,method}),frozen))return conflict();
    const normal=readPaymentNormalCrossSellAuthority(actual);
    if(normal?.discountOwner?.kind==="cashback_combination")cashbackRuleVersion=normal.discountOwner.cashbackRuleVersion;
    const quoteId=snapshot.amountBreakdown?.cashbackEarningQuoteId;
    if(quoteId){
      const quotes=await tx.$queryRaw<Array<{rule_version:number}>>`SELECT (data->>'ruleVersion')::int AS rule_version
        FROM cashback_earning_quotes WHERE id=${quoteId} AND merchant_id=${snapshot.merchantId}
        AND session_id=${snapshot.sessionId} AND payment_key=${snapshot.idempotencyKey}
        AND payment_intent_id=${snapshot.id} AND fingerprint=${frozen.basisHash} AND state='bound'`;
      if(quotes.length!==1||!Number.isSafeInteger(quotes[0]!.rule_version)||quotes[0]!.rule_version<1
        ||cashbackRuleVersion!==undefined&&cashbackRuleVersion!==quotes[0]!.rule_version)return conflict();
      cashbackRuleVersion=quotes[0]!.rule_version;
    }
  }
  const cartId = session.cart.cart_ref;
  if (session.cart.source !== "storefront" || typeof cartId !== "string" || !cartId.trim()) {
    if (binding || frozen || scope) return conflict();
    return undefined;
  }
  const cart = await tx.storefrontCart.findUnique({ where: { merchantId_sessionId: { merchantId: snapshot.merchantId, sessionId: cartId } } });
  if (!cart || cart.couponCode === null || cart.couponCode === undefined) {
    if (hasStoredCheckoutCouponBinding(checkout.cart) || frozen || session.cart.commercialNudge?.kind === "coupon") return conflict();
    return undefined;
  }
  if (!scope && !frozen) return conflict();
  if (scope && (scope.cartId !== cartId || scope.buyerId !== session.globalUserId)) return conflict();
  const verified = session.customer?.email_verified === true && Boolean(session.customer.email?.trim())
    || session.customer?.phone_verified === true && Boolean(session.customer.phone?.replace(/\D/g, ""));
  if (!verified || !Number.isSafeInteger(checkout.version) || cart.merchantId !== snapshot.merchantId || cart.sessionId !== cartId
    || !(cart.expiresAt instanceof Date) || cart.expiresAt.getTime() <= Date.now()
    || !snapshot.creation || snapshot.status !== "pending" || snapshot.providerPaymentId || snapshot.currency !== "BRL") return conflict();
  // A first-send journal is an existing authority, never a new scope/issuer.
  if (!frozen && (!scope || snapshot.creation.state !== "ready" || snapshot.creation.firstAttemptAt || (snapshot.version ?? 0) !== 0)) return conflict();
  const composition = await readCashbackCouponComposition(tx, session, {cashbackRuleVersion});
  const combinedDiscountCents = cents(session.cart.currentDiscount ?? 0);
  if (composition && !composition.coupon) return conflict();
  const discountCents = composition?.coupon?.amountCents ?? combinedDiscountCents;
  if (discountCents <= 0 || !Number.isSafeInteger(cart.discount) || cart.discount !== discountCents) return conflict();
  await assertStorefrontCouponSourceProjection(tx, { merchantId: snapshot.merchantId, cartId }, cart, session.cart);
  const breakdown = snapshot.amountBreakdown;
  const basisHash = paymentCartFingerprint(session);
  try { if (!breakdown) return conflict(); assertPaymentAmount(breakdown, snapshot.amountCents, snapshot.currency); }
  catch { return conflict(); }
  if (breakdown.cartFingerprint !== basisHash || breakdown.discountCents !== combinedDiscountCents
    || breakdown.itemsSubtotalCents !== cents(session.cart.total)) return conflict();

  // Same discovery predicate as the cart-side guard: observe fresh owners only
  // after waiting for the common cart lock; never choose an arbitrary checkout.
  const result = checked(ownersSchema, await tx.$queryRaw`SELECT current_setting('transaction_isolation') AS isolation,
    COALESCE(jsonb_agg(candidate), '[]'::jsonb) AS candidates FROM (
      SELECT merchant_id AS "merchantId", session_id AS "sessionId", global_user_id AS "buyerId",
        cart->'cart_ref' AS "cartRef", cart->'_storefrontCouponBinding' AS binding
      FROM checkout_sessions WHERE merchant_id=${snapshot.merchantId} AND cart ? '_storefrontCouponBinding'
        AND (cart->'_storefrontCouponBinding'->>'cartId'=${cartId} OR cart->>'cart_ref'=${cartId}) LIMIT 101
    ) candidate`);
  const owners: Array<typeof result[0]["candidates"][number]> = [];
  const released = new Set<string>();
  for (const candidateOwner of result[0]!.candidates) {
    const candidateBinding = parseCheckoutCouponBinding(candidateOwner.binding);
    if (candidateOwner.merchantId !== snapshot.merchantId || candidateOwner.cartRef !== cartId
      || candidateBinding.merchantId !== snapshot.merchantId || candidateBinding.cartId !== cartId
      || candidateBinding.checkoutSessionId !== candidateOwner.sessionId || candidateBinding.buyerId !== candidateOwner.buyerId) return conflict();
    if (candidateBinding.state === "released") {
      const canonical = await tx.checkoutSession.findUnique({ where: { merchantId_sessionId: {
        merchantId: snapshot.merchantId, sessionId: candidateOwner.sessionId,
      } } });
      if (!canonical || !isDeepStrictEqual(readStoredCheckoutCouponBinding(canonical.cart), candidateBinding)) return conflict();
      try { await validateReleasedCheckoutCouponGeneration(tx, canonical); } catch { return conflict(); }
      released.add(candidateBinding.bindingId);
    } else owners.push(candidateOwner);
  }
  if (owners.length > 1) return conflict();
  const owner = owners[0];
  if (owner) {
    const existing = parseCheckoutCouponBinding(owner.binding);
    if (owner.merchantId !== snapshot.merchantId || owner.sessionId !== snapshot.sessionId || owner.buyerId !== session.globalUserId
      || owner.cartRef !== cartId || existing.cartId !== cartId || existing.checkoutSessionId !== snapshot.sessionId
      || existing.merchantId !== snapshot.merchantId || existing.buyerId !== session.globalUserId
      || !isDeepStrictEqual(existing, binding)) return conflict();
  } else if (binding && (binding.state !== "released" || !released.has(binding.bindingId))) return conflict();
  if (await tx.completedOrder.findFirst({ where: { merchantId: snapshot.merchantId, sessionId: snapshot.sessionId }, select: { id: true } })
    || await tx.paymentIntent.findFirst({ where: { merchantId: snapshot.merchantId, sessionId: snapshot.sessionId,
      id: { not: snapshot.id }, status: { notIn: ["failed", "cancelled"] } }, select: { id: true } })) return conflict();
  let candidate: StorefrontCouponCheckoutCandidate | undefined;
  try { candidate = await readStorefrontCouponForCheckout(tx, session, { requireVerifiedBuyer: true, requireRegion: true, cashbackRuleVersion }); }
  catch (error) { if (error instanceof StorefrontCouponEligibilityReviewRequired) return conflict(); throw error; }
  if (!candidate || candidate.discountCents !== discountCents || candidate.basisHash !== basisHash
    || (candidate.combinedDiscountCents ?? candidate.discountCents) !== combinedDiscountCents) return conflict();
  const { couponCode: _couponCode, ...candidateIdentity } = candidate;
  const identity = parseCheckoutCouponPaymentAuthority({ version: candidate.commercialBenefitsVersion === undefined ? 1 : 2,
    bindingId: binding?.state === "active" ? binding.bindingId : randomUUID(),
    ...candidateIdentity });
  if (binding?.state === "redeemed" || frozen && (!binding || binding.state !== "active" || !isDeepStrictEqual(frozen, identity))) return conflict();
  if (binding?.state === "active") {
    const { state: _state, ...current } = binding;
    if (!isDeepStrictEqual(current, identity)) return conflict();
    return identity;
  }
  if (frozen) return conflict();
  const stored = { ...stripStoredCheckoutCouponBinding(checkout.cart), _storefrontCouponBinding: { ...identity, state: "active" } };
  const saved = await tx.checkoutSession.updateMany({ where: { id: checkout.id, merchantId: snapshot.merchantId,
    sessionId: snapshot.sessionId, version: checkout.version }, data: { cart: stored as unknown as Prisma.InputJsonValue, updatedAt: new Date() } });
  if (saved.count !== 1) return conflict();
  return identity;
}

/** Same-transaction composition ONLY. BEFORE is loaded here, never supplied by
 * a body/model. This neither issues a binding nor allocates/reserves more D. */
export async function readNormalCrossSellCouponAuthority(tx:Prisma.TransactionClient,scope:{merchantId:string;sessionId:string}, options: { cashbackRuleVersion?: number } = {}){
  const stored=await tx.checkoutSession.findUnique({where:{merchantId_sessionId:scope}});
  if(!stored||stored.merchantId!==scope.merchantId||stored.sessionId!==scope.sessionId)return conflict();
  const session=toCheckoutSession(stored);
  const candidate=await readStorefrontCouponForCheckout(tx,session,{requireVerifiedBuyer:true,requireRegion:true,...options});
  if(!candidate)return conflict();
  const row=await tx.coupon.findFirst({where:{id:candidate.couponId,merchantId:scope.merchantId,code:candidate.couponCode}});
  if(!row||row.id!==candidate.couponId||row.merchantId!==scope.merchantId||row.code!==candidate.couponCode)return conflict();
  const coupon=toCouponEntity(row).snapshot();
  await tx.$queryRaw`SELECT id FROM coupon_redemptions WHERE merchant_id=${scope.merchantId} AND id=${candidate.redemptionId} FOR UPDATE`;
  return {candidate,coupon,buyerRegion:session.customer?.address?.state?.trim().toUpperCase()};
}
export type NormalCrossSellCouponAuthority={candidate:StorefrontCouponCheckoutCandidate;coupon:CouponSnapshot;buyerRegion?:string};
/** Validate the proposed canonical merchandise against the actual BEFORE
 * reservation. A percent coupon may permit a larger maximum after an add, but
 * this function preserves the already accepted D exactly, never increases it. */
export function assertNormalCrossSellCouponProjection(authority:NormalCrossSellCouponAuthority,cart:Cart,now:Date):void{
  const {candidate,coupon}=authority;
  if(cart.source!=="storefront"||cart.cart_ref!==candidate.cartId||cents(cart.currentDiscount??0)!==(candidate.combinedDiscountCents??candidate.discountCents)
    ||candidate.commercialBenefitsVersion!==undefined&&cart.commercialBenefitsVersion!==candidate.commercialBenefitsVersion
    ||coupon.id!==candidate.couponId||coupon.merchant_id!==candidate.merchantId||coupon.code!==candidate.couponCode
    ||!validateCoupon(coupon,cart,authority.buyerRegion,now).valid
    ||cents(calculateCouponDiscount(coupon,cart.total))<candidate.discountCents)return conflict();
}
export function projectNormalCrossSellCouponPresentation(authority:NormalCrossSellCouponAuthority,cart:Cart):Cart{
  const discount=authority.candidate.discountCents/100;
  if(authority.candidate.commercialBenefitsVersion!==undefined)return {...cart,
    currentDiscount:authority.candidate.combinedDiscountCents!/100,
    commercialBenefitsVersion:authority.candidate.commercialBenefitsVersion};
  return {...cart,currentDiscount:discount,appliedBenefits:[{kind:"discount",label:`Cupom ${authority.candidate.couponCode}`,amount:discount}],
    commercialNudge:couponNudge(authority.coupon,discount,0,cart.total)};
}
/** AFTER rereads the SAME real reservation/D under the retained coupon fence.
 * Event/CAS/commit failure rolls this and both aggregates back together. */
export async function assertNormalCrossSellCouponAfterWrite(tx:Prisma.TransactionClient,before:NormalCrossSellCouponAuthority,
  options: { allowCashbackRebase?: boolean } = {}):Promise<void>{
  const candidate=before.candidate;
  const after=await readNormalCrossSellCouponAuthority(tx,{merchantId:candidate.merchantId,sessionId:candidate.checkoutSessionId});
  const keys=["merchantId","checkoutSessionId","cartId","buyerId","reservationBuyerId","redemptionId","couponId","discountCents","couponCode"]as const;
  if(keys.some(key=>after.candidate[key]!==candidate[key]))return conflict();
  if(!options.allowCashbackRebase&&(after.candidate.combinedDiscountCents!==candidate.combinedDiscountCents
    ||after.candidate.commercialBenefitsVersion!==candidate.commercialBenefitsVersion))return conflict();
}
