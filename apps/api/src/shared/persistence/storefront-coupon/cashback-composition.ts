import { z } from "zod";
import type { Prisma } from "@prisma/client";
import type { CheckoutSession, MerchantRules } from "@zyon/shared-types";
import { moneyCents } from "@zyon/rules-engine";
import { paymentCartFingerprint } from "../../../modules/checkout/domain/services/payment-cart-fingerprint.js";
import { toMerchantRules } from "../../../modules/checkout/infrastructure/prisma/merchant-rules.mapper.js";
import { combinedDiscountCap, marginDiscountLimit, validateCombination } from "../../../modules/cashback/domain/cashback-combination.js";
import { cashbackMerchandiseBasis } from "../../../modules/cashback/domain/cashback-merchandise.js";
import { fingerprint } from "../../../modules/cashback/domain/cashback.js";

const cents = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const reference = z.string().min(1).max(191);
const benefit = z.strictObject({ id: reference, amountCents: cents, shippingCents: cents });
const coupon = benefit.extend({ redemptionId: reference, code: reference, stackable: z.boolean().optional() });
const stateSchema = z.strictObject({ baseFingerprint: z.string().length(64), baseShippingCents: cents,
  shippingIdentity: z.string().optional(), coupon: coupon.nullable(), advanced: benefit.nullable(), shippingRule: benefit.nullable(),
  unknownCents: cents, unknownBenefit: z.boolean() });
function conflict(): never { throw new Error("checkout_coupon_binding_conflict"); }
function amount(value: number): number { const result = moneyCents(value); return result === null ? conflict() : result; }

export type CashbackCouponComposition = {
  coupon: z.output<typeof coupon> | null;
  advanced: z.output<typeof benefit> | null;
  journalHash: string;
  cashbackRuleVersion: number;
  combinedDiscountCents: number;
  commercialBenefitsVersion: number;
  effectiveRules: MerchantRules;
};

/** Server-owned journal proof only. A cart version is a lookup key, never a grant.
 * Caller retains merchant/config -> session -> cart fences in this transaction.
 * No nested transaction, provider I/O, grant or journal write occurs here. */
export async function readCashbackCouponComposition(tx: Prisma.TransactionClient, session: CheckoutSession,
  options: { cashbackRuleVersion?: number } = {}): Promise<CashbackCouponComposition | undefined> {
  const version = session.cart.commercialBenefitsVersion;
  // Legacy V1 reads must remain valid before the additive cashback migrations.
  if (version === undefined || version === 0) return undefined;
  if (!Number.isSafeInteger(version) || version < 1) return conflict();
  const rows = await tx.$queryRaw<Array<{ version: number; data: unknown; published: unknown; rule_version: number }>>`
    SELECT b.version,b.data,p.published,p.version AS rule_version FROM cashback_checkout_benefits b
    JOIN cashback_programs p ON p.merchant_id=b.merchant_id
    WHERE b.merchant_id=${session.merchantId} AND b.session_id=${session.sessionId}`;
  if (rows.length !== 1 || rows[0]!.version !== version) return conflict();
  const parsed = stateSchema.safeParse(rows[0]!.data);
  let published = rows[0]!.published;
  if (options.cashbackRuleVersion !== undefined) {
    if (!Number.isSafeInteger(options.cashbackRuleVersion) || options.cashbackRuleVersion < 1) return conflict();
    const history = await tx.$queryRaw<Array<{ rules: unknown }>>`SELECT rules FROM cashback_rule_versions
      WHERE merchant_id=${session.merchantId} AND version=${options.cashbackRuleVersion}`;
    if (history.length !== 1) return conflict(); published = history[0]!.rules;
  }
  if (!parsed.success || !published || typeof published !== "object" || !("combination" in published)) return conflict();
  let policy;
  try { policy = validateCombination(published.combination); } catch { return conflict(); }
  const state = parsed.data;
  const base = paymentCartFingerprint({ ...session, cart: { ...session.cart, currentDiscount: 0, commercialBenefitsVersion: undefined },
    shipping: session.shipping ? { ...session.shipping, customerPrice: 0 } : undefined });
  const combinedDiscountCents = amount(session.cart.currentDiscount ?? 0);
  if (state.baseFingerprint !== base || state.unknownBenefit || state.unknownCents !== 0
    || (state.coupon?.amountCents ?? 0) + (state.advanced?.amountCents ?? 0) !== combinedDiscountCents) return conflict();
  const basis = cashbackMerchandiseBasis(session.cart);
  if (state.coupon && (state.advanced || state.shippingRule || basis.promotionDiscountCents)
    && (!policy.allowCoupons || !policy.allowAdvancedRules || state.coupon.stackable === false)) return conflict();
  const row = await tx.merchantRule.findUnique({ where: { merchantId: session.merchantId } });
  if (!row || row.merchantId !== session.merchantId) return conflict();
  const rules = toMerchantRules(row);
  const subtotal = basis.grossCents;
  const costs = session.cart.items.reduce((sum, line) => sum + Math.round((line.cost ?? line.price * 0.5) * 100) * line.quantity, 0);
  if (!Number.isSafeInteger(subtotal) || !Number.isSafeInteger(costs)) return conflict();
  const cap = combinedDiscountCap(subtotal, policy, Math.round(rules.maxDiscountPercent * 100));
  const effectiveDiscountCents = combinedDiscountCents + basis.promotionDiscountCents;
  if (effectiveDiscountCents > cap || effectiveDiscountCents > marginDiscountLimit(subtotal, costs, Math.round(rules.minimumMarginPercent * 100))) return conflict();
  const effectiveRules = policy.limitMode === "cashback_specific"
    ? { ...rules, maxDiscountPercent: policy.maximumCombinedDiscountBps === null ? 100 : policy.maximumCombinedDiscountBps / 100 } : rules;
  return { coupon: state.coupon, advanced: state.advanced, journalHash: fingerprint(state),
    cashbackRuleVersion: options.cashbackRuleVersion ?? rows[0]!.rule_version,
    combinedDiscountCents, commercialBenefitsVersion: version, effectiveRules };
}
