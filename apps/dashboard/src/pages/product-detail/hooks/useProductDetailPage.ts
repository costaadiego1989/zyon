import { useEffect, useMemo, useRef, useState } from "react";
import { useApi } from "../../../hooks/useApi.js";
import { reportError } from "../../../hooks/useErrorReporter.js";
import { centsToReais, reaisToCents } from "../../../utils/currency.js";
import { useProductForm } from "./useProductForm.js";
import { useVariantManager, emptyVariant } from "./useVariantManager.js";
import { useMediaUploader } from "./useMediaUploader.js";
import { useProductSeo } from "./useProductSeo.js";
import { validateVariants, validateSimpleProduct, validateProductMetadata, parseInteger, parseFloatSafe } from "../utils/product-validation.js";
import type { MerchantProfile } from "../../../api-client.js";
import type { CreatePromotionPayload, UpsertProductAdvancedRulesPayload } from "../../../api/endpoints/catalog.js";
import type { AdvancedRule } from "../../checkout-settings/lib/draft.js";
import { catalogSaveError } from "../utils/catalog-save-error.js";
import { persistVariantMedia } from "../utils/persist-variant-media.js";
import { productEditorHash } from "../utils/product-route.js";

export interface UseProductDetailPageOptions {
  me: MerchantProfile | null;
  productId: string | null;
  onSaved?: () => void;
}

