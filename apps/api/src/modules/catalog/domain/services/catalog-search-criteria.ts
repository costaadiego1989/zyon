import type { ProductVariantProps } from "../entities/product.entity.js";
import type { SearchProductsInput } from "../ports/product-repository.port.js";

export const normalizeCatalogAttribute = (value: string): string => value.normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();

/** Projection must show only variants that explain the database match.
 * In particular, an unknown attribute cannot establish a negative fact. */
export function matchesCatalogVariant(variant: ProductVariantProps, input: SearchProductsInput, productType: string): boolean {
  if (input.candidateVariantIds && !input.candidateVariantIds.includes(variant.id)) return false;
  if (!variant.isActive || (input.currency && variant.currency !== input.currency)) return false;
  if (input.minPriceCents !== undefined && (input.minPriceExclusive ? variant.basePriceInCents <= input.minPriceCents : variant.basePriceInCents < input.minPriceCents)) return false;
  if (input.maxPriceCents !== undefined && (input.maxPriceExclusive ? variant.basePriceInCents >= input.maxPriceCents : variant.basePriceInCents > input.maxPriceCents)) return false;
  if (input.inStockOnly && !["digital", "service"].includes(productType)
    && variant.stockQuantity - variant.stockReserved <= 0) return false;
  const matches = (condition: NonNullable<SearchProductsInput["attributes"]>[number]) => {
    const entry = Object.entries(variant.attributes ?? {}).find(([key]) => normalizeCatalogAttribute(key) === normalizeCatalogAttribute(condition.name));
    if (!entry) return false;
    const same = normalizeCatalogAttribute(entry[1]) === normalizeCatalogAttribute(condition.value);
    return condition.operator === "equals" ? same : !same;
  };
  return (input.attributes ?? []).every(matches) && (input.attributeAnyOf ?? []).every(group => group.some(matches));
}
