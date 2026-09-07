import type { CartItem, SuggestedProduct } from "@zyon/shared-types";
import type { ProductEntity, ProductVariantProps } from "../../../catalog/domain/entities/product.entity.js";
import type { ProductRepositoryPort } from "../../../catalog/domain/ports/product-repository.port.js";

export async function resolveCrossSellProduct(
  sku: string,
  productRepo: ProductRepositoryPort,
  merchantId: string,
  suggestionId?: string,
): Promise<(SuggestedProduct & { suggestion_id?: string }) | null> {
  try {
    let product = await productRepo.findById(merchantId, sku).catch(() => null);
    let variant = product?.variants?.find(v => v.sku === sku);
    if (!product || !variant) {
      const search = await productRepo.search({ merchantId, limit: 100, isActiveOnly: true, inStockOnly: true });
      product = search.products.find(p => p.variants?.some(v => v.sku === sku)) ?? null;
      variant = product?.variants?.find(v => v.sku === sku) ?? undefined;
    }
    if (!isSellableVariant(product, variant)) {
      return null;
    }
    return {
      suggestion_id: suggestionId,
      sku,
      name: product.name,
      unit_price: variant.basePriceInCents / 100,
      category: product.categoryId,
      variant: variant.sku,
      image_url: variant.media?.[0]?.url,
      product_url: undefined,
    };
  } catch {
    return null;
  }
}

export async function resolveCrossSellCartItem(
  sku: string,
  productRepo: ProductRepositoryPort,
  merchantId: string,
): Promise<CartItem | null> {
  try {
    let product = await productRepo.findById(merchantId, sku).catch(() => null);
    let variant = product?.variants?.find(v => v.sku === sku);
    if (!product || !variant) {
      const search = await productRepo.search({ merchantId, limit: 100, isActiveOnly: true, inStockOnly: true });
      product = search.products.find(p => p.variants?.some(v => v.sku === sku)) ?? null;
      variant = product?.variants?.find(v => v.sku === sku) ?? undefined;
    }
    if (!isSellableVariant(product, variant)) {
      return null;
    }
    return {
      sku,
      name: product.name,
      price: variant.basePriceInCents / 100,
      cost: variant.costInCents == null ? undefined : variant.costInCents / 100,
      quantity: 1,
      category: product.categoryId,
      variant: variant.sku,
      imageUrl: variant.media?.[0]?.url,
      productUrl: undefined,
    };
  } catch {
    return null;
  }
}

function isSellableVariant(
  product: ProductEntity | null,
  variant: ProductVariantProps | undefined,
): boolean {
  if (!product || !variant || !product.isActive || !variant.isActive) return false;
  if (!Number.isSafeInteger(variant.basePriceInCents) || variant.basePriceInCents <= 0) return false;
  if (product.type === "digital" || product.type === "service") return true;
  return variant.stockQuantity - variant.stockReserved > 0;
}
