import { allocateMarketplaceProviderFee, MARKETPLACE_PROVIDER_FEE_POLICY, type MarketplaceFeeLine } from "./marketplace-provider-fee-allocation.js";
import type { MarketplaceCaptureEvidence, MarketplaceCaptureRequest } from "../ports/marketplace-capture-provider.port.js";

/** Agreed before submission; destinations and fees must never use today's config. */
export interface MarketplaceFundingInstructions extends Omit<MarketplaceCaptureRequest, "providerPaymentId"> {
  hostMerchantId: string;
  feePolicy: typeof MARKETPLACE_PROVIDER_FEE_POLICY;
  buyerServiceFeeCents: number;
  /** Zyon's existing host plan fee, separate from the proportional PSP fee. */
  hostPlatformFeeCents?: number;
  lines: Array<MarketplaceFeeLine & { platformFeeCents: number }>;
  shipping: Array<{ merchantId: string; amountCents: number }>;
  destinations: Array<{ merchantId: string; destination: string }>;
}

export interface FrozenMarketplaceFunding extends MarketplaceFundingInstructions {
  hostTerms: import("./settlement-state-machine.service.js").MarketplaceWindowConfig;
  checkoutFingerprint?: string;
  /** Persisted carrier quotes, bound to each origin and checkout destination. */
  shippingQuotes?: Array<{ merchantId: string; quoteId: string; quoteKey: string; carrierKey: string; amountCents: number; carrierQuoteHash?: string }>;
  /** Immutable own-product identity; physical stock is reserved when the intent commits. */
  hostStockItems?: Array<{ lineItemId: string; variantId: string; sku: string; quantity: number; requiresStock: boolean }>;
}

function cents(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > 2_147_483_647) throw new Error("marketplace_funding_amount_invalid");
  return value;
}

/** Conserves every cent across PSP, Zyon, host commission, sales and freight. */
export function buildMarketplaceFundingBudget(instructions: MarketplaceFundingInstructions, capture: MarketplaceCaptureEvidence) {
  const i = instructions;
  if (!i.hostMerchantId?.trim() || i.feePolicy !== MARKETPLACE_PROVIDER_FEE_POLICY || i.currency !== "BRL" ||
      !["stripe", "asaas"].includes(i.provider) || !["test", "live"].includes(i.environment) || !i.accountFingerprint?.trim() ||
      capture.provider !== i.provider || capture.environment !== i.environment || capture.accountFingerprint !== i.accountFingerprint ||
      capture.currency !== i.currency || capture.amountCents !== i.amountCents || !capture.providerPaymentId?.trim() || !capture.sourceId?.trim()) {
    throw new Error("marketplace_funding_capture_mismatch");
  }
  cents(i.amountCents); cents(capture.providerFeeCents); cents(capture.netAmountCents);
  if (capture.amountCents - capture.providerFeeCents !== capture.netAmountCents) throw new Error("marketplace_funding_capture_mismatch");
  if (!i.lines.some(line => line.sellerMerchantId !== i.hostMerchantId)) throw new Error("marketplace_funding_partner_required");
  const participants = new Set([i.hostMerchantId, ...i.lines.map(line => line.sellerMerchantId)]);
  if (i.destinations.length !== participants.size || new Set(i.destinations.map(row => row.merchantId)).size !== participants.size ||
      new Set(i.destinations.map(row => row.destination)).size !== participants.size || i.destinations.some(row =>
        !participants.has(row.merchantId) || !row.destination?.trim() || (i.provider === "stripe" && !row.destination.startsWith("acct_")))) {
    throw new Error("marketplace_funding_destinations_invalid");
  }
  const totals = new Map(i.destinations.map(row => [row.merchantId, { ...row, salesNetCents: 0, commissionCents: 0, shippingCents: 0, providerFeeCents: 0, platformFeeCents: 0 }]));
  let charged = cents(i.buyerServiceFeeCents), retained = i.buyerServiceFeeCents;
  const lines = allocateMarketplaceProviderFee(i.lines, capture.providerFeeCents).map(line => {
    cents(line.grossAmountCents); cents(line.commissionCents); cents(line.platformFeeCents);
    if (line.sellerMerchantId === i.hostMerchantId && line.commissionCents !== 0) throw new Error("marketplace_host_self_commission_invalid");
    const sellerNetCents = line.sellerNetCents - line.platformFeeCents;
    if (sellerNetCents <= 0) throw new Error("marketplace_funding_seller_net_invalid");
    const seller = totals.get(line.sellerMerchantId)!;
    seller.salesNetCents += sellerNetCents;
    seller.providerFeeCents += line.providerFeeCents;
    seller.platformFeeCents += line.platformFeeCents;
    totals.get(i.hostMerchantId)!.commissionCents += line.commissionCents;
    charged = cents(charged + line.grossAmountCents);
    retained = cents(retained + line.platformFeeCents);
    return { ...line, sellerNetCents };
  });
  for (const row of i.shipping) {
    if (!participants.has(row.merchantId)) throw new Error("marketplace_shipping_beneficiary_invalid");
    cents(row.amountCents);
    totals.get(row.merchantId)!.shippingCents += row.amountCents;
    charged = cents(charged + row.amountCents);
  }
  if (charged !== i.amountCents) throw new Error("marketplace_funding_charge_unallocated");
  const hostFee = cents(i.hostPlatformFeeCents ?? 0);
  const host = totals.get(i.hostMerchantId)!;
  if (hostFee > host.salesNetCents + host.commissionCents) throw new Error("marketplace_host_fee_exceeds_receivable");
  host.platformFeeCents += hostFee;
  retained = cents(retained + hostFee);
  const beneficiaries = [...totals.values()].sort((a, b) => a.merchantId < b.merchantId ? -1 : 1).map(row => ({
    ...row, amountCents: cents(row.salesNetCents + row.commissionCents + row.shippingCents - (row.merchantId === i.hostMerchantId ? hostFee : 0)),
  }));
  const payoutTotalCents = beneficiaries.reduce((sum, row) => cents(sum + row.amountCents), 0);
  if (payoutTotalCents + retained !== capture.netAmountCents) throw new Error("marketplace_funding_not_conserved");
  return { version: 1 as const, feePolicy: MARKETPLACE_PROVIDER_FEE_POLICY, capture: { ...capture },
    platformRetainedCents: retained, payoutTotalCents, lines, beneficiaries };
}
