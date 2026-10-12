import React, { useEffect } from "react";
import { ArrowLeft, Save } from "lucide-react";
import type { MerchantProfile } from "../../api-client.js";
import { showToast } from "../../components/Toast.js";
import { Button } from "../../components/Button.js";
import { PageHeader } from "../../components/PageHeader.js";
import "./product-detail.css";
import { useProductDetailPage } from "./hooks/useProductDetailPage.js";
import { ProductForm } from "./components/ProductForm.js";
import { VariantManager } from "./components/VariantManager.js";
import { MediaUploader } from "./components/MediaUploader.js";
import { SeoSection } from "./components/SeoSection.js";
import { PromotionSection } from "./components/PromotionSection.js";
import { AdvancedLayoutTab } from "./components/AdvancedLayoutTab.js";
import { usePlanFeatures } from "../../hooks/api/usePlanFeatures.js";
import { SectionErrorBoundary } from "../../components/PageErrorBoundary.js";
import type { ServiceScheduleDraft } from "./utils/service-schedule-validation.js";

export type ProductType = "physical" | "digital" | "service" | "food";

export interface ProductMetadata {
  downloadUrl?: string;
  fileSize?: string;
  fileFormat?: string;
  serviceType?: "presencial" | "remoto";
  serviceSchedule?: ServiceScheduleDraft;
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

  const { hasFeature } = usePlanFeatures();
  const showAdvancedLayout = hasFeature("advancedProductLayout");

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
    <div className="page-container product-detail">
      {page.saveErrorMsg && <p role="alert" style={{ color: "var(--color-error)" }}>{page.saveErrorMsg}</p>}
      <div className="product-detail__header">
        <Button variant="ghost" size="sm" onClick={() => props.onBack?.()}><ArrowLeft size={14} /> Voltar para Produtos</Button>
        <PageHeader title={page.isEditing ? (page.form.name || "Editar produto") : "Novo produto"} description="Preencha as informações, defina preço e estoque e adicione as imagens." actions={<Button variant="primary" loading={page.saving} disabled={!page.canSave} onClick={() => void page.handleSave()}><Save size={14} /> {page.isEditing ? "Salvar alterações" : "Criar produto"}</Button>} />
      </div>
      {page.loading ? (
        <div style={{ padding: "40px 22px", textAlign: "center", color: "var(--color-text-faint)", font: "13px var(--font-sans)" }}>Carregando produto...</div>
      ) : page.loadError ? (
        <div className="product-detail__feedback" role="alert"><p>{page.loadError}</p><Button variant="outline" onClick={page.retryLoad}>Tentar novamente</Button></div>
      ) : (
        <fieldset className="product-detail__fields" disabled={page.saving} aria-label="Dados do produto">


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
            onCreateCategory={page.createCategory}
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

          {page.isEditing && page.merchantId && (
            <SectionErrorBoundary sectionName="SEO">
            <details className="product-detail__advanced"><summary><strong>Busca e compartilhamento</strong><span>Título, descrição e endereço usados para apresentar o produto.</span></summary>

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
            </details>
            </SectionErrorBoundary>
          )}

          {page.merchantId && (
            <SectionErrorBoundary sectionName="Promoção">
            <details className="product-detail__advanced"><summary><strong>Promoções e regras do produto</strong><span>Defina condições comerciais específicas. Alterações em produtos existentes têm salvamento próprio.</span></summary>

            <PromotionSection
              merchantId={page.merchantId}
              productId={page.createdProductId || props.productId}
              variantSkus={page.variantManager.variants.map((v) => v.sku.trim()).filter(Boolean)}
              onPendingPromoChange={page.setPendingPromoConfig}
              onPendingRulesChange={page.setPendingRulesConfig}
            />
            </details>
            </SectionErrorBoundary>
          )}

          {showAdvancedLayout && page.merchantId && (page.createdProductId || props.productId) && (
            <SectionErrorBoundary sectionName="Conteúdo Avançado">
            <details className="product-detail__advanced"><summary><strong>Conteúdo avançado</strong><span>Personalize a apresentação e salve no editor de conteúdo.</span></summary>

              <AdvancedLayoutTab
                merchantId={page.merchantId}
                productId={page.createdProductId || props.productId!}
              />
            </details>
            </SectionErrorBoundary>
          )}
        </fieldset>
      )}
    </div>
  );
}