export function useProductDetailPage(options: UseProductDetailPageOptions) {
  const { me, productId, onSaved } = options;
  const api = useApi();
  const merchantId = me?.id;

  // Sub-hooks
  const form = useProductForm();
  const variantManager = useVariantManager();
  const media = useMediaUploader();
  const seo = useProductSeo();

  // Page-level state
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveResult, setSaveResult] = useState<"success" | "error" | null>(null);
  const [saveErrorMsg, setSaveErrorMsg] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [categories, setCategories] = useState<Array<{ id: string; name: string }>>([]);
  const [createdProductId, setCreatedProductId] = useState<string | null>(null);
  const isEditing = !!(productId || createdProductId);
  const loadedStocks = useRef(new Map<string, number>());
  const [conflictingSkus, setConflictingSkus] = useState<string[]>([]);

  // Pending promo/rules config (used only in create mode before product is saved)
  const [pendingPromoConfig, setPendingPromoConfig] = useState<CreatePromotionPayload | null>(null);
  const [pendingRulesConfig, setPendingRulesConfig] = useState<{ rules: AdvancedRule[]; productSkus: string[] } | null>(null);
  // Post-save notice for partial-failure/success extras (promo/rules in create mode)
  const [postSaveNotice, setPostSaveNotice] = useState<{ kind: "success" | "partial"; message: string } | null>(null);

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
    let active = true;
    setLoading(true);
    setLoadError(null);
    setLoaded(false);
    (async () => {
      try {
        const product = await api.getProduct(merchantId, productId);
        if (!active) return;
        loadedStocks.current = new Map(product.variants.map(v => [v.id, v.stockQuantity ?? 0]));
        form.loadProduct(product);
        seo.loadSeo(product);

        const mediaMap: Record<string, Array<{ id: string; url: string }>> = {};
        const isComplex = product.variants.length !== 1;
        variantManager.setHasVariants(isComplex);
        const meta = (product.metadata ?? {}) as Record<string, unknown>;
        variantManager.toggleVariantRequired(meta.variantSelectionRequired === true);
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
        setLoaded(true);
      } catch (e) {
        if (!active) return;
        const msg = e instanceof Error ? e.message : String(e);
        setLoadError("Não foi possível carregar o produto. Tente novamente para editar com os dados atuais.");
        reportError({ source: "ProductDetailPage.load", error: e });
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [api, merchantId, productId, isEditing, loadAttempt]);

  // Validation
  const variantErrors = useMemo(() => {
    if (variantManager.hasVariants) return validateVariants(variantManager.variants, form.productType);
    return validateSimpleProduct(variantManager.variants[0], form.productType);
  }, [variantManager.variants, variantManager.hasVariants, form.productType]);

  const formErrors = useMemo(() => {
    const errors: Record<string, string> = {};
    if (!form.name.trim()) errors["name"] = "Nome obrigatório";
    Object.assign(errors, variantErrors);
    Object.assign(errors, validateProductMetadata(form.productType, { ...(form.metadata as Record<string, unknown>),
      ...(form.productType === "food" ? { optionGroups: form.optionGroups } : {}) }));
    variantManager.variants.forEach((variant, index) => {
      if (conflictingSkus.includes(variant.sku.trim())) errors[variantManager.hasVariants ? `variant_${index}_sku` : "simple_sku"] = "Este SKU já está cadastrado";
    });
    return errors;
  }, [form.name, form.productType, form.metadata, form.optionGroups, variantErrors, variantManager.variants, variantManager.hasVariants, conflictingSkus]);

  const canSave = Object.keys(formErrors).length === 0 && !saving && loaded && !loading && !loadError;

  // Save handler
  async function handleSave() {
    if (!merchantId || saving || !loaded || loadError) return;
    if (Object.keys(formErrors).length > 0) {
      setSaveResult("error");
      setSaveErrorMsg("Corrija os erros antes de salvar");
      return;
    }
    setSaving(true);
    setSaveResult(null);
    setSaveErrorMsg(null);
    try {
      const { variants } = variantManager;
      const { hasVariants } = variantManager;

      const savedMetadata: Record<string, unknown> = { ...(form.metadata as Record<string, unknown>) };
      if (form.productType === "food" && form.optionGroups.length > 0) {
        savedMetadata.optionGroups = form.optionGroups;
      } else {
        delete savedMetadata.optionGroups;
      }
      // Persist whether variant selection is mandatory for this product.
      if (variantManager.hasVariants) {
        savedMetadata.variantSelectionRequired = variantManager.variantRequired;
      } else {
        delete savedMetadata.variantSelectionRequired;
      }

      let skuToUse = variants[0].sku.trim();
      if (!skuToUse && !hasVariants) {
        skuToUse = form.name.toLowerCase().replace(/\s+/g, "-").slice(0, 32);
      }

      const payloadVariants = variants.map((v) => ({
        ...(v.id ? { id: v.id } : {}),
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
        stockQuantity: isEditing && v.id && parseInteger(v.stockInput) === loadedStocks.current.get(v.id) ? undefined : (v.stockInput.trim() ? parseInteger(v.stockInput) ?? undefined : undefined),
      }));

      let savedProductId = productId || createdProductId;
      let savedVariants: Array<{ id: string; sku: string; stockQuantity?: number }>;

      if (savedProductId) {
        const changes = {
          name: form.name.trim(),
          description: form.description.trim(),
          type: form.productType,
          metadata: savedMetadata,
          categoryId: form.categoryId.trim(),
          isActive: form.isActive,
          seoTitle: seo.seoTitle.trim(),
          metaDescription: seo.seoMetaDesc.trim(),
          slug: seo.seoSlug.trim(),
          ogTitle: seo.seoOgTitle.trim(),
          ogDescription: seo.seoOgDesc.trim(),
          keywords: seo.seoKeywords,
        };
        savedVariants = (await api.replaceProductVariants(merchantId, savedProductId, payloadVariants, changes)).variants;
      } else {
        const created = await api.createProduct(merchantId, {
          name: form.name.trim(),
          description: form.description.trim() || undefined,
          type: form.productType,
          metadata: savedMetadata,
          categoryId: form.categoryId.trim() || undefined,
          variants: payloadVariants,
        });
        savedProductId = created.id;
        savedVariants = created.variants;
        setCreatedProductId(created.id);
        window.history.replaceState(null, "", `#${productEditorHash(created.id)}`);
      }

      // Upload pending images
      if (savedProductId) {
        for (const v of savedVariants) loadedStocks.current.set(v.id, v.stockQuantity ?? 0);
        const result = await persistVariantMedia(variants.map((v, i) => ({ ...v, sku: payloadVariants[i].sku })), savedVariants, (id, image) => api.uploadProductMedia(merchantId, id, image));
        variantManager.setVariants(result.variants.map(v => ({ ...v, stockInput: String(savedVariants.find(saved => saved.id === v.id)?.stockQuantity ?? parseInteger(v.stockInput) ?? 0) })));
        for (const item of result.uploaded) media.addMedia(item.variantId, { id: item.id, url: item.url });
        if (result.failed) throw new Error("product_media_upload_failed");
      }

      // Post-save: create promotion (create mode only, after product is saved)
      let promoCreationError: string | null = null;
      let rulesCreationError: string | null = null;
      if (savedProductId && pendingPromoConfig) {
        try {
          await api.createPromotion(merchantId, savedProductId, pendingPromoConfig);
        } catch (e) {
          promoCreationError = e instanceof Error ? e.message : String(e);
          reportError({ source: "ProductDetailPage.createPromotion", error: e });
        }
      }

      // Post-save: create advanced rules (create mode only, after product is saved)
      if (savedProductId && pendingRulesConfig && pendingRulesConfig.rules.length > 0) {
        try {
          await api.upsertProductAdvancedRules(merchantId, savedProductId, pendingRulesConfig);
        } catch (e) {
          rulesCreationError = e instanceof Error ? e.message : String(e);
          reportError({ source: "ProductDetailPage.upsertAdvancedRules", error: e });
        }
      }

      // Compose post-save status for the toast (create mode extras).
      if (promoCreationError) {
        setPostSaveNotice({ kind: "partial", message: `Produto criado, mas a promoção falhou: ${promoCreationError}` });
      } else if (rulesCreationError) {
        setPostSaveNotice({ kind: "partial", message: `Produto criado, mas as regras avançadas falharam: ${rulesCreationError}` });
      } else if (!isEditing && pendingPromoConfig) {
        setPostSaveNotice({ kind: "success", message: "Produto criado com promoção" });
      } else {
        setPostSaveNotice(null);
      }

      setSaveResult("success");
      setSaveErrorMsg(null);
      // Clear pending config on success
      setPendingPromoConfig(null);
      setPendingRulesConfig(null);
      onSaved?.();
    } catch (e) {
      setSaveResult("error");
      const failure = catalogSaveError(e);
      setSaveErrorMsg(failure.message);
      setConflictingSkus(failure.conflictingSkus);
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

  async function createCategory(name: string): Promise<{ id: string; name: string }> {
    if (!merchantId) throw new Error("merchant_not_available");
    const created = await api.createCategory(merchantId, { name });
    const category = { id: created.id, name: created.name };
    setCategories((current) =>
      current.some((item) => item.id === category.id)
        ? current
        : [...current, category].sort((a, b) => a.name.localeCompare(b.name, "pt-BR")),
    );
    return category;
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

    // Pending promo/rules (create mode)
    pendingPromoConfig,
    setPendingPromoConfig,
    pendingRulesConfig,
    setPendingRulesConfig,
    postSaveNotice,
    setPostSaveNotice,

    // Actions
    retryLoad: () => setLoadAttempt(attempt => attempt + 1),
    handleSave,
    generateDescription,
    createCategory,
  };
}
