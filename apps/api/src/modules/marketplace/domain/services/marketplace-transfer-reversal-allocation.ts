/** Only unrepaid money of the same beneficiary and capture can fund its refund debit. */
export function allocateMarketplaceTransferReversals(input: {
  merchantDebits: Array<{ merchantId: string; amountCents: number }>;
  payouts: Array<{ id: string; beneficiaryMerchantId: string; amountCents: number; status: string;
    providerTransferId: string | null; claimedAt: Date | null }>;
  previousMerchantDebits?: Array<{ merchantId: string; amountCents: number }>;
  previousReversals?: Array<{ payoutId: string; amountCents: number }>;
}): Array<{ payoutId: string; amountCents: number }> {
  const max = 2_147_483_647;
  if (new Set(input.merchantDebits.map(row => row.merchantId)).size !== input.merchantDebits.length ||
      new Set(input.payouts.map(row => row.id)).size !== input.payouts.length ||
      input.merchantDebits.some(row => !row.merchantId || !Number.isSafeInteger(row.amountCents) || Math.abs(row.amountCents) > max) ||
      input.payouts.some(row => !row.id || !row.beneficiaryMerchantId || !Number.isSafeInteger(row.amountCents) || row.amountCents <= 0 || row.amountCents > max ||
        !input.merchantDebits.some(debit => debit.merchantId === row.beneficiaryMerchantId) ||
        !(row.status === "planned" && !row.providerTransferId && !row.claimedAt || row.status === "confirmed" && !!row.providerTransferId))) {
    throw new Error("marketplace_reversal_payout_unreconciled");
  }
  const result: Array<{ payoutId: string; amountCents: number }> = [];
  const previousDebits = input.previousMerchantDebits ?? [], previousReversals = input.previousReversals ?? [];
  if (new Set(previousDebits.map(row => row.merchantId)).size !== previousDebits.length ||
      new Set(previousReversals.map(row => row.payoutId)).size !== previousReversals.length ||
      previousDebits.some(row => !input.merchantDebits.some(current => current.merchantId === row.merchantId) ||
        !Number.isSafeInteger(row.amountCents) || Math.abs(row.amountCents) > max) ||
      previousReversals.some(row => {
        const payout = input.payouts.find(p => p.id === row.payoutId);
        return !payout || payout.status !== "confirmed" || !Number.isSafeInteger(row.amountCents) || row.amountCents <= 0 || row.amountCents > payout.amountCents;
      })) throw new Error("marketplace_reversal_history_unreconciled");
  for (const debit of [...input.merchantDebits].sort((a, b) => a.merchantId.localeCompare(b.merchantId))) {
    const owned = input.payouts.filter(row => row.beneficiaryMerchantId === debit.merchantId);
    const held = owned.filter(row => row.status === "planned").reduce((sum, row) => sum + row.amountCents, 0) +
      previousReversals.filter(row => owned.some(p => p.id === row.payoutId)).reduce((sum, row) => sum + row.amountCents, 0) -
      (previousDebits.find(row => row.merchantId === debit.merchantId)?.amountCents ?? 0);
    if (held < 0) throw new Error("marketplace_reversal_history_unreconciled");
    let needed = Math.max(0, debit.amountCents - held);
    for (const payout of owned.filter(row => row.status === "confirmed").sort((a, b) => a.id.localeCompare(b.id))) {
      if (!needed) break;
      const amountCents = Math.min(needed, payout.amountCents - (previousReversals.find(row => row.payoutId === payout.id)?.amountCents ?? 0));
      if (!amountCents) continue;
      result.push({ payoutId: payout.id, amountCents });
      needed -= amountCents;
    }
    if (needed) throw new Error("marketplace_reversal_contribution_required");
  }
  return result;
}

/** After a residual generation, planned original payouts are historical only.
 * The spendable balance is entitlement minus money still at beneficiaries. */
export function allocateMarketplaceTransferReversalsAfterResidual(input: {
  remainingBeneficiaries: Array<{ merchantId: string; amountCents: number }>;
  merchantDebits: Array<{ merchantId: string; amountCents: number }>;
  transfers: Array<{ payoutId: string; merchantId: string; amountCents: number; reversals: Array<{ amountCents: number }> }>;
}): Array<{ payoutId: string; amountCents: number }> {
  const valid = (amount: number) => Number.isSafeInteger(amount) && amount >= 0 && amount <= 2_147_483_647;
  const invalid = () => { throw new Error("marketplace_reversal_history_unreconciled"); };
  if (new Set(input.remainingBeneficiaries.map(row => row.merchantId)).size !== input.remainingBeneficiaries.length ||
      new Set(input.merchantDebits.map(row => row.merchantId)).size !== input.remainingBeneficiaries.length ||
      input.merchantDebits.length !== input.remainingBeneficiaries.length ||
      new Set(input.transfers.map(row => row.payoutId)).size !== input.transfers.length ||
      input.remainingBeneficiaries.some(row => !row.merchantId || !valid(row.amountCents)) ||
      input.merchantDebits.some(row => !Number.isSafeInteger(row.amountCents) || Math.abs(row.amountCents) > 2_147_483_647 ||
        !input.remainingBeneficiaries.some(b => b.merchantId === row.merchantId)) ||
      input.transfers.some(row => !row.payoutId || !valid(row.amountCents) || row.amountCents === 0 ||
        !input.remainingBeneficiaries.some(b => b.merchantId === row.merchantId) ||
        row.reversals.some(r => !valid(r.amountCents) || r.amountCents === 0) ||
        row.reversals.reduce((sum, r) => sum + r.amountCents, 0) > row.amountCents)) invalid();
  const required: Array<{ payoutId: string; amountCents: number }> = [];
  for (const beneficiary of [...input.remainingBeneficiaries].sort((a, b) => a.merchantId.localeCompare(b.merchantId))) {
    const transfers = input.transfers.filter(row => row.merchantId === beneficiary.merchantId).sort((a, b) => a.payoutId.localeCompare(b.payoutId));
    const net = (row: typeof transfers[number]) => row.amountCents - row.reversals.reduce((sum, r) => sum + r.amountCents, 0);
    const retained = transfers.reduce((sum, row) => sum + net(row), 0);
    const held = beneficiary.amountCents - retained;
    const debit = input.merchantDebits.find(row => row.merchantId === beneficiary.merchantId)!.amountCents;
    if (held < 0 || beneficiary.amountCents - debit < 0) invalid();
    let needed = Math.max(0, debit - held);
    for (const transfer of transfers) {
      const amountCents = Math.min(needed, net(transfer));
      if (amountCents > 0) { required.push({ payoutId: transfer.payoutId, amountCents }); needed -= amountCents; }
    }
    if (needed) invalid();
  }
  return required;
}
