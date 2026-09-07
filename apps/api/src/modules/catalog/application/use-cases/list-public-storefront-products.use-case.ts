import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { ProductEntity } from "../../domain/entities/product.entity.js";
import type { ProductRepositoryPort } from "../../domain/ports/product-repository.port.js";

export interface PublicStorefrontProduct {
  id: string;
  name: string;
  description?: string;
  type: string;
  price: number;
  currency: string;
  image?: string;
  images: string[];
  inStock: boolean;
  rating?: number;
  reviewCount?: number;
  variants: Array<{ id: string; value: string }>;
}

/**
 * Public catalog projection for the buyer storefront.
 *
 * This deliberately exposes only sellable data. Merchant-only fields such as
 * cost, barcode, stock quantities and product metadata stay behind the
 * authenticated catalog controller.
 */
@Injectable()
export class ListPublicStorefrontProductsUseCase {
  constructor(
    @Inject("ProductRepositoryPort") private readonly products: ProductRepositoryPort,
  ) {}

  async execute(input: {
    merchantId: string;
    query?: string;
    categoryId?: string;
    cursor?: string;
    limit?: number;
  }): Promise<{ products: PublicStorefrontProduct[]; nextCursor?: string }> {
    const limit = Math.max(1, Math.min(input.limit ?? 10, 50));
    const page = await this.products.search({
      merchantId: input.merchantId,
      query: input.query?.trim() || undefined,
      categoryId: input.categoryId,
      cursor: input.cursor,
      limit,
      isActiveOnly: true,
    });

    return {
      products: page.products.map((product) => this.toPublicProduct(product)),
      nextCursor: page.nextCursor,
    };
  }

  async get(merchantId: string, productId: string): Promise<PublicStorefrontProduct> {
    const product = await this.products.findById(merchantId, productId);
    if (!product || !product.isActive) throw new NotFoundException("storefront_product_not_found");
    return this.toPublicProduct(product);
  }

  private toPublicProduct(product: ProductEntity): PublicStorefrontProduct {
    const sellableVariants = product.variants.filter((variant) => variant.isActive);
    const firstVariant = sellableVariants[0];
    const images = sellableVariants
      .flatMap((variant) => variant.media)
      .filter((media) => media.type === "IMAGE")
      .sort((a, b) => a.order - b.order)
      .map((media) => media.url);
    const inStock = product.type === "digital" || product.type === "service"
      ? sellableVariants.length > 0
      : sellableVariants.some((variant) => variant.stockQuantity > variant.stockReserved);

    return {
      id: product.id,
      name: product.name,
      description: product.description,
      type: product.type,
      // Public API amounts are expressed in reais; cents remain an internal persistence detail.
      price: firstVariant ? firstVariant.basePriceInCents / 100 : 0,
      currency: firstVariant?.currency ?? "BRL",
      image: images[0],
      images: [...new Set(images)],
      inStock,
      rating: product.averageRating,
      reviewCount: product.reviewCount,
      variants: sellableVariants.map((variant) => ({
        id: variant.id,
        value: Object.values(variant.attributes).filter(Boolean).join(" / ") || variant.sku,
      })),
    };
  }
}
