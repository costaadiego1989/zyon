import type { ProductCardBlock } from "./types";

type Card = ProductCardBlock["data"];

/** Display the selected variant, without substituting another SKU's inventory. */
export function selectedProductPresentation(data: Card, selectedVariantId: string | null) {
  const selected = data.variants?.find(variant => variant.id === selectedVariantId);
  const tracksQuantity = data.productType !== "digital" && data.productType !== "service";
  const quantity = selected ? selected.stock : data.stock;
  const stock = tracksQuantity && typeof quantity === "number" && Number.isFinite(quantity) ? Math.max(0, quantity) : undefined;
  const available = data.inStock && (stock === undefined || stock > 0);
  const sku = selected?.sku ?? (!selected || (data.variants?.length ?? 0) <= 1 ? data.sku : undefined);
  const stockLabel = available
    ? !tracksQuantity ? "Disponível" : data.detailed && stock !== undefined ? `Em estoque · ${stock} un.` : "Em estoque"
    : tracksQuantity ? "Esgotado" : "Indisponível no momento";
  return { sku, stock, available, stockLabel, requiresShipping: tracksQuantity };
}
