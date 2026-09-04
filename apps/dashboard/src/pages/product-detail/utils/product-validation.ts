import { reaisToCents } from "../../../utils/currency.js";
import type { ProductVariantDraft } from "../hooks/useVariantManager.js";

export function parseInteger(value: string): number | null {
  if (!value.trim()) return null;
  const n = parseInt(value, 10);
  return Number.isFinite(n) ? n : null;
}

export function parseFloatSafe(value: string): number | null {
  if (!value.trim()) return null;
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : null;
}

export function validateVariants(variants: ProductVariantDraft[], productType?: string): Record<string, string> {
  const errors: Record<string, string> = {};
  if (variants.length === 0) {
    errors["variants"] = "Adicione pelo menos uma variante";
    return errors;
  }
  const requiresWeight = productType === "physical" || !productType;
  const seenSkus = new Set<string>();
  variants.forEach((v, idx) => {
    if (!v.sku.trim()) errors[`variant_${idx}_sku`] = "SKU obrigatório";
    else if (seenSkus.has(v.sku.trim())) errors[`variant_${idx}_sku`] = "SKU duplicado";
    else seenSkus.add(v.sku.trim());

    const price = reaisToCents(v.basePriceInput);
    if (price <= 0) errors[`variant_${idx}_price`] = "Preço inválido";

    if (requiresWeight && !v.weightInput.trim()) {
      errors[`variant_${idx}_weight`] = "Peso obrigatório para produtos físicos";
    } else if (v.weightInput.trim()) {
      const w = parseFloatSafe(v.weightInput);
      if (w === null || w < 0) errors[`variant_${idx}_weight`] = "Peso inválido";
    }

    if (v.costInput.trim()) {
      const c = reaisToCents(v.costInput);
      if (c < 0) errors[`variant_${idx}_cost`] = "Custo inválido";
    }
  });
  return errors;
}

export function validateSimpleProduct(variant: ProductVariantDraft, productType?: string): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!variant.sku.trim()) errors["simple_sku"] = "SKU obrigatório";
  const price = reaisToCents(variant.basePriceInput);
  if (price <= 0) errors["simple_price"] = "Preço inválido";
  const requiresWeight = productType === "physical" || !productType;
  if (requiresWeight && !variant.weightInput.trim()) {
    errors["simple_weight"] = "Peso obrigatório para produtos físicos";
  } else if (variant.weightInput.trim()) {
    const w = parseFloatSafe(variant.weightInput);
    if (w === null || w < 0) errors["simple_weight"] = "Peso inválido";
  }
  if (variant.costInput.trim()) {
    const c = reaisToCents(variant.costInput);
    if (c < 0) errors["simple_cost"] = "Custo inválido";
  }
  return errors;
}
