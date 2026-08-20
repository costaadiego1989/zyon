import React, { useState } from "react";
import { useApi } from "../../../hooks/useApi.js";
import { reportError } from "../../../hooks/useErrorReporter.js";
import { showToast } from "../../../components/Toast.js";
import { Button } from "../../../components/Button.js";

export interface SeoSectionProps {
  merchantId: string;
  productId: string;
  seoTitle: string;
  seoMetaDesc: string;
  seoSlug: string;
  seoOgTitle: string;
  seoOgDesc: string;
  seoKeywords: string[];
  onUpdate: (seo: {
    seoTitle: string;
    metaDescription: string;
    slug: string;
    ogTitle: string;
    ogDescription: string;
    keywords: string[];
  }) => void;
}

export function SeoSection(props: SeoSectionProps) {
  const { merchantId, productId, seoTitle, seoMetaDesc, seoSlug, seoOgTitle, seoOgDesc, seoKeywords, onUpdate } = props;
  const api = useApi();
  const [generating, setGenerating] = useState(false);

  async function regenerate() {
    setGenerating(true);
    try {
      const seo = await api.generateProductSeo(merchantId, productId);
      onUpdate(seo);
      showToast("success", "SEO gerado com IA");
    } catch (e) {
      showToast("error", "Falha ao gerar SEO. Verifique se o servidor LLM está ativo.");
      reportError({ source: "SeoSection.regenerate", error: e });
    } finally {
      setGenerating(false);
    }
  }

  const charCount = (val: string, max: number) => {
    const len = val.length;
    const color = len > max ? "var(--danger)" : len > max * 0.85 ? "var(--warn)" : "var(--faint)";
    return <span style={{ font: "10px var(--mono)", color }}>{len}/{max}</span>;
  };

  return (
    <section style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 14, padding: "20px 22px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
        <h3 style={{ font: "600 12px var(--mono)", color: "var(--faint)", letterSpacing: "0.05em" }}>SEO & REDES SOCIAIS</h3>
        <Button variant="outline" size="sm" onClick={regenerate} disabled={generating} loading={generating}>
          {generating ? "Gerando..." : seoTitle ? "Alterar com IA" : "Gerar com IA"}
        </Button>
      </div>

      {!seoTitle && !generating && (
        <div style={{ textAlign: "center", padding: "24px 16px", color: "var(--muted)", fontSize: 12, background: "var(--bg)", borderRadius: 8, marginBottom: 14 }}>
          <p style={{ margin: 0 }}>SEO será gerado automaticamente ao criar o produto.</p>
          <p style={{ margin: "4px 0 0" }}>Ou clique "Gerar com IA" para gerar agora.</p>
        </div>
      )}

      {(seoTitle || generating) && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
              <span style={{ font: "600 11px var(--sans)", color: "var(--ink)" }}>Título SEO</span>
              {charCount(seoTitle, 60)}
            </div>
            <input
              value={seoTitle}
              onChange={(e) => onUpdate({ seoTitle: e.target.value, metaDescription: seoMetaDesc, slug: seoSlug, ogTitle: seoOgTitle, ogDescription: seoOgDesc, keywords: seoKeywords })}
              placeholder="Título otimizado para buscadores"
              style={{ width: "100%", padding: "7px 10px", borderRadius: 7, border: "1px solid var(--border)", font: "12.5px var(--mono)", color: "var(--ink)", outline: "none", background: "var(--bg)" }}
            />
          </div>

          <div>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
              <span style={{ font: "600 11px var(--sans)", color: "var(--ink)" }}>Meta Description</span>
              {charCount(seoMetaDesc, 160)}
            </div>
            <textarea
              value={seoMetaDesc}
              onChange={(e) => onUpdate({ seoTitle, metaDescription: e.target.value, slug: seoSlug, ogTitle: seoOgTitle, ogDescription: seoOgDesc, keywords: seoKeywords })}
              placeholder="Descrição que aparece no resultado do Google"
              rows={2}
              style={{ width: "100%", padding: "7px 10px", borderRadius: 7, border: "1px solid var(--border)", font: "12.5px var(--mono)", color: "var(--ink)", outline: "none", background: "var(--bg)", resize: "vertical" }}
            />
          </div>

          <div>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
              <span style={{ font: "600 11px var(--sans)", color: "var(--ink)" }}>Slug (URL)</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 0, background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 7, overflow: "hidden" }}>
              <span style={{ padding: "7px 10px", font: "11px var(--mono)", color: "var(--faint)", background: "var(--card)", borderRight: "1px solid var(--border)", whiteSpace: "nowrap" }}>loja.com/produto/</span>
              <input
                value={seoSlug}
                onChange={(e) => onUpdate({ seoTitle, metaDescription: seoMetaDesc, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""), ogTitle: seoOgTitle, ogDescription: seoOgDesc, keywords: seoKeywords })}
                placeholder="slug-do-produto"
                style={{ flex: 1, padding: "7px 10px", border: "none", font: "12.5px var(--mono)", color: "var(--ink)", outline: "none", background: "transparent" }}
              />
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                <span style={{ font: "600 11px var(--sans)", color: "var(--ink)" }}>OG Title</span>
                {charCount(seoOgTitle, 95)}
              </div>
              <input
                value={seoOgTitle}
                onChange={(e) => onUpdate({ seoTitle, metaDescription: seoMetaDesc, slug: seoSlug, ogTitle: e.target.value, ogDescription: seoOgDesc, keywords: seoKeywords })}
                placeholder="Título para redes sociais"
                style={{ width: "100%", padding: "7px 10px", borderRadius: 7, border: "1px solid var(--border)", font: "12.5px var(--mono)", color: "var(--ink)", outline: "none", background: "var(--bg)" }}
              />
            </div>
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                <span style={{ font: "600 11px var(--sans)", color: "var(--ink)" }}>OG Description</span>
                {charCount(seoOgDesc, 200)}
              </div>
              <input
                value={seoOgDesc}
                onChange={(e) => onUpdate({ seoTitle, metaDescription: seoMetaDesc, slug: seoSlug, ogTitle: seoOgTitle, ogDescription: e.target.value, keywords: seoKeywords })}
                placeholder="Descrição para Facebook/WhatsApp"
                style={{ width: "100%", padding: "7px 10px", borderRadius: 7, border: "1px solid var(--border)", font: "12.5px var(--mono)", color: "var(--ink)", outline: "none", background: "var(--bg)" }}
              />
            </div>
          </div>

          <div>
            <span style={{ font: "600 11px var(--sans)", color: "var(--ink)", display: "block", marginBottom: 4 }}>Keywords</span>
            <input
              value={seoKeywords.join(", ")}
              onChange={(e) => onUpdate({ seoTitle, metaDescription: seoMetaDesc, slug: seoSlug, ogTitle: seoOgTitle, ogDescription: seoOgDesc, keywords: e.target.value.split(",").map((k) => k.trim()).filter(Boolean) })}
              placeholder="palavra-chave, outra-palavra, terceira"
              style={{ width: "100%", padding: "7px 10px", borderRadius: 7, border: "1px solid var(--border)", font: "12.5px var(--mono)", color: "var(--ink)", outline: "none", background: "var(--bg)" }}
            />
            <span style={{ font: "10px var(--mono)", color: "var(--faint)", marginTop: 2, display: "block" }}>Separe por vírgula (5-10 recomendado)</span>
          </div>
        </div>
      )}
    </section>
  );
}
