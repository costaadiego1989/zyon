import React from "react";
import { ArrowLeft, Save } from "lucide-react";
import type { MerchantProfile } from "../../api-client.js";
import { SaveFeedbackBanner } from "../../components/save-feedback-banner.js";
import { Button } from "../../components/Button.js";
import { useProductDetailPage } from "./hooks/useProductDetailPage.js";
import { ProductForm } from "./components/ProductForm.js";
import { VariantManager } from "./components/VariantManager.js";
import { MediaUploader } from "./components/MediaUploader.js";
import { SeoSection } from "./components/SeoSection.js";
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
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
        <div>
          <button
            type="button"
            onClick={() => props.onBack?.()}
            style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "4px 0", border: "none", background: "transparent", cursor: "pointer", color: "var(--muted)", font: "600 11.5px var(--sans)", marginBottom: 8 }}
          >
            <ArrowLeft size={12} /> Voltar para o catálogo
          </button>
          <span className="eyebrow">LOJA / CATÁLOGO</span>
          <h1>{page.isEditing ? "Editar produto" : "Novo produto"}</h1>
        </div>
        <Button variant="primary" size="sm" arrow disabled={!page.canSave} onClick={() => void page.handleSave()}>
          <Save size={14} /> {page.saving ? "Salvando..." : page.isEditing ? "Salvar alterações" : "Criar produto"}
        </Button>
      </div>

      <SaveFeedbackBanner
        result={page.saveResult}
        errorMessage={page.saveErrorMsg ?? undefined}
        successMessage={page.isEditing ? "Produto atualizado" : "Produto criado"}
        onDismiss={() => page.setSaveResult(null)}
      />

      {page.loadError ? (
        <div style={{ padding: "12px 16px", borderRadius: 8, background: "var(--danger-soft)", border: "1px solid var(--danger)", font: "13px var(--sans)", color: "var(--danger)", marginBottom: 16 }}>
          {page.loadError}
        </div>
      ) : null}

      {page.loading ? (
        <div style={{ padding: "40px 22px", textAlign: "center", color: "var(--faint)", font: "13px var(--sans)" }}>Carregando produto...</div>
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
            productType={page.form.productType}
            formErrors={page.formErrors}
            onUpdateVariant={page.variantManager.updateVariant}
            onAddVariant={page.variantManager.addVariant}
            onRemoveVariant={page.variantManager.removeVariant}
            onAddAttribute={page.variantManager.addAttribute}
            onUpdateAttribute={page.variantManager.updateAttribute}
            onRemoveAttribute={page.variantManager.removeAttribute}
            onToggleVariantsMode={page.variantManager.toggleVariantsMode}
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
        </div>
      )}
    </div>
  );
}
