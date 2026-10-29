import { ConflictException } from "@nestjs/common";
import { createHash } from "node:crypto";
import { validatePackagesList } from "@zyon/shipping-engine";
import type { PackageDimensions } from "@zyon/shared-types";

export type MarketplaceShippingProduct = PackageDimensions & {
  lineItemId: string;
  variantId: string;
  sku: string;
  /** Per unit. Melhor Envio multiplies this amount by quantity. */
  unitValueCents: number;
};
export interface MarketplaceShippingContract {
  version: 2;
  merchantId: string;
  originZip: string;
  destinationZip: string;
  products: MarketplaceShippingProduct[];
  insuranceTotalCents: number;
}

// jsonb object ordering must not affect the immutable quote commitment.
export function marketplaceShippingContractHash(value: unknown): string {
  const canonical = (input: unknown): unknown => Array.isArray(input) ? input.map(canonical)
    : input && typeof input === "object" ? Object.fromEntries(Object.entries(input).sort(([a], [b]) => a.localeCompare(b))
      .map(([key, entry]) => [key, canonical(entry)])) : input;
  return createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
}

/** The last digest is persisted in the funding plan's immutable quoteKey. */
export function assertMarketplaceShippingContract(value: unknown, quoteKey: string, merchantId: string): MarketplaceShippingContract {
  const invalid = (): never => { throw new ConflictException("marketplace_shipping_contract_invalid"); };
  if (!/^marketplace-v2:[a-f0-9]{64}:[a-f0-9]{64}$/.test(quoteKey)) {
    throw new ConflictException("marketplace_shipping_contract_legacy_requires_reconciliation");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return invalid();
  const contract = value as MarketplaceShippingContract;
  if (contract.version !== 2 || contract.merchantId !== merchantId || !/^\d{8}$/.test(contract.originZip) ||
      !/^\d{8}$/.test(contract.destinationZip) || !Array.isArray(contract.products) || !contract.products.length || contract.products.length > 100 ||
      !validatePackagesList(contract.products).valid) return invalid();
  let total = 0;
  for (const product of contract.products) {
    if (typeof product.lineItemId !== "string" || !product.lineItemId.trim() || typeof product.variantId !== "string" || !product.variantId.trim() ||
        typeof product.sku !== "string" || !product.sku.trim() || !Number.isSafeInteger(product.quantity) || product.quantity < 1 || product.quantity > 99 ||
        !Number.isSafeInteger(product.unitValueCents) || product.unitValueCents < 1 || product.unitValueCents > 2_147_483_647 ||
        [product.weightKg, product.heightCm, product.widthCm, product.lengthCm].some(n => typeof n !== "number" || !Number.isFinite(n))) return invalid();
    total += product.quantity * product.unitValueCents;
  }
  if (new Set(contract.products.map(row => row.lineItemId)).size !== contract.products.length ||
      !Number.isSafeInteger(total) || total > 2_147_483_647 || total !== contract.insuranceTotalCents ||
      marketplaceShippingContractHash(contract) !== quoteKey.split(":")[2]) return invalid();
  // Return a detached value: callers cannot mutate a JSON snapshot cached by a repository.
  return structuredClone(contract);
}
