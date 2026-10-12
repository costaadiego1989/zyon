import type { FrozenMarketplaceFunding } from "./marketplace-funding-budget.js";
import type { buildMarketplaceFundingBudget } from "./marketplace-funding-budget.js";
import { refundShippingCents } from "../../../../shared/commerce/refund-shipping.js";

type FundingBudget = ReturnType<typeof buildMarketplaceFundingBudget>;
export interface MarketplaceRefundComponents {
  /** Explicit commercial decision; a PSP refund does not decide these terms. */
  commission: "refund" | "retain";
  platformFees: "refund" | "retain";
  hostPlatformFee: "refund" | "retain";
  buyerServiceFeeCents: number;
  shipping: Array<{ merchantId: string; amountCents: number }>;
}
export interface MarketplaceRefundLineIdentity { lineItemId: string; variantId: string; quantity: number }
export interface MarketplaceRefundAllocation {
  version: 1;
  policy: Pick<MarketplaceRefundComponents, "commission" | "platformFees" | "hostPlatformFee">;
  lines: Array<{ lineItemId: string; variantId: string; sellerMerchantId: string; quantity: number; cumulativeQuantity: number;
    purchasedQuantity: number; grossAmountCents: number; commissionRefundCents: number; platformFeeRefundCents: number }>;
  shipping: Array<{ merchantId: string; amountCents: number }>;
  buyerServiceFeeCents: number;
  hostPlatformFeeRefundCents: number;
  amountCents: number;
  merchantDebitCents: number;
  platformDebitCents: number;
  merchantDebits: Array<{ merchantId: string; amountCents: number }>;
  remainingBeneficiaries: Array<{ merchantId: string; amountCents: number; providerFeeCents: number }>;
  platformRemainingCents: number;
  cumulativeRefundCents: number;
  requiredContributions: Array<{ merchantId: string | null; amountCents: number }>;
}
const validCents = (value: number) => {
  if (!Number.isSafeInteger(value) || value < 0 || value > 2_147_483_647) throw new Error("marketplace_refund_amount_invalid");
  return value;
};
const fraction = (amount: number, numerator: number, denominator: number) =>
  Number(BigInt(amount) * BigInt(numerator) / BigInt(denominator));

/** New return commands calculate shipping from the original origin and quantities.
 * Existing plans keep their immutable allocation and original replay contract. */
export function marketplaceReturnShipping(input: {
  instructions: FrozenMarketplaceFunding; budget: FundingBudget; identities: MarketplaceRefundLineIdentity[];
  items: Array<{ variantId: string; quantity: number }>; previous: MarketplaceRefundAllocation[];
}): Array<{ merchantId: string; amountCents: number }> {
  const origins = new Set(input.items.map(item => {
    const identity = input.identities.find(row => row.variantId === item.variantId);
    const line = input.budget.lines.find(row => row.lineItemId === identity?.lineItemId);
    if (!line) throw new Error("marketplace_refund_line_identity_missing");
    return line.sellerMerchantId;
  }));
  return [...origins].sort().map(merchantId => {
    const identities = input.identities.filter(identity => input.budget.lines.some(line =>
      line.lineItemId === identity.lineItemId && line.sellerMerchantId === merchantId));
    const variants = new Set(identities.map(row => row.variantId));
    return { merchantId, amountCents: refundShippingCents({
      originalCents: input.instructions.shipping.filter(row => row.merchantId === merchantId).reduce((sum, row) => sum + row.amountCents, 0),
      orderedQuantity: identities.reduce((sum, row) => sum + row.quantity, 0),
      returnedQuantity: input.items.filter(row => variants.has(row.variantId)).reduce((sum, row) => sum + row.quantity, 0),
      previouslyReturnedQuantity: input.previous.flatMap(row => row.lines).filter(row => row.sellerMerchantId === merchantId).reduce((sum, row) => sum + row.quantity, 0),
      previouslyRefundedCents: input.previous.flatMap(row => row.shipping).filter(row => row.merchantId === merchantId).reduce((sum, row) => sum + row.amountCents, 0),
    }) };
  });
}

