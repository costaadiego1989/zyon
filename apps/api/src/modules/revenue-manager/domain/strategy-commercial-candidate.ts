import type { MerchantRules } from "@zyon/shared-types";
import { moneyCents } from "@zyon/rules-engine";
import { authorizeShippingDiscount } from "@zyon/shipping-engine";
import type { CohortStats } from "./services/discount-rule-hypothesis.service.js";
import type { StrategyDiscountStudy } from "./strategy-discount-study.js";

export type CommercialCandidate = {
  kind: "capped_percentage_discount" | "capped_fixed_discount" | "capped_shipping_discount";
  maxDiscountCents: number;
  delivery: "automatic" | "coupon_code";
  evidence: {
    basis: "percentage_discount_replay" | "similar_cart_values" | "observed_shipping_burden";
    sampleSize: number;
    minShippingCents?: number;
    maxShippingCents?: number;
    maxShippingCostCents?: number;
  };
};

/** A deterministic choice from the same mature cohort, never a prediction of
 * uplift. Missing quote/cost information cannot become a shipping strategy. */
export function commercialCandidate(study: StrategyDiscountStudy, cohorts: CohortStats[], rules: MerchantRules): CommercialCandidate | null {
  if (study.status !== "candidate_available") return null;
  const { candidate } = study, sample = candidate.simulation;
  const cohort = cohorts.find(c => c.intent === candidate.intent);
  if (!cohort || cohort.carts.length !== sample.sampleSize) return null;
  const fixedCeiling = Number(BigInt(sample.minCartTotalCents) * BigInt(Math.round(candidate.percent * 100)) / 10000n);
  const shipping = cohort.shipping;
  if (rules.allowShippingDiscount && shipping?.length === cohort.carts.length && shipping.every((quote, i) => {
    const price = moneyCents(quote?.customerPrice), cost = moneyCents(quote?.realCost), total = moneyCents(cohort.carts[i].total);
    return price !== null && cost !== null && total !== null && price > 0 && price >= cost && price * 10 >= total;
  })) {
    const quotes = shipping.map(q => q!);
    let low = 0, high = Math.min(fixedCeiling, sample.maxDiscountCents,
      moneyCents(rules.maxPartialShippingDiscount) ?? 0, moneyCents(rules.maxShippingSubsidy) ?? 0,
      ...quotes.map(q => moneyCents(q.customerPrice)!));
    while (low < high) {
      const mid = Math.ceil((low + high) / 2);
      if (cohort.carts.every((cart, i) => authorizeShippingDiscount({ cart, shipping: quotes[i], rules,
        requestedDiscount: mid / 100, type: "shipping_discount_fixed" }).approved)) low = mid;
      else high = mid - 1;
    }
    if (low > 0) return { kind: "capped_shipping_discount", maxDiscountCents: low, delivery: "automatic",
      evidence: { basis: "observed_shipping_burden", sampleSize: sample.sampleSize,
        minShippingCents: Math.min(...quotes.map(q => moneyCents(q.customerPrice)!)),
        maxShippingCents: Math.max(...quotes.map(q => moneyCents(q.customerPrice)!)),
        maxShippingCostCents: Math.max(...quotes.map(q => moneyCents(q.realCost)!)) } };
  }
  // A fixed amount is intelligible when basket values differ by at most 10%.
  // The smallest replayed basket sets the bound for every eligible buyer.
  if (candidate.intent === "price_sensitive" && fixedCeiling > 0
    && BigInt(sample.maxCartTotalCents) * 100n <= BigInt(sample.minCartTotalCents) * 110n) {
    return { kind: "capped_fixed_discount", maxDiscountCents: fixedCeiling,
      delivery: rules.couponBoxEnabled ? "coupon_code" : "automatic",
      evidence: { basis: "similar_cart_values", sampleSize: sample.sampleSize } };
  }
  return { kind: "capped_percentage_discount", maxDiscountCents: sample.maxDiscountCents, delivery: "automatic",
    evidence: { basis: "percentage_discount_replay", sampleSize: sample.sampleSize } };
}

export function assertCommercialCandidate(value: CommercialCandidate | null, study: StrategyDiscountStudy, rules: MerchantRules) {
  const invalid = () => { throw new Error("STRATEGY_INVALID_DISCOUNT_STUDY"); };
  if (study.status !== "candidate_available") { if (value !== null) invalid(); return; }
  if (!value || !value.evidence) return invalid();
  const s = study.candidate.simulation, e = value.evidence;
  const fixedCeiling = Number(BigInt(s.minCartTotalCents) * BigInt(Math.round(study.candidate.percent * 100)) / 10000n);
  if (!Number.isSafeInteger(value.maxDiscountCents) || value.maxDiscountCents < 1
    || value.maxDiscountCents > s.maxDiscountCents || e.sampleSize !== s.sampleSize
    || !["automatic", "coupon_code"].includes(value.delivery)
    || (value.delivery === "coupon_code" && !rules.couponBoxEnabled)
    || Object.keys(value).sort().join() !== ["kind", "maxDiscountCents", "delivery", "evidence"].sort().join()) invalid();
  const evidenceKeys = ["basis", "sampleSize"];
  if (value.kind === "capped_shipping_discount") {
    evidenceKeys.push("minShippingCents", "maxShippingCents", "maxShippingCostCents");
    if (e.basis !== "observed_shipping_burden" || !rules.allowShippingDiscount || value.delivery !== "automatic"
      || [e.minShippingCents, e.maxShippingCents, e.maxShippingCostCents].some(n => !Number.isSafeInteger(n) || n! < 0)
      || !e.minShippingCents || e.minShippingCents > e.maxShippingCents!
      || value.maxDiscountCents > Math.min(fixedCeiling, e.minShippingCents, moneyCents(rules.maxPartialShippingDiscount) ?? 0,
        moneyCents(rules.maxShippingSubsidy) ?? 0)) invalid();
  } else if (value.kind === "capped_fixed_discount") {
    if (e.basis !== "similar_cart_values" || study.candidate.intent !== "price_sensitive"
      || value.maxDiscountCents !== fixedCeiling || BigInt(s.maxCartTotalCents) * 100n > BigInt(s.minCartTotalCents) * 110n) invalid();
  } else if (value.kind !== "capped_percentage_discount" || e.basis !== "percentage_discount_replay"
    || value.delivery !== "automatic" || value.maxDiscountCents !== s.maxDiscountCents) invalid();
  if (Object.keys(e).sort().join() !== evidenceKeys.sort().join()) invalid();
}
