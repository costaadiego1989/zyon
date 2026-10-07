import type { ProductVariantDraft } from "../hooks/useVariantManager.js";

/** Keep failed files and real variant IDs so retry never recreates the product. */
export async function persistVariantMedia(
  drafts: ProductVariantDraft[],
  saved: Array<{ id: string; sku: string }>,
  upload: (variantId: string, image: string) => Promise<{ id: string; url: string }>,
) {
  const uploaded: Array<{ variantId: string; id: string; url: string }> = [];
  const variants: ProductVariantDraft[] = [];
  for (const draft of drafts) {
    const variant = saved.find(v => draft.id ? v.id === draft.id : v.sku === draft.sku.trim());
    if (!variant) throw new Error("saved_variant_missing");
    const pendingImages: string[] = [];
    for (const image of draft.pendingImages) {
      try { uploaded.push({ variantId: variant.id, ...await upload(variant.id, image) }); }
      catch { pendingImages.push(image); }
    }
    variants.push({ ...draft, id: variant.id, pendingImages });
  }
  return { variants, uploaded, failed: variants.reduce((n, v) => n + v.pendingImages.length, 0) };
}