/** Each component uses cumulative integer rounding, so split returns conserve the original cents. */
export function buildMarketplaceRefundAllocation(input: {
  instructions: FrozenMarketplaceFunding; budget: FundingBudget; identities: MarketplaceRefundLineIdentity[];
  items: Array<{ variantId: string; quantity: number }>; components: MarketplaceRefundComponents;
  previous: MarketplaceRefundAllocation[];
}): MarketplaceRefundAllocation {
  const { instructions: original, budget, identities, components: c, previous } = input;
  if (!c || ![c.commission, c.platformFees, c.hostPlatformFee].every(v => v === "refund" || v === "retain") ||
      !Array.isArray(c.shipping) || !input.items.length || identities.length !== budget.lines.length ||
      new Set(identities.map(l => l.lineItemId)).size !== identities.length ||
      new Set(identities.map(l => l.variantId)).size !== identities.length ||
      new Set(input.items.map(l => l.variantId)).size !== input.items.length) throw new Error("marketplace_refund_components_required");
  const policy = { commission: c.commission, platformFees: c.platformFees, hostPlatformFee: c.hostPlatformFee };
  if (previous.some(p => Object.keys(policy).some(key => p.policy[key as keyof typeof policy] !== policy[key as keyof typeof policy]))) {
    throw new Error("marketplace_refund_policy_changed");
  }
  const debits = new Map(budget.beneficiaries.map(row => [row.merchantId, 0]));
  const add = (merchant: string, amount: number) => {
    if (!debits.has(merchant)) throw new Error("marketplace_refund_beneficiary_invalid");
    debits.set(merchant, debits.get(merchant)! + amount);
  };
  let platformDebitCents = 0;
  const lines = input.items.map(item => {
    const identity = identities.find(row => row.variantId === item.variantId);
    const line = budget.lines.find(row => row.lineItemId === identity?.lineItemId);
    if (!identity || !line || !Number.isSafeInteger(identity.quantity) || identity.quantity <= 0 ||
        !Number.isSafeInteger(item.quantity) || item.quantity <= 0 || line.grossAmountCents % identity.quantity !== 0) {
      throw new Error("marketplace_refund_line_invalid");
    }
    const already = previous.flatMap(row => row.lines).filter(row => row.lineItemId === identity.lineItemId)
      .reduce((sum, row) => sum + row.quantity, 0);
    const cumulativeQuantity = already + item.quantity;
    if (cumulativeQuantity > identity.quantity) throw new Error("marketplace_refund_quantity_exceeded");
    const allocated = (amount: number) => fraction(amount, cumulativeQuantity, identity.quantity) - fraction(amount, already, identity.quantity);
    const grossAmountCents = allocated(line.grossAmountCents);
    const commissionRefundCents = c.commission === "refund" ? allocated(line.commissionCents) : 0;
    const platformFeeRefundCents = c.platformFees === "refund" ? allocated(line.platformFeeCents) : 0;
    // Processing fees remain the original seller's cost. They are not credited here.
    add(line.sellerMerchantId, grossAmountCents - commissionRefundCents - platformFeeRefundCents);
    add(original.hostMerchantId, commissionRefundCents);
    platformDebitCents += platformFeeRefundCents;
    return { lineItemId: identity.lineItemId, variantId: identity.variantId, sellerMerchantId: line.sellerMerchantId,
      quantity: item.quantity, purchasedQuantity: identity.quantity, cumulativeQuantity, grossAmountCents,
      commissionRefundCents, platformFeeRefundCents };
  }).sort((a, b) => a.lineItemId.localeCompare(b.lineItemId));
  if (new Set(c.shipping.map(row => row.merchantId)).size !== c.shipping.length) throw new Error("marketplace_refund_shipping_invalid");
  const shipping = c.shipping.map(row => {
    validCents(row.amountCents);
    const available = original.shipping.filter(s => s.merchantId === row.merchantId).reduce((s, r) => s + r.amountCents, 0);
    const already = previous.flatMap(p => p.shipping).filter(s => s.merchantId === row.merchantId).reduce((s, r) => s + r.amountCents, 0);
    if (!lines.some(line => line.sellerMerchantId === row.merchantId) || already + row.amountCents > available) throw new Error("marketplace_refund_shipping_exceeded");
    add(row.merchantId, row.amountCents);
    return { ...row };
  }).sort((a, b) => a.merchantId.localeCompare(b.merchantId));
  const buyerServiceFeeCents = validCents(c.buyerServiceFeeCents);
  if (buyerServiceFeeCents + previous.reduce((s, p) => s + p.buyerServiceFeeCents, 0) > original.buyerServiceFeeCents) {
    throw new Error("marketplace_refund_buyer_fee_exceeded");
  }
  const previousGross = previous.flatMap(p => p.lines).reduce((s, l) => s + l.grossAmountCents, 0);
  const currentGross = lines.reduce((s, l) => s + l.grossAmountCents, 0);
  const totalGross = budget.lines.reduce((s, l) => s + l.grossAmountCents, 0);
  const hostPlatformFeeRefundCents = c.hostPlatformFee === "refund" ?
    fraction(original.hostPlatformFeeCents ?? 0, previousGross + currentGross, totalGross) -
      fraction(original.hostPlatformFeeCents ?? 0, previousGross, totalGross) : 0;
  add(original.hostMerchantId, -hostPlatformFeeRefundCents);
  platformDebitCents += hostPlatformFeeRefundCents + buyerServiceFeeCents;
  const amountCents = validCents(currentGross + shipping.reduce((s, r) => s + r.amountCents, 0) + buyerServiceFeeCents);
  if (amountCents === 0) throw new Error("marketplace_refund_amount_invalid");
  const merchantDebits = [...debits].map(([merchantId, amountCents]) => ({ merchantId, amountCents })).sort((a, b) => a.merchantId.localeCompare(b.merchantId));
  const merchantDebitCents = merchantDebits.reduce((s, r) => s + r.amountCents, 0);
  if (merchantDebitCents + platformDebitCents !== amountCents) throw new Error("marketplace_refund_not_conserved");
  const remainingBeneficiaries = budget.beneficiaries.map(row => ({ merchantId: row.merchantId, providerFeeCents: row.providerFeeCents,
    amountCents: row.amountCents - (debits.get(row.merchantId) ?? 0) - previous.flatMap(p => p.merchantDebits)
      .filter(d => d.merchantId === row.merchantId).reduce((s, d) => s + d.amountCents, 0) }));
  const platformRemainingCents = budget.platformRetainedCents - platformDebitCents - previous.reduce((s, p) => s + p.platformDebitCents, 0);
  const cumulativeRefundCents = amountCents + previous.reduce((s, p) => s + p.amountCents, 0);
  if (cumulativeRefundCents > original.amountCents || remainingBeneficiaries.reduce((s, r) => s + r.amountCents, platformRemainingCents) +
      cumulativeRefundCents !== budget.capture.netAmountCents) throw new Error("marketplace_refund_not_conserved");
  const requiredContributions = remainingBeneficiaries.filter(row => row.amountCents < 0)
    .map(row => ({ merchantId: row.merchantId as string | null, amountCents: -row.amountCents }));
  if (platformRemainingCents < 0) requiredContributions.push({ merchantId: null, amountCents: -platformRemainingCents });
  return { version: 1, policy, lines, shipping, buyerServiceFeeCents, hostPlatformFeeRefundCents, amountCents,
    merchantDebitCents, platformDebitCents, merchantDebits, remainingBeneficiaries, platformRemainingCents, cumulativeRefundCents, requiredContributions };
}
