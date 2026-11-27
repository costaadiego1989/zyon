import { Inject, Injectable } from "@nestjs/common";
import type { AuthorizedOffer, CashbackRules, CheckoutSession, MerchantRules } from "@zyon/shared-types";
import { DEFAULT_RULES } from "../../merchant/domain/merchant-rules.defaults.js";
import { paymentCartFingerprint } from "../../checkout/domain/services/payment-cart-fingerprint.js";
import { requiresPhysicalDelivery } from "../../checkout/domain/services/cart-fulfillment.js";
import { CASHBACK_REPOSITORY, type CashbackRepositoryPort, type CashbackTx } from "../domain/ports/cashback-repository.port.js";
import { advance, CashbackError, cents, fingerprint, shrinkReservation } from "../domain/cashback.js";
import { cashbackCombinedLimit, combinedDiscountCap, marginDiscountLimit, type CombinationContext } from "../domain/cashback-combination.js";
import { cashbackMerchandiseBasis } from "../domain/cashback-merchandise.js";
import { parseCheckoutCouponBinding } from "../../checkout/domain/services/checkout-coupon-binding.js";
import { hasStoredCheckoutCouponBinding, readStoredCheckoutCouponBinding } from "../../checkout/domain/services/checkout-coupon-storage.js";
import { lockCheckoutSessionAnchor } from "../../../shared/persistence/checkout-session-lock.js";
import { lockStorefrontCart } from "../../../shared/persistence/storefront-cart-lock.js";
import { assertStorefrontCouponSourceProjection } from "../../../shared/persistence/storefront-coupon/source-projection-basis.js";

interface Benefit { id: string; amountCents: number; shippingCents: number; }
interface CouponBenefit extends Benefit { redemptionId: string; code: string; stackable?: boolean; }
interface BenefitsState {
  baseFingerprint: string; baseShippingCents: number; shippingIdentity?: string; coupon: CouponBenefit | null;
  advanced: Benefit | null; shippingRule: Benefit | null; unknownCents: number; unknownBenefit: boolean;
}
interface JournalRow { data: BenefitsState; version: number; }
export interface AuthorizedCouponResult {
  redemption_id: string; discount_applied: number; shipping_discount_applied?: number;
  coupon: { id: string; code: string; stackable?: boolean };
}
export interface CouponPreflightInput {
  merchantId: string; sessionId: string; discount_applied: number; shipping_discount_applied?: number;
  coupon: { id: string; code: string; stackable?: boolean };
}
function money(value: number): number { return cents(Math.round(value * 100), "commercial_amount"); }
function gross(session: CheckoutSession): number { return cashbackMerchandiseBasis(session.cart).grossCents; }
function baseFingerprint(session: CheckoutSession): string {
  return paymentCartFingerprint({ ...session, cart: { ...session.cart, currentDiscount: 0, commercialBenefitsVersion: undefined } as CheckoutSession["cart"], shipping: session.shipping ? { ...session.shipping, customerPrice: 0 } : undefined });
}
function productDiscount(state: BenefitsState): number { return state.unknownCents + (state.coupon?.amountCents ?? 0) + (state.advanced?.amountCents ?? 0); }
function shippingDiscount(state: BenefitsState): number { return Math.min(state.baseShippingCents, (state.coupon?.shippingCents ?? 0) + (state.shippingRule?.shippingCents ?? 0)); }
function shippingIdentity(session: CheckoutSession): string {
  return fingerprint(session.shipping ? { ...session.shipping, customerPrice: undefined } : null);
}

@Injectable()
export class CheckoutCommercialBenefitsService {
  constructor(@Inject(CASHBACK_REPOSITORY) private readonly repository: CashbackRepositoryPort) {}

