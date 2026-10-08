import type { MarketplaceRefundAllocation } from "./marketplace-refund-allocation.js";

/** A whole original wallet return is held once and spent cumulatively by its
 * original beneficiary. The same receipt cannot replenish a later refund. */
export function selectAsaasMarketplaceReturnedFunds(input: {
  netAmountCents: number;
  allocation: MarketplaceRefundAllocation;
  previous: MarketplaceRefundAllocation[];
  payouts: Array<{ id: string; beneficiaryMerchantId: string | null; amountCents: number; status: string;
    providerTransferId: string | null; claimedAt: Date | null }>;
  returns: Array<{ id: string; payoutId: string; amountCents: number; sellerMerchantId: string; originalProviderTransferId: string }>;
}): string[] | null {
  const cents = (value: number) => Number.isSafeInteger(value) && value >= 0 && value <= 2_147_483_647;
  const allocations = [...input.previous, input.allocation];
  let cumulative = 0;
  if (!cents(input.netAmountCents) || !input.netAmountCents || !allocations.length ||
    new Set(input.payouts.map(row => row.id)).size !== input.payouts.length ||
    new Set(input.returns.map(row => row.id)).size !== input.returns.length ||
    new Set(input.returns.map(row => row.payoutId)).size !== input.returns.length) return null;
  const merchantIds = input.allocation.merchantDebits.map(row => row.merchantId);
  if (!merchantIds.length || new Set(merchantIds).size !== merchantIds.length) return null;
  const debits = new Map(merchantIds.map(id => [id, 0]));
  for (const allocation of allocations) {
    cumulative += allocation.amountCents;
    if (!cents(allocation.amountCents) || !allocation.amountCents || allocation.requiredContributions.length ||
      allocation.cumulativeRefundCents !== cumulative || cumulative > input.netAmountCents ||
      allocation.merchantDebits.length !== merchantIds.length ||
      new Set(allocation.merchantDebits.map(row => row.merchantId)).size !== merchantIds.length ||
      allocation.merchantDebits.some(row => !debits.has(row.merchantId) || !Number.isSafeInteger(row.amountCents) || Math.abs(row.amountCents) > 2_147_483_647) ||
      allocation.merchantDebits.reduce((sum, row) => sum + row.amountCents, allocation.platformDebitCents) !== allocation.amountCents) return null;
    for (const debit of allocation.merchantDebits) debits.set(debit.merchantId, debits.get(debit.merchantId)! + debit.amountCents);
  }
  if (input.payouts.some(row => !row.id || !row.beneficiaryMerchantId || !debits.has(row.beneficiaryMerchantId) || !cents(row.amountCents) || !row.amountCents ||
    !(row.status === "planned" && !row.claimedAt && !row.providerTransferId || row.status === "confirmed" && !!row.claimedAt && !!row.providerTransferId)) ||
    input.returns.some(credit => {
      const payout = input.payouts.find(row => row.id === credit.payoutId);
      return !credit.id || !payout || payout.status !== "confirmed" || payout.amountCents !== credit.amountCents ||
        credit.sellerMerchantId !== payout.beneficiaryMerchantId || credit.originalProviderTransferId !== payout.providerTransferId;
    })) return null;
  const selected: string[] = [];
  for (const [merchantId, debit] of debits) {
    const held = input.payouts.filter(row => row.beneficiaryMerchantId === merchantId && row.status === "planned")
      .reduce((sum, row) => sum + row.amountCents, 0);
    let needed = Math.max(0, debit - held);
    for (const credit of input.returns.filter(row => row.sellerMerchantId === merchantId).sort((a, b) => a.payoutId.localeCompare(b.payoutId))) {
      if (!needed) break;
      selected.push(credit.id); needed -= Math.min(needed, credit.amountCents);
    }
    if (needed) return null;
  }
  return selected.sort();
}
