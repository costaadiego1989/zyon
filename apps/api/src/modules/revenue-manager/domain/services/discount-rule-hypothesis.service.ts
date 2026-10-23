import { createHash } from "node:crypto";
import type { AdvancedRule, Cart, MerchantRules, ShippingQuote } from "@zyon/shared-types";
import { assessIncentiveMargin, cartAmountIssue, evaluateDiscountOffer, moneyCents } from "@zyon/rules-engine";

export interface CohortStats {
  intent: string;
  sampleSize: number;
  conversionRate: number;
  /** One mature observation per buyer, priced with the merchant's current catalog. */
  carts: Cart[];
  /** Aligned with carts; missing carrier costs must remain unavailable. */
  shipping?: Array<ShippingQuote | undefined>;
}

export interface DiscountSimulation {
  definition: "discount-catalog-replay-v1" | "discount-catalog-replay-v2";
  currency: "BRL";
  sampleSize: number;
  conversionWindowHours: 168;
  observedConversionRate: number;
  costBasis: "current_catalog";
  paymentFeeAssumptionPercent: 4;
  /** Informational only. v2 leaves incomplete cost coverage explicitly unavailable. */
  minimumProjectedMarginPercent: number | null;
  minCartTotalCents: number;
  maxCartTotalCents: number;
  maxDiscountCents: number;
  /** Hypothetical expenditure across these carts, not a forecast or reserved budget. */
  replayDiscountTotalCents: number;
  expectedLiftStatus: "not_estimated";
}

export interface DiscountRuleCandidate {
  rule: AdvancedRule;
  rationale: string;
  simulation: DiscountSimulation;
  fingerprint: string;
}

const LOW_CONVERSION_THRESHOLD = 0.15;
const discountCents = (total: number, bps: number) => Number(BigInt(total) * BigInt(bps) / 10_000n);

/** Drafts only. Runtime rules remain authoritative for each actual checkout.
 * No instance-wide memory: callers provide fingerprints from the same store/cycle. */
export class DiscountRuleHypothesisService {
  generate(stats: CohortStats[], rules: MerchantRules, minSamples = 30,
    excluded: ReadonlySet<string> = new Set()): DiscountRuleCandidate | null {
    const cap = moneyCents(rules.maxDiscountPercent);
    if (rules.autonomousEngineEnabled !== true || cap === null || cap <= 0 || cap > 10_000
      || !Number.isSafeInteger(minSamples) || minSamples < 30 || !Array.isArray(stats)) return null;
    const eligible = stats.filter(s => Number.isSafeInteger(s.sampleSize) && s.sampleSize >= minSamples
      && Array.isArray(s.carts) && s.carts.length === s.sampleSize && /^[a-z][a-z0-9_]{0,63}$/.test(s.intent)
      && Number.isFinite(s.conversionRate) && s.conversionRate >= 0 && s.conversionRate < LOW_CONVERSION_THRESHOLD)
      .sort((a, b) => a.conversionRate - b.conversionRate || a.intent.localeCompare(b.intent));
    for (const cohort of eligible) {
      const candidate = this.simulate(cohort, rules, cohort.intent === "price_sensitive" ? cap : Math.floor(cap / 2));
      if (candidate && !excluded.has(candidate.fingerprint)) return candidate;
    }
    return null;
  }

  private simulate(cohort: CohortStats, rules: MerchantRules, capBps: number): DiscountRuleCandidate | null {
    const totals = cohort.carts.map(cart => moneyCents(cart.total));
    if (totals.some(t => t === null || t <= 0) || cohort.carts.some(cart => cart.currency !== "BRL"
      || (cart.currentDiscount ?? 0) !== 0 || cart.commercialNudge || (cart as Cart & { crossStoreItems?: unknown[] }).crossStoreItems?.length
      || cartAmountIssue(cart)
      || cart.items.some(item => item.selected_options !== undefined
        && (!Array.isArray(item.selected_options) || item.selected_options.length > 0)))) return null;
    const cents = totals as number[];
    // Cost is optional evidence, not authority. Apply the same configured ceiling
    // to each canonical basket; never manufacture cost to make it eligible.
    const discounts = cents.map(total => discountCents(total, capBps));
    if (capBps === 0 || discounts.some(d => d <= 0)) return null;
    const replayDiscountTotalCents = discounts.reduce((sum, d) => sum + d, 0);
    if (!Number.isSafeInteger(replayDiscountTotalCents)) return null;
    const maxDiscountCents = Math.max(...discounts), minCartTotalCents = Math.min(...cents), maxCartTotalCents = Math.max(...cents);
    const percent = capBps / 100, maxDiscountReais = maxDiscountCents / 100;
    if (!cohort.carts.every(cart => evaluateDiscountOffer(cart, rules, percent, maxDiscountReais).approved)) return null;
    const margins = cohort.carts.map((cart, i) => assessIncentiveMargin(cart, { totalDiscount: discounts[i] / 100 }).marginPercent);
    const minimumProjectedMarginPercent = margins.some(value => value === null) ? null
      : Math.min(...margins.map(value => value! * 100));
    const fingerprint = createHash("sha256").update(JSON.stringify(["discount-catalog-replay-v2", cohort.intent,
      percent, maxDiscountReais, minCartTotalCents, maxCartTotalCents])).digest("hex");
    return {
      rule: { id: fingerprint, name: `Desconto para ${cohort.intent}`, enabled: false, priority: 100,
        conditions: [{ field: "buyer_type", operator: "is", value: cohort.intent },
          { field: "cart_total", operator: "gte", value: minCartTotalCents / 100 },
          { field: "cart_total", operator: "lte", value: maxCartTotalCents / 100 },
          { field: "coupon_applied", operator: "is", value: false }],
        action: { type: "offer_discount", params: { percent, maxDiscountReais } } },
      rationale: `Testar desconto de ${percent}% (até R$ ${maxDiscountReais.toFixed(2)}) para o perfil "${cohort.intent}". `
        + `Conversão observada: ${(cohort.conversionRate * 100).toFixed(1)}% em ${cohort.sampleSize} compradores com janela encerrada. `
        + "A simulação usa o catálogo atual e respeita o teto de desconto da empresa. O efeito na conversão ainda precisa ser medido.",
      simulation: { definition: "discount-catalog-replay-v2", currency: "BRL", sampleSize: cohort.sampleSize,
        conversionWindowHours: 168, observedConversionRate: cohort.conversionRate, costBasis: "current_catalog",
        paymentFeeAssumptionPercent: 4, minimumProjectedMarginPercent, minCartTotalCents, maxCartTotalCents,
        maxDiscountCents, replayDiscountTotalCents, expectedLiftStatus: "not_estimated" }, fingerprint,
    };
  }
}
