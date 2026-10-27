import type { CreateProductInput } from "../ports/product-repository.port.js";
import { validateProductType } from "./product-type-validation.js";

export function productInputError(input: CreateProductInput): string | undefined {
  if (typeof input.name !== "string" || !input.name.trim()) return "product_name_required";
  if (!Array.isArray(input.variants) || !input.variants.length) return "at_least_one_variant_required";
  const typeError = validateProductType(input.type ?? "physical", input.metadata);
  if (typeError) return typeError;
  const seen = new Set<string>();
  for (const variant of input.variants) {
    if (!variant || typeof variant.sku !== "string" || !variant.sku.trim()) return "variant_sku_required";
    if (seen.has(variant.sku.trim())) return `duplicate_sku_in_product:${variant.sku.trim()}`;
    seen.add(variant.sku.trim());
    if (!Number.isSafeInteger(variant.basePriceInCents) || variant.basePriceInCents <= 0 || variant.basePriceInCents > 2_147_483_647) return "price_must_be_positive";
    if (variant.costInCents !== undefined && (!Number.isSafeInteger(variant.costInCents) || variant.costInCents < 0 || variant.costInCents > 2_147_483_647)) return "invalid_cost";
    if (!variant.attributes || typeof variant.attributes !== "object" || Array.isArray(variant.attributes) || Object.entries(variant.attributes).some(([key, value]) => !key.trim() || typeof value !== "string")) return "invalid_variant_attributes";
    for (const dimension of [variant.lengthCm, variant.widthCm, variant.heightCm, variant.weightGrams]) {
      if (dimension !== undefined && (!Number.isFinite(dimension) || dimension < 0)) return "invalid_variant_dimensions";
    }
    if (variant.stockQuantity !== undefined && (!Number.isSafeInteger(variant.stockQuantity) || variant.stockQuantity < 0 || variant.stockQuantity > 2_147_483_647)) return "invalid_stock_quantity";
    if ((input.type ?? "physical") === "physical" && (!Number.isFinite(variant.weightGrams) || (variant.weightGrams ?? 0) <= 0)) return "physical_product_requires_weight";
  }
  return undefined;
}
