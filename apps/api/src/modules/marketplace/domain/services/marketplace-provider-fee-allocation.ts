export const MARKETPLACE_PROVIDER_FEE_POLICY = "proportional_seller_sales_v1" as const;

export interface MarketplaceFeeLine {
  lineItemId: string;
  sellerMerchantId: string;
  grossAmountCents: number;
  commissionCents: number;
}

/** Largest remainder, using integer arithmetic and a stable tie break. */
function proportional(total: number, weights: Array<{ key: string; weight: number }>): Map<string, number> {
  const denominator = weights.reduce((sum, row) => sum + BigInt(row.weight), 0n);
  const shares = weights.map(row => {
    const numerator = BigInt(total) * BigInt(row.weight);
    return { ...row, cents: Number(numerator / denominator), remainder: numerator % denominator };
  });
  const remaining = total - shares.reduce((sum, row) => sum + row.cents, 0);
  shares.sort((a, b) => a.remainder === b.remainder ? (a.key < b.key ? -1 : 1) : a.remainder > b.remainder ? -1 : 1);
  for (let index = 0; index < remaining; index++) shares[index]!.cents++;
  return new Map(shares.map(row => [row.key, row.cents]));
}

/**
 * Applies the provider's verified processing fee to sellers in proportion to
 * their item sales. The host is also a seller for its own products. Buyer
 * service fees, host commissions and freight are not additional sales weights.
 * Allocate to sellers first so splitting one sale into more lines cannot
 * change that seller's share of the processing fee.
 */
export function allocateMarketplaceProviderFee<T extends MarketplaceFeeLine>(lines: T[], providerFeeCents: number) {
  if (!Number.isSafeInteger(providerFeeCents) || providerFeeCents < 0 || !lines.length ||
      new Set(lines.map(line => line.lineItemId)).size !== lines.length) throw new Error("marketplace_provider_fee_invalid");
  const sellers = new Map<string, number>();
  for (const line of lines) {
    if (!line.lineItemId?.trim() || !line.sellerMerchantId?.trim() || !Number.isSafeInteger(line.grossAmountCents) ||
        line.grossAmountCents <= 0 || !Number.isSafeInteger(line.commissionCents) || line.commissionCents < 0 ||
        line.commissionCents >= line.grossAmountCents) throw new Error("marketplace_fee_sale_invalid");
    const gross = (sellers.get(line.sellerMerchantId) ?? 0) + line.grossAmountCents;
    if (!Number.isSafeInteger(gross)) throw new Error("marketplace_fee_sale_invalid");
    sellers.set(line.sellerMerchantId, gross);
  }
  const sellerFees = proportional(providerFeeCents, [...sellers].map(([key, weight]) => ({ key, weight })));
  const lineFees = new Map<string, number>();
  for (const [seller, fee] of sellerFees) {
    for (const [id, amount] of proportional(fee, lines.filter(line => line.sellerMerchantId === seller)
      .map(line => ({ key: line.lineItemId, weight: line.grossAmountCents })))) lineFees.set(id, amount);
  }
  return lines.map(line => {
    const providerFeeCents = lineFees.get(line.lineItemId)!;
    const sellerNetCents = line.grossAmountCents - line.commissionCents - providerFeeCents;
    // Never cap a deduction silently or move a seller's fee onto another party.
    if (sellerNetCents <= 0) throw new Error("marketplace_provider_fee_exceeds_seller_receivable");
    return { ...line, providerFeeCents, sellerNetCents, policy: MARKETPLACE_PROVIDER_FEE_POLICY };
  });
}
