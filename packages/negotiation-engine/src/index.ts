export type NegotiationScope = "global" | "category" | "item";
export type NegotiationDenialReason =
  | "merchant_machine_negotiation_disabled"
  | "buyer_machine_negotiation_disabled"
  | "ai_cost_cap_exceeded"
  | "no_discount_overlap"
  | "invalid_policy";

export interface NegotiationDiscountRange {
  minOfferDiscountPercent: number;
  maxDiscountPercent: number;
}

export interface CategoryNegotiationPolicy extends NegotiationDiscountRange {
  categoryId: string;
}

export interface ItemNegotiationPolicy extends NegotiationDiscountRange {
  sku: string;
}

export interface MerchantNegotiationPolicy {
  enabled: boolean;
  global: NegotiationDiscountRange;
  categories?: CategoryNegotiationPolicy[];
  items?: ItemNegotiationPolicy[];
  maxRounds: number;
  maxAiCostCents?: number;
  estimatedCostPerAiCallCents: number;
}

export interface BuyerNegotiationPreferences {
  enabled: boolean;
  targetDiscountPercent: number;
  minimumAcceptableDiscountPercent: number;
  maxRounds: number;
  maxAiCostCents?: number;
  autoAccept: boolean;
  requireHumanConfirmationAbove?: number;
  preferredSkus?: string[];
  preferredCategoryIds?: string[];
}

export interface NegotiationCartItem {
  sku: string;
  categoryId?: string;
  price: number;
  quantity: number;
}

export interface NegotiationCart {
  total: number;
  items: NegotiationCartItem[];
}

export interface BasicCart {
  total: number;
  items: Array<{
    sku: string;
    price: number;
    quantity: number;
  }>;
}

export interface NegotiationInput {
  merchantId: string;
  globalUserId?: string;
  cart: NegotiationCart | BasicCart;
  merchantPolicy: MerchantNegotiationPolicy;
  buyerPreferences: BuyerNegotiationPreferences;
}

export interface NegotiationResult {
  agreement: boolean;
  selectedDiscountPercent: number;
  merchantMinOfferDiscountPercent: number;
  merchantMaxDiscountPercent: number;
  buyerTargetDiscountPercent: number;
  buyerMinimumAcceptableDiscountPercent: number;
  selectedScope: NegotiationScope;
  selectedPolicyKeys: string[];
  maxRounds: number;
  estimatedAiCalls: number;
  estimatedAiCostCents: number;
  autoAccept: boolean;
  requiresHumanConfirmation: boolean;
  denialReason?: NegotiationDenialReason;
  audit: string[];
}

export function negotiateDiscount(input: NegotiationInput): NegotiationResult {
  const maxRounds = Math.min(input.merchantPolicy.maxRounds, input.buyerPreferences.maxRounds);
  const estimatedAiCalls = maxRounds * 2;
  const estimatedAiCostCents = estimatedAiCalls * input.merchantPolicy.estimatedCostPerAiCallCents;
  const base = baseResult(input, maxRounds, estimatedAiCalls, estimatedAiCostCents);

  if (!input.merchantPolicy.enabled) {
    return deny(base, "merchant_machine_negotiation_disabled", "Merchant disabled machine negotiation.");
  }
  if (!input.buyerPreferences.enabled) {
    return deny(base, "buyer_machine_negotiation_disabled", "Buyer disabled machine negotiation.");
  }
  if (!isValidRange(input.merchantPolicy.global)) {
    return deny(base, "invalid_policy", "Merchant global policy is invalid.");
  }
  if (
    exceedsCap(estimatedAiCostCents, input.merchantPolicy.maxAiCostCents) ||
    exceedsCap(estimatedAiCostCents, input.buyerPreferences.maxAiCostCents)
  ) {
    return deny(base, "ai_cost_cap_exceeded", "Estimated AI cost exceeds configured cap.");
  }

  const resolved = resolveMerchantRange(input.cart, input.merchantPolicy);
  const selectedDiscountPercent = Math.max(
    resolved.minOfferDiscountPercent,
    input.buyerPreferences.minimumAcceptableDiscountPercent
  );

  const withResolved = {
    ...base,
    merchantMinOfferDiscountPercent: resolved.minOfferDiscountPercent,
    merchantMaxDiscountPercent: resolved.maxDiscountPercent,
    selectedDiscountPercent,
    selectedScope: resolved.scope,
    selectedPolicyKeys: resolved.policyKeys,
    audit: [
      ...base.audit,
      `Resolved merchant policy from ${resolved.scope} scope.`,
      `Merchant range is ${resolved.minOfferDiscountPercent}% to ${resolved.maxDiscountPercent}%.`,
      `Buyer target is ${input.buyerPreferences.targetDiscountPercent}% and minimum acceptable is ${input.buyerPreferences.minimumAcceptableDiscountPercent}%.`
    ]
  };

  if (selectedDiscountPercent > resolved.maxDiscountPercent) {
    return deny(withResolved, "no_discount_overlap", "Buyer minimum acceptable discount exceeds merchant maximum.");
  }

  return {
    ...withResolved,
    agreement: true,
    autoAccept: input.buyerPreferences.autoAccept,
    requiresHumanConfirmation:
      typeof input.buyerPreferences.requireHumanConfirmationAbove === "number" &&
      input.cart.total > input.buyerPreferences.requireHumanConfirmationAbove,
    audit: [...withResolved.audit, `Agreement selected at ${selectedDiscountPercent}%.`]
  };
}

