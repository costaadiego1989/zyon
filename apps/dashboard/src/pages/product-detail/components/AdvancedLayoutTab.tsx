import React, { useState } from "react";
import { TabBar } from "../../../components/TabBar.js";
import { EmptyState } from "../../../components/EmptyState.js";
import { showToast } from "../../../components/Toast.js";
import { SectionErrorBoundary } from "../../../components/PageErrorBoundary.js";
import { ProductBlockEditor } from "./ProductBlockEditor.js";
import { ProductFaqEditor } from "./ProductFaqEditor.js";
import { ProductTestimonialEditor } from "./ProductTestimonialEditor.js";
import { ProductVideoEditor } from "./ProductVideoEditor.js";
import { AdvancedLayoutEnableToggle } from "./AdvancedLayoutEnableToggle.js";
import { useAdvancedLayout } from "../hooks/useAdvancedLayout.js";

export interface AdvancedLayoutTabProps {
  merchantId: string | null;
  productId: string | null;
}

const TABS = [
  { key: "blocks", label: "Blocos" },
  { key: "faqs", label: "FAQ" },
  { key: "testimonials", label: "Depoimentos" },
  { key: "videos", label: "Vídeos" },
];

/**
 * Top-level "Conteúdo Avançado" orchestrator.
 *
 * Container pattern mirrors `PromotionSection`: a single `<section>` card
 * with surface-2 / border / radius 14 / padding 20 22. Inside:
 *  1. `AdvancedLayoutEnableToggle` — the section-level enable row. Visual
 *     contract matches PromotionSection exactly (label + ToggleSwitch +
 *     title + stateful subtitle) so the two feature toggles on the product
 *     detail page feel like one component.
 *  2. When OFF: a single disabled notice inside the same card. No tabs.
 *  3. When ON: TabBar switching between four editors (each owns its own
 *     per-tab toggles + empty state) inside the same card.
 *
 * Save flow: editor.onSave() -> useAdvancedLayout.saveBlocks/Faq/Testimonial/
 * Video -> POST/PUT against `apps/api/src/modules/catalog/presentation/http/
 * product-content.controller.ts`. On 422 the hook restores the snapshot.
 */
export function AdvancedLayoutTab({ merchantId, productId }: AdvancedLayoutTabProps) {
  const [tab, setTab] = useState<string>("blocks");
  const isReady = !!merchantId && !!productId;

  const layout = useAdvancedLayout({
    merchantId,
    productId,
  });

  const body = layout.enabled
    ? (() => {
        if (!isReady) {
          return (
            <>
              <DraftNotice />
              <TabBar tabs={TABS} activeTab={tab} onTabChange={setTab} />
              <div style={{ marginTop: 14 }}>
                {renderTab(tab, merchantId ?? "", productId ?? "", layout)}
              </div>
            </>
          );
        }
        if (
          layout.loading &&
          layout.surface.blocks.length === 0 &&
          layout.surface.faqs.length === 0
        ) {
          return (
            <>
              <TabBar tabs={TABS} activeTab={tab} onTabChange={setTab} />
              <div style={{ marginTop: 14 }}>
                <EmptyState message="Carregando conteúdo..." />
              </div>
            </>
          );
        }
        if (layout.status === "error" && layout.errorMsg) {
          return (
            <>
              {layout.errorMsg ? (
                <div
                  role="alert"
                  style={{
                    background: "oklch(35% 0.13 25 / 0.15)",
                    border: "1px solid oklch(55% 0.18 25)",
                    borderRadius: 10,
                    padding: "8px 12px",
                    font: "12px var(--font-sans)",
                    color: "oklch(75% 0.18 25)",
                    marginBottom: 12,
                  }}
                >
                  {layout.errorMsg}
                </div>
              ) : null}
              <TabBar tabs={TABS} activeTab={tab} onTabChange={setTab} />
              <div style={{ marginTop: 14 }}>
                {renderTab(tab, merchantId!, productId!, layout)}
              </div>
            </>
          );
        }
        return (
          <>
            <TabBar tabs={TABS} activeTab={tab} onTabChange={setTab} />
            <div style={{ marginTop: 14 }}>
              {renderTab(tab, merchantId!, productId!, layout)}
            </div>
          </>
        );
      })()
    : <DisabledNotice />;

  return (
    <section
      style={{
        background: "var(--surface-2)",
        border: "1px solid var(--color-border)",
        borderRadius: 14,
        padding: "20px 22px",
      }}
    >
      <AdvancedLayoutEnableToggle layout={layout} />
      <div style={{ marginTop: 18 }}>{body}</div>
    </section>
  );
}

function DisabledNotice() {
  return (
    <div
      style={{
        border: "1px dashed var(--color-border)",
        borderRadius: 12,
        padding: "20px 22px",
        background: "var(--surface-1)",
        color: "var(--color-text-secondary)",
        font: "13px var(--font-sans)",
        lineHeight: 1.5,
      }}
    >
      O conteúdo avançado está <strong>desativado</strong>. A loja pública não
      exibirá blocos, FAQ, depoimentos ou vídeos deste produto. Ative o toggle
      acima para retomar a edição — os rascunhos ficam preservados.
    </div>
  );
}

