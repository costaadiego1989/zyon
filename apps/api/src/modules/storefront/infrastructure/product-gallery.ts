import type { ProductEntity } from "../../catalog/domain/entities/product.entity.js";

/** Keep the same real catalog photos available in both cards and product details. */
export function productGallery(product: Pick<ProductEntity, "variants">): { image?: string; images: string[] } {
  const images = [...new Set(product.variants
    .filter((variant) => variant.isActive)
    .flatMap((variant) => variant.media
      .filter((media) => media.type === "IMAGE" && media.url.trim().length > 0)
      .sort((a, b) => a.order - b.order)
      .map((media) => media.url)))];
  return { image: images[0], images };
}