  /** Acquire before merchant/config/session locks in an existing transaction. */
  async lockInTransaction(tx: CashbackTx, merchantId: string): Promise<void> {
    if (!merchantId || merchantId.length > 200) throw new CashbackError("cashback_merchant_invalid");
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`cashback:${merchantId}`}, 0))::text`;
  }
  /** Public legacy wrappers need the production fence before editing an
   * already-owned coupon. Existing outer coordinators retain their own fence. */
  private async lockPrepaymentBinding(tx: CashbackTx, session: CheckoutSession): Promise<void> {
    const current = await this.storedSession(tx, session);
    if (!current || !hasStoredCheckoutCouponBinding(current.cart)) return;
    await tx.$queryRaw`SELECT id FROM merchants WHERE id=${session.merchantId} FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM merchant_rules WHERE merchant_id=${session.merchantId} FOR UPDATE`;
    await tx.$queryRaw`SELECT merchant_id FROM checkout_settings WHERE merchant_id=${session.merchantId} FOR SHARE`;
    await lockCheckoutSessionAnchor(tx, session.merchantId, session.sessionId);
  }
  async hasCombinationInTransaction(tx: CashbackTx, session: Pick<CheckoutSession, "merchantId">): Promise<boolean> {
    return Boolean((await this.repository.program(tx, session.merchantId)).published?.combination);
  }
  async allowsCommercialStackingInTransaction(tx: CashbackTx, merchantId: string): Promise<boolean> {
    const policy = (await this.repository.program(tx, merchantId)).published?.combination;
    return Boolean(policy?.allowCoupons && policy.allowAdvancedRules);
  }
  async advancedDiscountCentsInTransaction(tx: CashbackTx, session: CheckoutSession): Promise<number | null> {
    if (!await this.hasCombinationInTransaction(tx, session)) return null;
    const current = await this.storedSession(tx, session); if (!current) return null;
    return (await this.state(tx, current)).data.advanced?.amountCents ?? 0;
  }
  async hasCombination(session: CheckoutSession): Promise<boolean> {
    return this.repository.transaction(session.merchantId, tx => this.hasCombinationInTransaction(tx, session));
  }
  /** Effective cap for this authorized composition, never a merchant-policy write. */
  async couponRulesInTransaction(tx: CashbackTx, session: CheckoutSession, rules: MerchantRules): Promise<MerchantRules> {
    const policy = (await this.repository.program(tx, session.merchantId)).published?.combination;
    if (!policy || policy.limitMode !== "cashback_specific") return rules;
    // Keep the exact configured decimal percentage. A money-only cap is
    // checked in cents by mandatory preflight before coupon quota is reserved.
    return { ...rules, maxDiscountPercent: policy.maximumCombinedDiscountBps === null ? 100 : policy.maximumCombinedDiscountBps / 100 };
  }
  /** Candidate calculation is read-only. Final admission still checks the
   * complete persisted composition under its own transaction and fences. */
  async candidateRules(session: CheckoutSession, rules: MerchantRules): Promise<MerchantRules> {
    return this.repository.transaction(session.merchantId, tx => this.couponRulesInTransaction(tx, session, rules));
  }
  async generalLimits(tx: CashbackTx, merchantId: string): Promise<{ generalDiscountCapBps: number; minimumMarginBps: number }> {
    const rows = await tx.$queryRaw<Array<{ max_discount_percent: unknown; minimum_margin_percent: unknown }>>`SELECT max_discount_percent,minimum_margin_percent FROM merchant_rules WHERE merchant_id=${merchantId}`;
    const generalDiscountCapBps = Math.round(Number(rows[0]?.max_discount_percent ?? DEFAULT_RULES.maxDiscountPercent) * 100);
    const minimumMarginBps = Math.round(Number(rows[0]?.minimum_margin_percent ?? DEFAULT_RULES.minimumMarginPercent) * 100);
    cents(generalDiscountCapBps, "general_rate"); cents(minimumMarginBps, "minimum_margin");
    if (generalDiscountCapBps > 10000 || minimumMarginBps > 10000) throw new CashbackError("cashback_merchant_limits_invalid");
    return { generalDiscountCapBps, minimumMarginBps };
  }
  private async storedSession(tx: CashbackTx, input: Pick<CheckoutSession, "merchantId" | "sessionId">, lock = false): Promise<CheckoutSession | null> {
    const rows = lock
      ? await tx.$queryRaw<Array<{ global_user_id: string; cart: CheckoutSession["cart"]; shipping: CheckoutSession["shipping"]; version?: number }>>`SELECT global_user_id,cart,shipping,version FROM checkout_sessions WHERE merchant_id=${input.merchantId} AND session_id=${input.sessionId} FOR UPDATE`
      : await tx.$queryRaw<Array<{ global_user_id: string; cart: CheckoutSession["cart"]; shipping: CheckoutSession["shipping"]; version?: number }>>`SELECT global_user_id,cart,shipping,version FROM checkout_sessions WHERE merchant_id=${input.merchantId} AND session_id=${input.sessionId}`;
    if (!rows[0]) return null;
    return { ...input, globalUserId: rows[0].global_user_id, cart: rows[0].cart, shipping: rows[0].shipping ?? undefined,
      ...(rows[0].version === undefined ? {} : { persistenceVersion: rows[0].version }) } as CheckoutSession;
  }
  private async mutable(tx: CashbackTx, session: CheckoutSession): Promise<void> {
    const protectedRows = await tx.$queryRaw<Array<{ blocked: boolean }>>`SELECT (
      EXISTS(SELECT 1 FROM payment_intents WHERE merchant_id=${session.merchantId} AND session_id=${session.sessionId} AND status IN ('pending','requires_action','approved')) OR
      EXISTS(SELECT 1 FROM cashback_earning_quotes WHERE merchant_id=${session.merchantId} AND session_id=${session.sessionId} AND state IN ('prepared','bound')) OR
      EXISTS(SELECT 1 FROM cashback_reservations WHERE merchant_id=${session.merchantId} AND session_id=${session.sessionId} AND state='payment_pending')) AS blocked`;
    if (protectedRows[0]?.blocked) throw new CashbackError("cashback_payment_in_progress", 409);
  }
  async assertMutable(session: CheckoutSession): Promise<void> {
    await this.repository.transaction(session.merchantId, tx => this.assertMutableInTransaction(tx, session));
  }
  async assertMutableInTransaction(tx: CashbackTx, session: CheckoutSession): Promise<void> {
      if (!(await this.repository.program(tx, session.merchantId)).published?.combination) return;
      await this.mutable(tx, session);
  }

  private async state(tx: CashbackTx, session: CheckoutSession, excludedRedemptionId = "", bootstrap = false): Promise<JournalRow> {
    const journal = bootstrap ? [] : await tx.$queryRaw<JournalRow[]>`SELECT data,version FROM cashback_checkout_benefits WHERE merchant_id=${session.merchantId} AND session_id=${session.sessionId}`;
    const current = money(session.cart.currentDiscount ?? 0);
    if (journal[0]) {
      if (journal[0].data.baseFingerprint !== baseFingerprint(session)) throw new CashbackError("cashback_commercial_cart_changed", 409);
      let data = journal[0].data;
      const currentShipping = requiresPhysicalDelivery(session.cart) ? money(session.shipping?.customerPrice ?? 0) : 0;
      const changedShipping = currentShipping !== data.baseShippingCents - shippingDiscount(data)
        || (data.shippingIdentity !== undefined && data.shippingIdentity !== shippingIdentity(session));
      // A fresh authoritative quotation is the new base. Reapply only the
      // already authorized absolute benefit; never revive an earlier quote.
      if (changedShipping) data = { ...data, baseShippingCents: currentShipping, shippingIdentity: shippingIdentity(session) };
      if (productDiscount(data) !== current) data = { ...data, coupon: null, advanced: null, unknownCents: current, unknownBenefit: true };
      return { version: journal[0].version, data };
    }
    const state: BenefitsState = { baseFingerprint: baseFingerprint(session), baseShippingCents: requiresPhysicalDelivery(session.cart) ? money(session.shipping?.customerPrice ?? 0) : 0, shippingIdentity: shippingIdentity(session),
      coupon: null, advanced: null, shippingRule: null, unknownCents: current, unknownBenefit: current > 0 || Boolean(session.cart.commercialNudge) };
    const cartRef = (session.cart as CheckoutSession["cart"] & { cart_ref?: string }).cart_ref;
    const coupons = await tx.$queryRaw<Array<{ id: string; coupon_id: string; code: string; discount_applied: unknown; discount_type: string }>>`
      SELECT r.id,r.coupon_id,c.code,r.discount_applied,c.discount_type FROM coupon_redemptions r JOIN coupons c ON c.id=r.coupon_id AND c.merchant_id=r.merchant_id
      WHERE r.merchant_id=${session.merchantId} AND r.id<>${excludedRedemptionId} AND r.status IN ('applied','redeemed') AND
        (r.session_id=${session.sessionId} OR (${cartRef ?? ""}<>'' AND r.session_id=${cartRef ?? ""} AND EXISTS(
          SELECT 1 FROM storefront_carts sc WHERE sc.merchant_id=r.merchant_id AND sc.session_id=${cartRef ?? ""} AND sc.coupon_code=c.code)))
      ORDER BY r.id`;
    if (coupons.length === 1) {
      const row = coupons[0]!; const amount = money(Number(row.discount_applied));
      if (amount <= current) {
        state.coupon = { id: row.coupon_id, redemptionId: row.id, code: row.code, amountCents: amount, shippingCents: 0 };
        state.unknownCents = current - amount; state.unknownBenefit = state.unknownCents > 0;
      }
    }
    if (!state.coupon && current > 0) {
      const offers = await tx.$queryRaw<Array<{ offer_id: string; type: string; value: unknown }>>`SELECT offer_id,type,value FROM accepted_offers WHERE merchant_id=${session.merchantId} AND session_id=${session.sessionId} AND type IN ('discount_percent','discount_fixed') ORDER BY accepted_at DESC`;
      const matches = offers.filter(row => (row.type === "discount_percent" ? Math.round(gross(session) * Number(row.value) / 100) : money(Number(row.value))) === current);
      if (matches.length > 0) { state.advanced = { id: matches[0]!.offer_id, amountCents: current, shippingCents: 0 }; state.unknownCents = 0; state.unknownBenefit = false; }
    }
    return { data: state, version: session.cart.commercialBenefitsVersion ?? 0 };
  }

  async context(tx: CashbackTx, session: CheckoutSession): Promise<CombinationContext> {
    return this.contextForState(tx, session, (await this.state(tx, session)).data);
  }
  private async contextForState(tx: CashbackTx, session: CheckoutSession, state: BenefitsState): Promise<CombinationContext> {
    const limits = await this.generalLimits(tx, session.merchantId);
    const costs = cents(session.cart.items.reduce((sum, line) => sum + money(line.cost ?? line.price * 0.5) * line.quantity, 0), "product_cost");
    const promotion = cashbackMerchandiseBasis(session.cart).promotionDiscountCents;
    return { origins: { couponCents: state.coupon?.amountCents ?? 0, advancedRuleCents: (state.advanced?.amountCents ?? 0) + promotion,
      unknownCents: state.unknownCents, hasCoupon: Boolean(state.coupon), hasAdvancedRule: Boolean(state.advanced || state.shippingRule || promotion),
      hasUnknown: state.unknownBenefit, couponStackable: state.coupon?.stackable },
      generalDiscountCapBps: limits.generalDiscountCapBps, marginDiscountLimitCents: marginDiscountLimit(gross(session), costs, limits.minimumMarginBps) };
  }
  private validateComposition(session: CheckoutSession, rules: CashbackRules, state: BenefitsState, context: CombinationContext): void {
    const discount = productDiscount(state) + cashbackMerchandiseBasis(session.cart).promotionDiscountCents;
    if (discount > gross(session) || discount > combinedDiscountCap(gross(session), rules.combination!, context.generalDiscountCapBps)) throw new CashbackError("cashback_combined_cap_exceeded", 409);
    if (discount > context.marginDiscountLimitCents) throw new CashbackError("cashback_minimum_margin", 409);
    if (state.unknownBenefit) throw new CashbackError("cashback_unknown_benefit_origin", 409);
    const both = rules.combination!.allowCoupons && rules.combination!.allowAdvancedRules;
    if (state.coupon && (state.advanced || state.shippingRule || cashbackMerchandiseBasis(session.cart).promotionDiscountCents)
      && (!both || state.coupon.stackable === false)) throw new CashbackError("cashback_commercial_combination_not_allowed", 409);
  }

  async allowCouponAfterExistingBenefit(merchantId: string, sessionId: string): Promise<boolean> {
    return this.repository.transaction(merchantId, tx => this.allowCouponAfterExistingBenefitInTransaction(tx, merchantId, sessionId));
  }
  async allowCouponAfterExistingBenefitInTransaction(tx: CashbackTx, merchantId: string, sessionId: string): Promise<boolean> {
      const rules = (await this.repository.program(tx, merchantId)).published;
      if (!rules?.combination?.allowCoupons || !rules.combination.allowAdvancedRules) return false;
      const session = await this.storedSession(tx, { merchantId, sessionId }); if (!session) return false;
      const state = (await this.state(tx, session)).data;
      return !state.coupon && !state.unknownBenefit && Boolean(state.advanced || state.shippingRule || cashbackMerchandiseBasis(session.cart).promotionDiscountCents);
  }
  async assertCanApplyCouponInTransaction(tx: CashbackTx, session: CheckoutSession, couponCode?: string): Promise<void> {
    if (!await this.hasCombinationInTransaction(tx, session)) return;
    await this.mutable(tx, session);
    const current = await this.storedSession(tx, session); if (!current) throw new CashbackError("cashback_session_missing", 404);
    if (baseFingerprint(current) !== baseFingerprint(session)) throw new CashbackError("cashback_commercial_cart_changed", 409);
    const state = (await this.state(tx, current)).data;
    if (state.coupon && state.coupon.code !== couponCode?.trim().toUpperCase()) throw new CashbackError("cashback_coupon_already_applied", 409);
  }
  async advancedDiscountCents(session: CheckoutSession): Promise<number | null> {
    return this.repository.transaction(session.merchantId, async tx => {
      if (!(await this.repository.program(tx, session.merchantId)).published?.combination) return null;
      const current = await this.storedSession(tx, session); if (!current) return null;
      return (await this.state(tx, current)).data.advanced?.amountCents ?? 0;
    });
  }
  async assertCanApplyCoupon(session: CheckoutSession, couponCode?: string): Promise<void> {
    await this.repository.transaction(session.merchantId, tx => this.assertCanApplyCouponInTransaction(tx, session, couponCode));
  }
  private withCoupon(state: BenefitsState, input: Omit<AuthorizedCouponResult, "redemption_id"> & { redemption_id?: string }): BenefitsState {
    if (state.coupon && state.coupon.id !== input.coupon.id) throw new CashbackError("cashback_coupon_already_applied", 409);
    return { ...state, coupon: { id: input.coupon.id, code: input.coupon.code, redemptionId: input.redemption_id ?? "preflight", amountCents: money(input.discount_applied), shippingCents: money(input.shipping_discount_applied ?? 0), ...(input.coupon.stackable === undefined ? {} : { stackable: input.coupon.stackable }) } };
  }
  async assertCouponResultAllowed(input: CouponPreflightInput): Promise<void> {
    await this.repository.transaction(input.merchantId, tx => this.assertCouponResultAllowedInTransaction(tx, input));
  }
  async assertCouponResultAllowedInTransaction(tx: CashbackTx, input: CouponPreflightInput): Promise<void> {
      const rules = (await this.repository.program(tx, input.merchantId)).published; if (!rules?.combination) return;
      const current = await this.storedSession(tx, input); if (!current) return;
      await this.mutable(tx, current); const row = await this.state(tx, current);
      this.validateComposition(current, rules, this.withCoupon(row.data, input), await this.context(tx, current));
  }

  private withAdvanced(session: CheckoutSession, state: BenefitsState, offer: AuthorizedOffer): BenefitsState {
    if (offer.merchantId !== session.merchantId || offer.sessionId !== session.sessionId || !offer.approved || Date.parse(offer.expiresAt) <= Date.now() || !Number.isFinite(offer.value) || offer.value < 0) throw new CashbackError("cashback_offer_not_authorized", 409);
    if (offer.type === "discount_fixed" || offer.type === "discount_percent") {
      const amount = offer.type === "discount_fixed" ? money(offer.value) : cents(Math.round(money(session.cart.total) * offer.value / 100), "advanced_discount");
      if (state.advanced && (state.advanced.amountCents > amount
        || state.advanced.amountCents === amount && state.advanced.id === offer.id)) return state;
      return { ...state, advanced: { id: offer.id, amountCents: amount, shippingCents: 0 } };
    }
    if (offer.type === "shipping_free" || offer.type === "shipping_discount_fixed") {
      if (!requiresPhysicalDelivery(session.cart)) throw new CashbackError("cashback_shipping_benefit_not_applicable");
      const shipping = offer.type === "shipping_free" ? state.baseShippingCents : Math.min(state.baseShippingCents, money(offer.value));
      if (state.shippingRule && state.shippingRule.shippingCents >= shipping) return state;
      return { ...state, shippingRule: { id: offer.id, amountCents: 0, shippingCents: shipping } };
    }
    throw new CashbackError("cashback_offer_type_not_supported");
  }
  async assertCanApplyAdvancedRule(session: CheckoutSession, offer: AuthorizedOffer): Promise<void> {
    await this.repository.transaction(session.merchantId, tx => this.assertCanApplyAdvancedRuleInTransaction(tx, session, offer));
  }
  async assertCanApplyAdvancedRuleInTransaction(tx: CashbackTx, session: CheckoutSession, offer: AuthorizedOffer): Promise<void> {
      const rules = (await this.repository.program(tx, session.merchantId)).published; if (!rules?.combination) return;
      await this.mutable(tx, session); const current = await this.storedSession(tx, session); if (!current) throw new CashbackError("cashback_session_missing", 404);
      if (baseFingerprint(current) !== baseFingerprint(session)) throw new CashbackError("cashback_commercial_cart_changed", 409);
      const row = await this.state(tx, current); this.validateComposition(current, rules, this.withAdvanced(current, row.data, offer), await this.context(tx, current));
  }
  private async save(tx: CashbackTx, original: CheckoutSession, state: BenefitsState, oldVersion: number, rules: CashbackRules, persistSession = true): Promise<CheckoutSession> {
    const version = oldVersion + 1;
    const next: CheckoutSession = { ...original, cart: { ...original.cart, currentDiscount: productDiscount(state) / 100, commercialBenefitsVersion: version } as CheckoutSession["cart"],
      shipping: original.shipping ? { ...original.shipping, customerPrice: (state.baseShippingCents - shippingDiscount(state)) / 100 } : undefined, updatedAt: new Date().toISOString() };
    next.cart.appliedBenefits = [
      ...(state.advanced?.amountCents ? [{ kind: "discount" as const, label: "Regra avançada", amount: state.advanced.amountCents / 100 }] : []),
      ...(state.coupon?.amountCents ? [{ kind: "discount" as const, label: `Cupom ${state.coupon.code}`, amount: state.coupon.amountCents / 100 }] : []),
      ...(shippingDiscount(state) ? [{ kind: "shipping" as const, label: "Desconto no frete", amount: shippingDiscount(state) / 100 }] : []),
    ];
    next.cart = await this.upgradeUnpaidCouponBinding(tx, original, next, state);
    await tx.$executeRaw`INSERT INTO cashback_checkout_benefits(merchant_id,session_id,data,version) VALUES(${original.merchantId},${original.sessionId},${JSON.stringify(state)}::jsonb,${version})
      ON CONFLICT(merchant_id,session_id) DO UPDATE SET data=EXCLUDED.data,version=EXCLUDED.version,updated_at=now()`;
    await tx.$executeRaw`INSERT INTO cashback_benefit_events(merchant_id,session_id,version,data) VALUES(${original.merchantId},${original.sessionId},${version},${JSON.stringify(state)}::jsonb)`;
    if (persistSession) {
      const updated = await tx.$queryRaw<Array<{ version: number }>>`UPDATE checkout_sessions SET cart=${JSON.stringify(next.cart)}::jsonb,shipping=${JSON.stringify(next.shipping ?? null)}::jsonb,updated_at=now() WHERE merchant_id=${original.merchantId} AND session_id=${original.sessionId} RETURNING version`;
      if (!updated[0]) throw new CashbackError("cashback_session_missing", 404);
      next.persistenceVersion = updated[0].version;
    }
    const active = await tx.$queryRaw<Array<{ id: string; buyer_id: string }>>`SELECT id,buyer_id FROM cashback_reservations WHERE merchant_id=${original.merchantId} AND session_id=${original.sessionId} AND state='reserved'`;
    if (active[0]) {
      const w = await this.repository.wallet(tx, original.merchantId, active[0].buyer_id); advance(w, new Date());
      const reservation = w.reservations.find(r => r.id === active[0]!.id && r.state === "reserved");
      if (reservation) {
        const available = w.grants.reduce((sum, grant) => sum + grant.availableCents, 0) + reservation.amountCents;
        const limit = cashbackCombinedLimit({ grossCents: gross(next), netProductsCents: cashbackMerchandiseBasis(next.cart).netProductsCents, availableCents: available, rules, context: await this.context(tx, next) });
        shrinkReservation(w, reservation.id, limit.maximumCashbackCents, paymentCartFingerprint(next), new Date());
      }
      await this.repository.saveWallet(tx, w);
    }
    return next;
  }

  /** Dedicated prepayment generation upgrade. Never rewrites an identity that
   * any payment/earning journal has already frozen, even a failed attempt. */
  private async upgradeUnpaidCouponBinding(tx: CashbackTx, original: CheckoutSession, next: CheckoutSession,
    state: BenefitsState): Promise<CheckoutSession["cart"]> {
    const binding = readStoredCheckoutCouponBinding(original.cart);
    if (!binding || binding.state === "released") return next.cart;
    const coupon = state.coupon;
    if (binding.state !== "active" || !coupon || binding.merchantId !== original.merchantId
      || binding.checkoutSessionId !== original.sessionId || binding.buyerId !== original.globalUserId
      || binding.cartId !== original.cart.cart_ref || binding.couponId !== coupon.id || binding.redemptionId !== coupon.redemptionId
      || binding.discountCents !== coupon.amountCents || paymentCartFingerprint(original) !== binding.basisHash)
      throw new CashbackError("cashback_coupon_authorization_missing", 409);
    const frozen = await tx.$queryRaw<Array<{ found: boolean }>>`SELECT (
      EXISTS(SELECT 1 FROM payment_intents WHERE merchant_id=${original.merchantId} AND session_id=${original.sessionId}) OR
      EXISTS(SELECT 1 FROM completed_orders WHERE merchant_id=${original.merchantId} AND session_id=${original.sessionId}) OR
      EXISTS(SELECT 1 FROM cashback_earning_quotes WHERE merchant_id=${original.merchantId} AND session_id=${original.sessionId})) AS found`;
    if (frozen[0]?.found) throw new CashbackError("cashback_payment_requires_reopen", 409);
    await lockStorefrontCart(tx, original.merchantId, binding.cartId);
    const source = await tx.storefrontCart.findUnique({ where: { merchantId_sessionId: { merchantId: original.merchantId, sessionId: binding.cartId } } });
    const reservation = await tx.couponRedemption.findFirst({ where: { id: coupon.redemptionId, merchantId: original.merchantId,
      sessionId: binding.cartId, couponId: coupon.id, status: "applied", orderId: null } });
    if (!source || source.merchantId !== original.merchantId || source.sessionId !== binding.cartId || source.couponCode !== coupon.code
      || source.discount !== coupon.amountCents || !reservation || Math.round(Number(reservation.discountApplied) * 100) !== coupon.amountCents
      || reservation.buyerGlobalUserId !== binding.reservationBuyerId) throw new CashbackError("cashback_coupon_authorization_missing", 409);
    await assertStorefrontCouponSourceProjection(tx, { merchantId: original.merchantId, cartId: binding.cartId }, source, original.cart);
    const upgraded = parseCheckoutCouponBinding({ ...binding, version: 2, combinedDiscountCents: productDiscount(state),
      commercialBenefitsVersion: next.cart.commercialBenefitsVersion, basisHash: paymentCartFingerprint(next) });
    return { ...next.cart, _storefrontCouponBinding: upgraded } as CheckoutSession["cart"];
  }

  async applyCoupon(session: CheckoutSession, result: AuthorizedCouponResult): Promise<CheckoutSession | null> {
    const outcome = await this.repository.transaction(session.merchantId, async tx => {
      const rules = (await this.repository.program(tx, session.merchantId)).published; if (!rules?.combination) return { session: null };
      await tx.$executeRawUnsafe("SAVEPOINT cashback_coupon_composition");
      try {
        return { session: await this.applyCouponInTransaction(tx, session, result) };
      } catch (error) {
        await tx.$executeRawUnsafe("ROLLBACK TO SAVEPOINT cashback_coupon_composition");
        // Upstream quota reservation is a separate committed transaction. A
        // rejected new coupon must not occupy quota or later be redeemed.
        await tx.$executeRaw`UPDATE coupon_redemptions r SET status='cancelled',updated_at=now() WHERE r.id=${result.redemption_id} AND r.merchant_id=${session.merchantId} AND r.session_id=${session.sessionId} AND r.status='applied'
          AND NOT EXISTS(SELECT 1 FROM cashback_checkout_benefits b WHERE b.merchant_id=r.merchant_id AND b.session_id=r.session_id AND b.data->'coupon'->>'redemptionId'=r.id)`;
        return { error };
      }
    });
    if ("error" in outcome) throw outcome.error; return outcome.session;
  }
  /** Caller owns the outer rollback; never cancels a different committed grant. */
  async applyCouponInTransaction(tx: CashbackTx, session: CheckoutSession, result: AuthorizedCouponResult,
    options: { persistSession?: boolean; redemptionSessionId?: string } = {}): Promise<CheckoutSession | null> {
    const rules = (await this.repository.program(tx, session.merchantId)).published; if (!rules?.combination) return null;
    await this.mutable(tx, session); const current = await this.storedSession(tx, session, true); if (!current) throw new CashbackError("cashback_session_missing", 404);
    if (baseFingerprint(current) !== baseFingerprint(session)) throw new CashbackError("cashback_commercial_cart_changed", 409);
    const redemptionSessionId = options.redemptionSessionId ?? session.sessionId;
    if (redemptionSessionId !== session.sessionId && redemptionSessionId !== session.cart.cart_ref) throw new CashbackError("cashback_coupon_authorization_missing", 409);
    const rows = await tx.$queryRaw<Array<{ coupon_id: string; discount_applied: unknown }>>`SELECT r.coupon_id,r.discount_applied FROM coupon_redemptions r JOIN coupons c ON c.id=r.coupon_id AND c.merchant_id=r.merchant_id
      WHERE r.id=${result.redemption_id} AND r.merchant_id=${session.merchantId} AND r.session_id=${redemptionSessionId} AND r.status='applied' AND c.status='active' AND c.starts_at<=now() AND (c.ends_at IS NULL OR c.ends_at>now())`;
    if (!rows[0] || rows[0].coupon_id !== result.coupon.id || money(Number(rows[0].discount_applied)) !== money(result.discount_applied)) throw new CashbackError("cashback_coupon_authorization_missing", 409);
    const row = await this.state(tx, current, result.redemption_id); const state = this.withCoupon(row.data, result);
    if (result.shipping_discount_applied && !requiresPhysicalDelivery(current.cart)) throw new CashbackError("cashback_shipping_benefit_not_applicable");
    this.validateComposition(current, rules, state, await this.context(tx, current));
    if (fingerprint(row.data) === fingerprint(state) && row.version > 0) return { ...session, ...current };
    const nudge: CheckoutSession["cart"]["commercialNudge"] = { kind: "coupon", title: "Cupom aplicado", message: `O cupom ${result.coupon.code} foi aplicado.`, couponCode: result.coupon.code };
    const appliedBenefits = [
      ...(state.advanced?.amountCents ? [{ kind: "discount" as const, label: "Regra avançada", amount: state.advanced.amountCents / 100 }] : []),
      ...(state.coupon?.amountCents ? [{ kind: "discount" as const, label: `Cupom ${result.coupon.code}`, amount: state.coupon.amountCents / 100 }] : []),
      ...(shippingDiscount(state) ? [{ kind: "shipping" as const, label: "Desconto no frete", amount: shippingDiscount(state) / 100 }] : []),
    ];
    return this.save(tx, { ...session, ...current, cart: { ...current.cart, commercialNudge: nudge, appliedBenefits } }, state, row.version, rules, options.persistSession !== false);
  }
  async applyAdvancedRule(session: CheckoutSession, offer: AuthorizedOffer): Promise<CheckoutSession | null> {
    return this.repository.transaction(session.merchantId, async tx => {
      await this.lockPrepaymentBinding(tx, session);
      return this.applyAdvancedRuleInTransaction(tx, session, offer);
    });
  }
  async applyAdvancedRuleInTransaction(tx: CashbackTx, session: CheckoutSession, offer: AuthorizedOffer,
    options: { persistSession?: boolean } = {}): Promise<CheckoutSession | null> {
      const rules = (await this.repository.program(tx, session.merchantId)).published; if (!rules?.combination) return null;
      await this.mutable(tx, session); const current = await this.storedSession(tx, session, true); if (!current) throw new CashbackError("cashback_session_missing", 404);
      if (baseFingerprint(current) !== baseFingerprint(session)) throw new CashbackError("cashback_commercial_cart_changed", 409);
      const row = await this.state(tx, current); const state = this.withAdvanced(current, row.data, offer);
      this.validateComposition(current, rules, state, await this.context(tx, current));
      if (fingerprint(row.data) === fingerprint(state) && row.version > 0) return { ...session, ...current };
      const nudge: CheckoutSession["cart"]["commercialNudge"] = { kind: "advanced_rule", title: "Regra aplicada", message: "A condição autorizada foi aplicada ao pedido.", ruleId: offer.id };
      return this.save(tx, { ...session, ...current, cart: { ...current.cart, commercialNudge: nudge } }, state, row.version, rules, options.persistSession !== false);
  }
  async applyCartChange(nextSession: CheckoutSession): Promise<CheckoutSession | null> {
    return this.repository.transaction(nextSession.merchantId, tx => this.applyCartChangeInTransaction(tx, nextSession));
  }
  /** Dedicated source-cart owner has already recalculated and persisted its
   * real coupon reservation in this tx. Preserve only that exact proven C;
   * invalidate old rule/cashback promises for the changed merchandise. */
  async applyDedicatedCartChangeInTransaction(tx: CashbackTx, expected: CheckoutSession, next: CheckoutSession,
    options: { persistSession?: boolean } = {}): Promise<CheckoutSession | null> {
    const rules = (await this.repository.program(tx, expected.merchantId)).published; if (!rules?.combination) return null;
    await this.mutable(tx, expected);
    const current = await this.storedSession(tx, expected, true);
    if (!current || expected.merchantId !== next.merchantId || expected.sessionId !== next.sessionId
      || current.globalUserId !== next.globalUserId || expected.globalUserId !== next.globalUserId
      || paymentCartFingerprint(current) !== paymentCartFingerprint(expected)
      || current.persistenceVersion !== expected.persistenceVersion || next.cart.source !== "storefront"
      || !next.cart.cart_ref || current.cart.cart_ref !== next.cart.cart_ref) throw new CashbackError("cashback_commercial_cart_changed", 409);
    const source = await tx.storefrontCart.findUnique({ where: { merchantId_sessionId: { merchantId: next.merchantId, sessionId: next.cart.cart_ref } } });
    if (!source || source.merchantId !== next.merchantId || source.sessionId !== next.cart.cart_ref
      || money(next.cart.currentDiscount ?? 0) !== source.discount) throw new CashbackError("cashback_coupon_authorization_missing", 409);
    const state = (await this.state(tx, next, "", true)).data;
    if ((source.couponCode === null) !== (state.coupon === null) || state.coupon && state.coupon.code !== source.couponCode
      || state.advanced || state.unknownBenefit || state.unknownCents !== 0) throw new CashbackError("cashback_unknown_benefit_origin", 409);
    this.validateComposition(next, rules, state, await this.contextForState(tx, next, state));
    const prior = await tx.$queryRaw<Array<{ version: number }>>`SELECT version FROM cashback_checkout_benefits WHERE merchant_id=${next.merchantId} AND session_id=${next.sessionId}`;
    const active = await tx.$queryRaw<Array<{ id: string; buyer_id: string }>>`SELECT id,buyer_id FROM cashback_reservations WHERE merchant_id=${next.merchantId} AND session_id=${next.sessionId} AND state='reserved'`;
    if (active[0]) {
      const wallet = await this.repository.wallet(tx, next.merchantId, active[0].buyer_id);
      shrinkReservation(wallet, active[0].id, 0, paymentCartFingerprint(next), new Date()); await this.repository.saveWallet(tx, wallet);
    }
    return this.save(tx, next, state, prior[0]?.version ?? current.cart.commercialBenefitsVersion ?? 0, rules, options.persistSession !== false);
  }
  async applyCartChangeInTransaction(tx: CashbackTx, nextSession: CheckoutSession,
    options: { persistSession?: boolean } = {}): Promise<CheckoutSession | null> {
      if (!(await this.repository.program(tx, nextSession.merchantId)).published?.combination) return null;
      await this.mutable(tx, nextSession); const old = await this.storedSession(tx, nextSession, true); if (!old) throw new CashbackError("cashback_session_missing", 404);
      const cartRef = (old.cart as CheckoutSession["cart"] & { cart_ref?: string }).cart_ref;
      await tx.$executeRaw`UPDATE coupon_redemptions SET status='cancelled',updated_at=now() WHERE merchant_id=${old.merchantId} AND status='applied' AND (session_id=${old.sessionId} OR (${cartRef ?? ""}<>'' AND session_id=${cartRef ?? ""}))`;
      const prior = await tx.$queryRaw<Array<{ version: number }>>`SELECT version FROM cashback_checkout_benefits WHERE merchant_id=${old.merchantId} AND session_id=${old.sessionId}`;
      const version = (prior[0]?.version ?? old.cart.commercialBenefitsVersion ?? 0) + 1;
      const next = { ...nextSession, cart: { ...nextSession.cart, currentDiscount: 0, commercialNudge: undefined, commercialBenefitsVersion: version } as CheckoutSession["cart"], updatedAt: new Date().toISOString() };
      const empty: BenefitsState = { baseFingerprint: baseFingerprint(next), baseShippingCents: requiresPhysicalDelivery(next.cart) ? money(next.shipping?.customerPrice ?? 0) : 0, shippingIdentity: shippingIdentity(next),
        coupon: null, advanced: null, shippingRule: null, unknownCents: 0, unknownBenefit: false };
      await tx.$executeRaw`INSERT INTO cashback_checkout_benefits(merchant_id,session_id,data,version) VALUES(${old.merchantId},${old.sessionId},${JSON.stringify(empty)}::jsonb,${version})
        ON CONFLICT(merchant_id,session_id) DO UPDATE SET data=EXCLUDED.data,version=EXCLUDED.version,updated_at=now()`;
      if (cartRef) await tx.$executeRaw`UPDATE storefront_carts SET coupon_code=NULL,discount=0,free_shipping=false,updated_at=now() WHERE merchant_id=${old.merchantId} AND session_id=${cartRef}`;
      if (options.persistSession !== false) {
        const updated = await tx.$queryRaw<Array<{ version: number }>>`UPDATE checkout_sessions SET cart=${JSON.stringify(next.cart)}::jsonb,shipping=${JSON.stringify(next.shipping ?? null)}::jsonb,updated_at=now() WHERE merchant_id=${old.merchantId} AND session_id=${old.sessionId} RETURNING version`;
        if (!updated[0]) throw new CashbackError("cashback_session_missing", 404);
        next.persistenceVersion = updated[0].version;
      }
      await tx.$executeRaw`INSERT INTO cashback_benefit_events(merchant_id,session_id,version,data) VALUES(${old.merchantId},${old.sessionId},${version},${JSON.stringify({ reset: true, fingerprint: baseFingerprint(next) })}::jsonb)`;
      const reservations = await tx.$queryRaw<Array<{ id: string; buyer_id: string }>>`SELECT id,buyer_id FROM cashback_reservations WHERE merchant_id=${old.merchantId} AND session_id=${old.sessionId} AND state='reserved'`;
      if (reservations[0]) {
        const w = await this.repository.wallet(tx, old.merchantId, reservations[0].buyer_id);
        shrinkReservation(w, reservations[0].id, 0, paymentCartFingerprint(next), new Date()); await this.repository.saveWallet(tx, w);
      }
      return next;
  }
}
