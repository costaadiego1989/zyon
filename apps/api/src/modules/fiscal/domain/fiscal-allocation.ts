export interface FiscalCommercialLine {
  readonly lineId: string;
  readonly sellerMerchantId: string;
  readonly sku: string;
  readonly productType: "physical" | "food" | "digital" | "service";
  /** Supplied by the validated operation profile, never inferred from inventory rules. */
  readonly fiscalClass: "goods" | "excluded";
  readonly quantity: number;
  readonly unitPriceCents: number;
}
export interface FiscalAllocatedLine extends FiscalCommercialLine {
  grossCents: number; discountCents: number; shippingCents: number; totalCents: number;
}
export interface FiscalTotals { subtotalCents: number; discountCents: number; shippingCents: number; totalCents: number }
export interface FiscalSellerAllocation extends FiscalTotals { merchantId: string; lines: FiscalAllocatedLine[] }

function amount(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error("fiscal_amount_invalid");
}

function asAmount(value: bigint): number {
  const result = Number(value);
  amount(result);
  return result;
}

const compareId = (left: string, right: string) => left < right ? -1 : left > right ? 1 : 0;

export function apportionFiscalCents(total: number, lines: readonly { lineId: string; grossCents: number }[]): Map<string, number> {
  amount(total);
  const result = new Map(lines.map(line => [line.lineId, 0]));
  if (total === 0) return result;
  const grossSum = lines.reduce((sum, line) => sum + BigInt(line.grossCents), 0n);
  const weight = (line: { grossCents: number }) => grossSum === 0n ? 1n : BigInt(line.grossCents);
  const denominator = grossSum === 0n ? BigInt(lines.length) : grossSum;
  if (!denominator) throw new Error("fiscal_allocation_without_lines");
  const shares = lines.map(line => {
    const numerator = BigInt(total) * weight(line);
    return { lineId: line.lineId, floor: numerator / denominator, remainder: numerator % denominator };
  });
  const residual = Number(BigInt(total) - shares.reduce((sum, share) => sum + share.floor, 0n));
  shares.sort((left, right) => left.remainder === right.remainder ? compareId(left.lineId, right.lineId) : left.remainder > right.remainder ? -1 : 1);
  shares.forEach((share, index) => result.set(share.lineId, asAmount(share.floor + (index < residual ? 1n : 0n))));
  return result;
}

/** Money comes from the immutable commercial snapshot. This function selects no tax rates or regimes. */
export function allocateFiscalSale(input: { lines: readonly FiscalCommercialLine[]; discountCents: number; shippingCents: number }): {
  sellers: FiscalSellerAllocation[]; excludedLines: FiscalAllocatedLine[]; totals: FiscalTotals;
} {
  amount(input.discountCents); amount(input.shippingCents);
  const identities = new Set<string>();
  const lines = input.lines.map(line => {
    if (!line.lineId?.trim() || !line.sellerMerchantId?.trim() || !line.sku?.trim() || identities.has(line.lineId)) {
      throw new Error("fiscal_line_identity_invalid");
    }
    identities.add(line.lineId);
    if (!Number.isSafeInteger(line.quantity) || line.quantity <= 0) throw new Error("fiscal_quantity_invalid");
    amount(line.unitPriceCents);
    if (!["goods", "excluded"].includes(line.fiscalClass) || !["physical", "food", "digital", "service"].includes(line.productType)) {
      throw new Error("fiscal_line_classification_invalid");
    }
    if (line.fiscalClass === "goods" && ["digital", "service"].includes(line.productType)) throw new Error("fiscal_non_goods_line");
    return { ...line, grossCents: asAmount(BigInt(line.quantity) * BigInt(line.unitPriceCents)) };
  }).sort((left, right) => compareId(left.lineId, right.lineId));
  const subtotalCents = asAmount(lines.reduce((sum, line) => sum + BigInt(line.grossCents), 0n));
  if (input.discountCents > subtotalCents) throw new Error("fiscal_discount_exceeds_subtotal");
  const goods = lines.filter(line => line.fiscalClass === "goods");
  if (!goods.length && input.shippingCents) throw new Error("fiscal_shipping_without_goods");
  const discounts = apportionFiscalCents(input.discountCents, lines);
  const shipping = apportionFiscalCents(input.shippingCents, goods);
  const allocated = lines.map(line => {
    const discountCents = discounts.get(line.lineId) ?? 0;
    const shippingCents = shipping.get(line.lineId) ?? 0;
    return { ...line, discountCents, shippingCents, totalCents: asAmount(BigInt(line.grossCents) - BigInt(discountCents) + BigInt(shippingCents)) };
  });
  const sellers = new Map<string, FiscalSellerAllocation>();
  for (const line of allocated.filter(line => line.fiscalClass === "goods")) {
    const seller = sellers.get(line.sellerMerchantId) ?? { merchantId: line.sellerMerchantId, subtotalCents: 0, discountCents: 0, shippingCents: 0, totalCents: 0, lines: [] };
    seller.lines.push(line); seller.subtotalCents += line.grossCents; seller.discountCents += line.discountCents;
    seller.shippingCents += line.shippingCents; seller.totalCents += line.totalCents;
    sellers.set(seller.merchantId, seller);
  }
  const totalCents = asAmount(BigInt(subtotalCents) - BigInt(input.discountCents) + BigInt(input.shippingCents));
  return { sellers: [...sellers.values()].sort((left, right) => compareId(left.merchantId, right.merchantId)),
    excludedLines: allocated.filter(line => line.fiscalClass === "excluded"),
    totals: { subtotalCents, discountCents: input.discountCents, shippingCents: input.shippingCents, totalCents } };
}
