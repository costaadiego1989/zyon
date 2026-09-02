import React, { useEffect } from "react";
import { ArrowLeft, Save } from "lucide-react";
import type { MerchantProfile } from "../../api-client.js";
import { showToast } from "../../components/Toast.js";
import { Button } from "../../components/Button.js";
import { useProductDetailPage } from "./hooks/useProductDetailPage.js";
import { ProductForm } from "./components/ProductForm.js";
import { VariantManager } from "./components/VariantManager.js";
import { MediaUploader } from "./components/MediaUploader.js";
import { SeoSection } from "./components/SeoSection.js";
import { PromotionSection } from "./components/PromotionSection.js";
import { SectionErrorBoundary } from "../../components/PageErrorBoundary.js";

export type ProductType = "physical" | "digital" | "service" | "food";

export interface ProductMetadata {
  downloadUrl?: string;
  fileSize?: string;
  fileFormat?: string;
  serviceType?: "presencial" | "remoto";
  startDate?: string;
  startTime?: string;
  endDate?: string;
  endTime?: string;
  remoteLink?: string;
  notes?: string;
}

export interface ProductDetailPageProps {
  apiBaseUrl: string;
  me: MerchantProfile | null;
  productId: string | null;
  onBack?: () => void;
  onSaved?: () => void;
}

export { centsToReais, reaisToCents } from "../../utils/currency.js";
export { formatCurrencyInput } from "../../utils/currency.js";

export function ProductDetailPage(props: ProductDetailPageProps) {
  const page = useProductDetailPage({
    me: props.me,
    productId: props.productId,
    onSaved: props.onSaved,
  });

  // Save result → toast
  useEffect(() => {
    if (page.saveResult === "success") {
      if (page.postSaveNotice) {
        showToast(page.postSaveNotice.kind === "partial" ? "error" : "success", page.postSaveNotice.message);
        page.setPostSaveNotice(null);
      } else {
        showToast("success", page.isEditing ? "Produto atualizado" : "Produto criado");
      }
      page.setSaveResult(null);
    } else if (page.saveResult === "error") {
      showToast("error", page.saveErrorMsg ?? "Erro ao salvar produto");
      page.setSaveResult(null);
    }
  }, [page.saveResult]); // eslint-disable-line react-hooks/exhaustive-deps

  // Load error → toast
  useEffect(() => {
    if (page.loadError) {
      showToast("error", page.loadError);
    }
  }, [page.loadError]);

  if (!props.me) {
    return (
      <header className="page-head">
        <div>
          <h1>Produto</h1>
          <p className="page-lead">Login necessário</p>
        </div>
      </header>
    );
  }

  return (
    <div className="page-container">
      <header className="page-head">
        <div>
          <button
            type="button"
            onClick={() => props.onBack?.()}
            style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: 0, border: "none", background: "transparent", cursor: "pointer", color: "var(--color-text-muted)", font: "500 12px var(--font-sans)", marginBottom: 8 }}
          >
            <ArrowLeft size={12} /> Voltar para o catálogo
          </button>
          <span className="eyebrow">Loja</span>
          <h1>{page.isEditing ? "Editar produto" : "Novo produto"}</h1>
        </div>
        <Button variant="primary" size="sm" arrow disabled={!page.canSave} onClick={() => void page.handleSave()}>
          <Save size={14} /> {page.saving ? "Salvando..." : page.isEditing ? "Salvar alterações" : "Criar produto"}
        </Button>
      </header>

      {page.loading ? (
        <div style={{ padding: "40px 22px", textAlign: "center", color: "var(--color-text-faint)", font: "13px var(--font-sans)" }}>Carregando produto...</div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 16 }}>
          <SectionErrorBoundary sectionName="Mídia">
          <MediaUploader
            merchantId={page.merchantId!}
            variants={page.variantManager.variants}
            hasVariants={page.variantManager.hasVariants}
            variantMedia={page.media.variantMedia}
            uploadingVariant={page.media.uploadingVariant}
            onUploadingChange={page.media.setUploadingVariant}
            onAddMedia={page.media.addMedia}
            onRemoveMedia={page.media.removeMedia}
            onUpdateVariant={page.variantManager.updateVariant}
          />
          </SectionErrorBoundary>

          <SectionErrorBoundary sectionName="Formulário do Produto">
          <ProductForm
            name={page.form.name}
            onNameChange={page.form.setName}
            description={page.form.description}
            onDescriptionChange={page.form.setDescription}
            productType={page.form.productType}
            onProductTypeChange={page.form.setProductType}
            metadata={page.form.metadata}
            onMetadataChange={page.form.setMetadata}
            categoryId={page.form.categoryId}
            onCategoryIdChange={page.form.setCategoryId}
            isActive={page.form.isActive}
            onIsActiveChange={page.form.setIsActive}
            isEditing={page.isEditing}
            categories={page.categories}
            generatingDesc={page.form.generatingDesc}
            onGenerateDescription={page.generateDescription}
            formErrors={page.formErrors}
            optionGroups={page.form.optionGroups}
            onOptionGroupsChange={page.form.setOptionGroups}
          />
          </SectionErrorBoundary>

          <SectionErrorBoundary sectionName="Variantes">
          <VariantManager
            variants={page.variantManager.variants}
            hasVariants={page.variantManager.hasVariants}
            variantRequired={page.variantManager.variantRequired}
            productType={page.form.productType}
            formErrors={page.formErrors}
            onUpdateVariant={page.variantManager.updateVariant}
            onAddVariant={page.variantManager.addVariant}
            onRemoveVariant={page.variantManager.removeVariant}
            onAddAttribute={page.variantManager.addAttribute}
            onUpdateAttribute={page.variantManager.updateAttribute}
            onRemoveAttribute={page.variantManager.removeAttribute}
            onToggleVariantsMode={page.variantManager.toggleVariantsMode}
            onToggleVariantRequired={page.variantManager.toggleVariantRequired}
          />
          </SectionErrorBoundary>

          {page.isEditing && page.merchantId && (
            <SectionErrorBoundary sectionName="SEO">
            <SeoSection
              merchantId={page.merchantId}
              productId={page.createdProductId || props.productId!}
              seoTitle={page.seo.seoTitle}
              seoMetaDesc={page.seo.seoMetaDesc}
              seoSlug={page.seo.seoSlug}
              seoOgTitle={page.seo.seoOgTitle}
              seoOgDesc={page.seo.seoOgDesc}
              seoKeywords={page.seo.seoKeywords}
              onUpdate={(seo) => {
                page.seo.setSeoTitle(seo.seoTitle);
                page.seo.setSeoMetaDesc(seo.metaDescription);
                page.seo.setSeoSlug(seo.slug);
                page.seo.setSeoOgTitle(seo.ogTitle);
                page.seo.setSeoOgDesc(seo.ogDescription);
                page.seo.setSeoKeywords(seo.keywords);
              }}
            />
            </SectionErrorBoundary>
          )}

          {page.merchantId && (
            <SectionErrorBoundary sectionName="Promoção">
            <PromotionSection
              merchantId={page.merchantId}
              productId={page.createdProductId || props.productId}
              variantSkus={page.variantManager.variants.map((v) => v.sku.trim()).filter(Boolean)}
              onPendingPromoChange={page.setPendingPromoConfig}
              onPendingRulesChange={page.setPendingRulesConfig}
            />
            </SectionErrorBoundary>
          )}
        </div>
      )}
    </div>
  );
}
