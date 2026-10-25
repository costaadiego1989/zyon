import type { SuggestedProduct, CartItem } from "@zyon/shared-types";

/**
 * Shared mapper: converts a commerce product (with variants) to SuggestedProduct[].
 * Single source of truth for the transformation — used by both the adapter and use-case.
 * (CAT-M3: Extract toSuggestedProduct mapper)
 */
export function toSuggestedProducts(product: {
  title: string;
  description?: string;
  productUrl?: string;
  imageUrl?: string;
  category?: string;
  variants: Array<{
    sku: string;
    title: string;
    unitPriceCents: number;
    availableForSale: boolean;
    imageUrl?: string;
  }>;
}): SuggestedProduct[] {
  return product.variants
    .filter((variant) => variant.availableForSale && variant.sku && variant.sku.length > 0 && variant.unitPriceCents > 0)
    .map((variant) => ({
      sku: variant.sku,
      name: product.title,
      unit_price: variant.unitPriceCents / 100,
      image_url: variant.imageUrl ?? product.imageUrl,
      product_url: product.productUrl,
      category: product.category,
      variant:
        variant.title === "Default Title" ||
        variant.title === "Default"
          ? undefined
          : variant.title,
      description: product.description?.slice(0, 100),
    }));
}

/**
 * Converts a CartItem (from cross-sell) to a product shape for addCatalogItem.
 * (CAT-M3: shared mapper)
 */
export function crossSellCartItemToProduct(item: CartItem): {
  sku: string;
  name: string;
  unit_price: number;
  image_url?: string;
  product_url?: string;
  category?: string;
  variant?: string;
  description?: string;
} {
  return {
    sku: item.sku,
    name: item.name,
    unit_price: item.price,
    image_url: item.imageUrl,
    product_url: item.productUrl,
    category: item.category,
    variant: item.variant,
    description: item.description,
  };
}