function resolveMerchantRange(
  cart: NegotiationInput["cart"],
  policy: MerchantNegotiationPolicy
): {
  minOfferDiscountPercent: number;
  maxDiscountPercent: number;
  scope: NegotiationScope;
  policyKeys: string[];
} {
  const itemPolicies = new Map((policy.items ?? []).map((item) => [item.sku, item]));
  const categoryPolicies = new Map((policy.categories ?? []).map((category) => [category.categoryId, category]));
  const matches = cart.items.map((item) => {
    const itemPolicy = itemPolicies.get(item.sku);
    if (itemPolicy) return { ...itemPolicy, scope: "item" as const, key: item.sku };
    const categoryId = "categoryId" in item ? item.categoryId : undefined;
    const categoryPolicy = categoryId ? categoryPolicies.get(categoryId) : undefined;
    if (categoryPolicy) return { ...categoryPolicy, scope: "category" as const, key: categoryId ?? "category" };
    return { ...policy.global, scope: "global" as const, key: "global" };
  });

  const maxDiscountPercent = Math.min(...matches.map((match) => match.maxDiscountPercent));
  const minOfferDiscountPercent = Math.max(...matches.map((match) => match.minOfferDiscountPercent));
  const scope: NegotiationScope = matches.some((match) => match.scope === "item")
    ? "item"
    : matches.some((match) => match.scope === "category")
      ? "category"
      : "global";

  return {
    minOfferDiscountPercent,
    maxDiscountPercent,
    scope,
    policyKeys: matches.map((match) => match.key)
  };
}

function baseResult(
  input: NegotiationInput,
  maxRounds: number,
  estimatedAiCalls: number,
  estimatedAiCostCents: number
): NegotiationResult {
  return {
    agreement: false,
    selectedDiscountPercent: 0,
    merchantMinOfferDiscountPercent: input.merchantPolicy.global.minOfferDiscountPercent,
    merchantMaxDiscountPercent: input.merchantPolicy.global.maxDiscountPercent,
    buyerTargetDiscountPercent: input.buyerPreferences.targetDiscountPercent,
    buyerMinimumAcceptableDiscountPercent: input.buyerPreferences.minimumAcceptableDiscountPercent,
    selectedScope: "global",
    selectedPolicyKeys: ["global"],
    maxRounds,
    estimatedAiCalls,
    estimatedAiCostCents,
    autoAccept: false,
    requiresHumanConfirmation: false,
    audit: [`Estimated ${estimatedAiCalls} AI calls at ${estimatedAiCostCents} cents.`]
  };
}

function deny(result: NegotiationResult, denialReason: NegotiationDenialReason, auditLine: string): NegotiationResult {
  return {
    ...result,
    agreement: false,
    denialReason,
    audit: [...result.audit, auditLine]
  };
}

function exceedsCap(cost: number, cap?: number): boolean {
  return typeof cap === "number" && cost > cap;
}

function isValidRange(range: NegotiationDiscountRange): boolean {
  return (
    range.minOfferDiscountPercent >= 0 &&
    range.maxDiscountPercent >= 0 &&
    range.minOfferDiscountPercent <= range.maxDiscountPercent &&
    range.maxDiscountPercent <= 100
  );
}