function DraftNotice() {
  return (
    <div
      style={{
        border: "1px solid var(--color-brand, #0f766e)",
        borderRadius: 10,
        padding: "12px 14px",
        marginBottom: 14,
        background: "color-mix(in oklch, var(--color-brand, #0f766e) 8%, transparent)",
        color: "var(--color-text-secondary)",
        font: "12px var(--font-sans)",
        lineHeight: 1.5,
      }}
    >
      <strong style={{ color: "var(--color-brand, #0f766e)" }}>Modo rascunho.</strong>{" "}
      Você pode criar blocos, FAQs, depoimentos e vídeos livremente. O conteúdo
      será sincronizado com o backend automaticamente quando você salvar o produto.
    </div>
  );
}

function renderTab(
  tab: string,
  merchantId: string,
  productId: string,
  layout: ReturnType<typeof useAdvancedLayout>,
) {
  switch (tab) {
    case "blocks":
      return (
        <SectionErrorBoundary sectionName="Editor de blocos">
          <ProductBlockEditor
            initialBlocks={layout.surface.blocks}
            productId={productId}
            merchantId={merchantId}
            readOnly={layout.status === "saving"}
            onSave={async (blocks) => {
              await layout.saveBlocks(
                blocks.map((b, idx) => ({
                  ...b,
                  productId,
                  order: idx,
                })),
              );
            }}
          />
        </SectionErrorBoundary>
      );
    case "faqs":
      return (
        <SectionErrorBoundary sectionName="Editor de FAQs">
          <ProductFaqEditor
            faqs={layout.surface.faqs.map((f, idx) => ({ ...f, productId, order: idx }))}
            busy={layout.status === "saving"}
            onSave={async (faq) => {
              try {
                await layout.saveFaq({
                  productId,
                  id: faq.id,
                  question: faq.question,
                  answer: faq.answer,
                  order: faq.order,
                  isPublished: faq.isPublished,
                });
              } catch (e) {
                showToast("error", e instanceof Error ? e.message : "Erro ao salvar FAQ");
                throw e;
              }
            }}
            onDelete={async (id) => {
              try {
                await layout.removeFaq(id);
              } catch (e) {
                showToast("error", e instanceof Error ? e.message : "Erro ao remover FAQ");
                throw e;
              }
            }}
            onReorder={async (orderedIds) => {
              try {
                await layout.reorderFaqs(orderedIds);
              } catch (e) {
                showToast("error", e instanceof Error ? e.message : "Erro ao reordenar FAQs");
                throw e;
              }
            }}
          />
        </SectionErrorBoundary>
      );
    case "testimonials":
      return (
        <SectionErrorBoundary sectionName="Editor de depoimentos">
          <ProductTestimonialEditor
            testimonials={layout.surface.testimonials.map((t, idx) => ({ ...t, productId, order: idx }))}
            busy={layout.status === "saving"}
            showOnStorefront={layout.testimonialsVisible}
            onToggleShow={(next) => layout.setTestimonialsVisible(next)}
            onModerate={async (id, action, isPublished) => {
              try {
                await layout.moderateTestimonial(id, action, isPublished);
              } catch (e) {
                showToast("error", e instanceof Error ? e.message : "Erro ao moderar");
                throw e;
              }
            }}
          />
        </SectionErrorBoundary>
      );
    case "videos":
      return (
        <SectionErrorBoundary sectionName="Editor de vídeos">
          <ProductVideoEditor
            videos={layout.surface.videos.map((v, idx) => ({ ...v, productId, order: idx }))}
            merchantId={merchantId}
            busy={layout.status === "saving"}
            onSave={async (v) => {
              try {
                await layout.saveVideo({
                  productId,
                  id: v.id,
                  title: v.title,
                  videoUrl: v.videoUrl,
                  thumbnailUrl: v.thumbnailUrl ?? undefined,
                  durationSeconds: v.durationSeconds ?? undefined,
                  order: v.order,
                  isPublished: v.isPublished,
                  moderationStatus: v.moderationStatus,
                });
              } catch (e) {
                showToast("error", e instanceof Error ? e.message : "Erro ao salvar vídeo");
                throw e;
              }
            }}
            onDelete={async (id) => {
              try {
                await layout.removeVideo(id);
              } catch (e) {
                showToast("error", e instanceof Error ? e.message : "Erro ao remover vídeo");
                throw e;
              }
            }}
            onModerate={async (id, action, isPublished) => {
              try {
                await layout.moderateVideo(id, action, isPublished);
              } catch (e) {
                showToast("error", e instanceof Error ? e.message : "Erro ao moderar vídeo");
                throw e;
              }
            }}
          />
        </SectionErrorBoundary>
      );
    default:
      return null;
  }
}
