import { useEffect, useMemo, useState } from "react";
import { useApi } from "../../../hooks/useApi.js";
import { reportError } from "../../../hooks/useErrorReporter.js";
import { centsToReais, reaisToCents } from "../../../utils/currency.js";
import { useProductForm } from "./useProductForm.js";
import { useVariantManager, emptyVariant, type ProductVariantDraft } from "./useVariantManager.js";
import { useMediaUploader } from "./useMediaUploader.js";
import { useProductSeo } from "./useProductSeo.js";
import { validateVariants, validateSimpleProduct, parseInteger, parseFloatSafe } from "../utils/product-validation.js";
import type { MerchantProfile } from "../../../api-client.js";
import type { ProductMetadata } from "../ProductDetailPage.js";

export interface UseProductDetailPageOptions {
  me: MerchantProfile | null;
  productId: string | null;
  onSaved?: () => void;
}

export function useProductDetailPage(options: UseProductDetailPageOptions) {
  const { me, productId, onSaved } = options;
  const api = useApi();
  const merchantId = me?.id;
  const isEditing = !!productId;

  // Sub-hooks
  const form = useProductForm();
  const variantManager = useVariantManager();
  const media = useMediaUploader();
  const seo = useProductSeo();

  // Page-level state
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveResult, setSaveResult] = useState<"success" | "error" | null>(null);
  const [saveErrorMsg, setSaveErrorMsg] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [categories, setCategories] = useState<Array<{ id: string; name: string }>>([]);
  const [createdProductId, setCreatedProductId] = useState<string | null>(null);

  // Load categories
  useEffect(() => {
    if (!merchantId) return;
    api.listCategories?.(merchantId).then(setCategories).catch(() => {});
  }, [api, merchantId]);

  // Load product for editing
  useEffect(() => {
    if (!merchantId || !isEditing || !productId) {
      setLoaded(true);
      return;
    }
    setLoading(true);
    setLoadError(null);
    setLoaded(false);
    (async () => {
      try {
        const product = await api.getProduct(merchantId, productId);
        form.loadProduct(product);
        seo.loadSeo(product);

        const mediaMap: Record<string, Array<{ id: string; url: string }>> = {};
        const isComplex = product.variants.length !== 1;
        variantManager.setHasVariants(isComplex);
        variantManager.setVariants(
          product.variants.length > 0
            ? product.variants.map((v) => {
                if (v.media?.length) {
                  mediaMap[v.id] = v.media.map((m) => ({ id: m.id, url: m.url }));
                }
                return {
                  id: v.id,
                  sku: v.sku,
                  basePriceInput: centsToReais(v.basePriceInCents ?? 0),
                  costInput: v.costInCents != null ? centsToReais(v.costInCents) : "",
                  weightInput: v.weightGrams != null ? String(v.weightGrams) : "",
                  lengthInput: v.lengthCm != null ? String(v.lengthCm) : "",
                  widthInput: v.widthCm != null ? String(v.widthCm) : "",
                  heightInput: v.heightCm != null ? String(v.heightCm) : "",
                  stockInput: String(v.stockQuantity ?? 0),
                  attributes: Object.entries(v.attributes || {}).map(([key, value]) => ({ key, value })),
                  pendingImages: [],
                };
              })
            : [emptyVariant()],
        );
        media.variantMedia; // reference
        // Set media map directly — useMediaUploader stores in same format
        Object.entries(mediaMap).forEach(([variantId, items]) => {
          items.forEach((item) => media.addMedia(variantId, item));
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setLoadError(msg);
        reportError({ source: "ProductDetailPage.load", error: e });
      } finally {
        setLoading(false);
        setLoaded(true);
      }
    })();
  }, [api, merchantId, productId, isEditing]);

  // Validation
  const variantErrors = useMemo(() => {
    if (variantManager.hasVariants) return validateVariants(variantManager.variants);
    return validateSimpleProduct(variantManager.variants[0]);
  }, [variantManager.variants, variantManager.hasVariants]);

  const formErrors = useMemo(() => {
    const errors: Record<string, string> = {};
    if (!form.name.trim()) errors["name"] = "Nome obrigatório";
    Object.assign(errors, variantErrors);
    return errors;
  }, [form.name, variantErrors]);

  const canSave = Object.keys(formErrors).length === 0 && !saving && loaded;

  // Save handler
  async function handleSave() {
    if (!merchantId) return;
    if (Object.keys(formErrors).length > 0) {
      setSaveResult("error");
      setSaveErrorMsg("Corrija os erros antes de salvar");
      return;
    }
    setSaving(true);
    setSaveResult(null);
    try {
      const { variants } = variantManager;
      const { hasVariants } = variantManager;

      let skuToUse = variants[0].sku.trim();
      if (!skuToUse && !hasVariants) {
        skuToUse = form.name.toLowerCase().replace(/\s+/g, "-").slice(0, 32);
      }

      const payloadVariants = variants.map((v) => ({
        sku: hasVariants ? v.sku.trim() : skuToUse,
        attributes: v.attributes.reduce(
          (acc, attr) => {
            if (attr.key.trim()) acc[attr.key.trim()] = attr.value.trim();
            return acc;
          },
          {} as Record<string, string>,
        ),
        basePriceInCents: reaisToCents(v.basePriceInput),
        costInCents: v.costInput.trim() ? reaisToCents(v.costInput) : undefined,
        weightGrams: v.weightInput.trim() ? parseFloatSafe(v.weightInput) ?? undefined : undefined,
        lengthCm: v.lengthInput.trim() ? parseFloatSafe(v.lengthInput) ?? undefined : undefined,
        widthCm: v.widthInput.trim() ? parseFloatSafe(v.widthInput) ?? undefined : undefined,
        heightCm: v.heightInput.trim() ? parseFloatSafe(v.heightInput) ?? undefined : undefined,
        stockQuantity: parseInteger(v.stockInput) ?? 0,
      }));

      let savedProductId = productId;

      if (isEditing && productId) {
        await api.updateProduct(merchantId, productId, {
          name: form.name.trim(),
          description: form.description.trim() || undefined,
          type: form.productType,
          metadata: form.metadata as Record<string, unknown>,
          categoryId: form.categoryId.trim() || undefined,
          isActive: form.isActive,
          seoTitle: seo.seoTitle.trim() || undefined,
          metaDescription: seo.seoMetaDesc.trim() || undefined,
          slug: seo.seoSlug.trim() || undefined,
          ogTitle: seo.seoOgTitle.trim() || undefined,
          ogDescription: seo.seoOgDesc.trim() || undefined,
          keywords: seo.seoKeywords.length > 0 ? seo.seoKeywords : undefined,
        });
        for (let i = 0; i < payloadVariants.length; i++) {
          const v = payloadVariants[i];
          const existing = variants[i];
          if (existing?.id) {
            try {
              await api.updateVariant?.(merchantId, productId, existing.id, {
                basePriceInCents: v.basePriceInCents,
                costInCents: v.costInCents ?? null,
                stockQuantity: v.stockQuantity,
                weightGrams: v.weightGrams ?? null,
                lengthCm: v.lengthCm ?? null,
                widthCm: v.widthCm ?? null,
                heightCm: v.heightCm ?? null,
              });
            } catch (e) {
              reportError({ source: "ProductDetailPage.updateVariant", error: e });
            }
          }
        }
      } else {
        const created = await api.createProduct(merchantId, {
          name: form.name.trim(),
          description: form.description.trim() || undefined,
          type: form.productType,
          metadata: form.metadata as Record<string, unknown>,
          categoryId: form.categoryId.trim() || undefined,
          variants: payloadVariants,
        });
        savedProductId = created.id;
        setCreatedProductId(created.id);
      }

      // Upload pending images
      if (savedProductId) {
        for (let i = 0; i < variants.length; i++) {
          const v = variants[i];
          const variantId = isEditing ? v.id : (i < payloadVariants.length ? savedProductId : null);
          if (variantId && v.pendingImages.length > 0) {
            for (const base64 of v.pendingImages) {
              try {
                const result = await api.uploadProductMedia?.(merchantId, variantId, base64);
                if (result) {
                  media.addMedia(variantId, { id: result.id, url: result.url });
                }
              } catch (e) {
                reportError({ source: "ProductDetailPage.uploadMedia", error: e });
              }
            }
          }
        }
        variantManager.setVariants((prev: ProductVariantDraft[]) =>
          prev.map((v: ProductVariantDraft) => ({ ...v, pendingImages: [] })),
        );
      }

      setSaveResult("success");
      setSaveErrorMsg(null);
      onSaved?.();
    } catch (e) {
      setSaveResult("error");
      setSaveErrorMsg(e instanceof Error ? e.message : String(e));
      reportError({ source: "ProductDetailPage.save", error: e });
    } finally {
      setSaving(false);
    }
  }

  // AI description generation
  async function generateDescription() {
    if (!merchantId) return;
    if (!form.name.trim()) {
      setSaveResult("error");
      setSaveErrorMsg("Preencha o nome do produto antes de gerar descrição");
      return;
    }
    form.setGeneratingDesc(true);
    setSaveResult(null);
    try {
      const result = await api.generateDescription(merchantId, {
        name: form.name.trim(),
        notes: form.description.trim() || undefined,
        type: form.productType,
      });
      if (result?.description) {
        form.setDescription(result.description);
      } else {
        setSaveResult("error");
        setSaveErrorMsg("IA não retornou descrição. Tente novamente.");
      }
    } catch (err) {
      setSaveResult("error");
      setSaveErrorMsg(err instanceof Error ? err.message : "Erro ao gerar descrição");
      reportError({ source: "ProductDetailPage.generateDescription", error: err });
    } finally {
      form.setGeneratingDesc(false);
    }
  }

  return {
    // Identity
    isEditing,
    merchantId,

    // Form
    form,

    // Variants
    variantManager,

    // Media
    media,

    // SEO
    seo,

    // Page state
    loading,
    saving,
    loadError,
    saveResult,
    setSaveResult,
    saveErrorMsg,
    loaded,
    categories,
    createdProductId,
    formErrors,
    canSave,

    // Actions
    handleSave,
    generateDescription,
  };
}
