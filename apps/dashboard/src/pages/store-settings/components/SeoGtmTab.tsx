import React, { useState } from "react";
import { Globe, Hash, Sparkles, Tag, Monitor, BarChart3 } from "lucide-react";
import { Button } from "../../../components/Button.js";
import { ToggleSwitch } from "../../../components/ToggleSwitch.js";
import type { SeoSettings, GtmSettings, SeoTone, GenerateSeoSuggestionsResponse } from "@zyon/shared-types";

// ── Inline components ──────────────────────────────────────────────────────────

function CharCounter({ value, max }: { value: string; max: number }) {
  const len = value.length;
  const color = len > max ? "var(--danger)" : len > max * 0.85 ? "var(--warn)" : "var(--faint)";
  return <span style={{ font: "11px var(--mono)", color, marginLeft: 8 }}>{len}/{max}</span>;
}

function FieldError({ error }: { error?: string }) {
  if (!error) return null;
  return <span style={{ font: "11px var(--sans)", color: "var(--danger)", marginTop: 4, display: "block" }}>{error}</span>;
}

function inputStyle(hasError?: boolean): React.CSSProperties {
  return {
    width: "100%", padding: "10px 12px", font: "13px var(--sans)", borderRadius: 8,
    border: `1px solid ${hasError ? "var(--danger)" : "var(--border)"}`, background: "var(--bg)",
    color: "var(--ink)", outline: "none",
  };
}

const labelStyle: React.CSSProperties = { font: "600 12px var(--sans)", color: "var(--muted)", marginBottom: 6, display: "flex", alignItems: "center", gap: 6 };
const sectionCard: React.CSSProperties = { background: "var(--card)", border: "1px solid var(--border)", borderRadius: 12, padding: "20px 22px", marginBottom: 16 };

// ── Generator Modal ───────────────────────────────────────────────────────────

function SeoGeneratorModal({
  isOpen, onClose, onGenerate, onApply, loading, suggestions,
}: {
  isOpen: boolean;
  onClose: () => void;
  onGenerate: (prompt: string, tone: SeoTone, category?: string) => void;
  onApply: (titleIdx: number, descIdx: number, keywords: string[]) => void;
  loading: boolean;
  suggestions: GenerateSeoSuggestionsResponse | null;
}) {
  const [prompt, setPrompt] = useState("");
  const [tone, setTone] = useState<SeoTone>("profissional");
  const [selectedTitle, setSelectedTitle] = useState(0);
  const [selectedDesc, setSelectedDesc] = useState(0);

  if (!isOpen) return null;

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.6)", backdropFilter: "blur(3px)" }} onClick={onClose}>
      <div style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 16, padding: 28, maxWidth: 560, width: "90%", maxHeight: "80vh", overflowY: "auto" }} onClick={(e) => e.stopPropagation()}>
        <h3 style={{ font: "600 14px var(--sans)", marginBottom: 16, color: "var(--accent)" }}>
          Gerar SEO com IA
        </h3>

        {!suggestions ? (
          <>
            <label style={labelStyle}>Descreva seu negócio</label>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Ex: Loja de roupas femininas premium, moda sustentável, entrega para todo Brasil..."
              style={{ ...inputStyle(), minHeight: 80, resize: "vertical" }}
            />
            <span style={{ font: "11px var(--mono)", color: "var(--faint)", marginTop: 4, display: "block" }}>{prompt.length}/500 caracteres (mín. 10)</span>

            <label style={{ ...labelStyle, marginTop: 16 }}>Tom de voz</label>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {(["profissional", "casual", "luxo", "técnico"] as SeoTone[]).map((t) => (
                <button
                  key={t}
                  onClick={() => setTone(t)}
                  style={{
                    padding: "6px 12px", borderRadius: 6, font: "12px var(--sans)",
                    border: `1px solid ${tone === t ? "var(--accent)" : "var(--border)"}`,
                    background: tone === t ? "var(--accent-soft)" : "transparent",
                    color: tone === t ? "var(--accent)" : "var(--muted)", cursor: "pointer",
                  }}
                >
                  {t.charAt(0).toUpperCase() + t.slice(1)}
                </button>
              ))}
            </div>

            <div style={{ marginTop: 20, display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <Button variant="outline" size="sm" onClick={onClose}>Cancelar</Button>
              <Button variant="primary" size="sm" arrow onClick={() => onGenerate(prompt, tone)} disabled={prompt.length < 10 || loading} loading={loading}>
                <Sparkles size={14} /> Gerar
              </Button>
            </div>
          </>
        ) : (
          <>
            <label style={labelStyle}>Títulos sugeridos</label>
            {suggestions.titles.map((t, i) => (
              <label key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", borderRadius: 8, border: `1px solid ${selectedTitle === i ? "var(--accent)" : "var(--border)"}`, marginBottom: 8, cursor: "pointer", background: selectedTitle === i ? "var(--accent-soft)" : "transparent" }}>
                <input type="radio" name="title" checked={selectedTitle === i} onChange={() => setSelectedTitle(i)} />
                <span style={{ font: "13px var(--sans)", color: "var(--ink)" }}>{t}</span>
                <CharCounter value={t} max={70} />
              </label>
            ))}

            <label style={{ ...labelStyle, marginTop: 16 }}>Descrições sugeridas</label>
            {suggestions.descriptions.map((d, i) => (
              <label key={i} style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "8px 12px", borderRadius: 8, border: `1px solid ${selectedDesc === i ? "var(--accent)" : "var(--border)"}`, marginBottom: 8, cursor: "pointer", background: selectedDesc === i ? "var(--accent-soft)" : "transparent" }}>
                <input type="radio" name="desc" checked={selectedDesc === i} onChange={() => setSelectedDesc(i)} style={{ marginTop: 3 }} />
                <span style={{ font: "12px var(--sans)", color: "var(--ink)", lineHeight: 1.4 }}>{d}</span>
              </label>
            ))}

            <label style={{ ...labelStyle, marginTop: 16 }}>Keywords sugeridas</label>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {suggestions.keywords.map((kw, i) => (
                <span key={i} style={{ padding: "4px 10px", borderRadius: 20, font: "11px var(--sans)", background: "var(--accent-soft)", color: "var(--accent)", border: "1px solid var(--accent-line)" }}>{kw}</span>
              ))}
            </div>

            <div style={{ marginTop: 20, display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <Button variant="outline" size="sm" onClick={onClose}>Cancelar</Button>
              <Button variant="primary" size="sm" arrow onClick={() => onApply(selectedTitle, selectedDesc, suggestions.keywords)}>
                Aplicar sugestões
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── Main Tab ──────────────────────────────────────────────────────────────────

export interface SeoGtmTabProps {
  seo: SeoSettings;
  gtm: GtmSettings;
  errors: Record<string, string>;
  saving: boolean;
  generatingAi: boolean;
  showGeneratorModal: boolean;
  suggestions: GenerateSeoSuggestionsResponse | null;
  expandedSections?: { og: boolean; pixels: boolean };
  onSeoChange: (partial: Partial<SeoSettings>) => void;
  onGtmChange: (partial: Partial<GtmSettings>) => void;
  onSave: () => void;
  onGenerate: (prompt: string, tone: SeoTone, category?: string) => void;
  onApplySuggestion: (titleIdx: number, descIdx: number, keywords: string[]) => void;
  onOpenModal: () => void;
  onCloseModal: () => void;
  onToggleSection?: (section: "og" | "pixels") => void;
}

export function SeoGtmTab({
  seo, gtm, errors, saving, generatingAi, showGeneratorModal, suggestions, expandedSections,
  onSeoChange, onGtmChange, onSave, onGenerate, onApplySuggestion, onOpenModal, onCloseModal, onToggleSection,
}: SeoGtmTabProps) {
  const [keywordInput, setKeywordInput] = useState("");
  const showOgSection = expandedSections?.og ?? false;
  const showPixelsSection = expandedSections?.pixels ?? false;

  function addKeyword() {
    const kw = keywordInput.trim();
    if (!kw || (seo.keywords ?? []).length >= 10) return;
    onSeoChange({ keywords: [...(seo.keywords ?? []), kw] });
    setKeywordInput("");
  }

  function removeKeyword(idx: number) {
    const next = [...(seo.keywords ?? [])];
    next.splice(idx, 1);
    onSeoChange({ keywords: next });
  }

  return (
    <div>
      {/* ── SEO Section ── */}
      <section style={sectionCard}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18 }}>
          <h3 style={{ font: "600 14px var(--sans)", color: "var(--accent)", display: "flex", alignItems: "center", gap: 8 }}>
            SEO — Metatags
          </h3>
          <Button variant="primary" size="sm" onClick={onOpenModal}>
            <Sparkles size={14} /> Gerar com IA
          </Button>
        </div>

        {/* Title */}
        <div style={{ marginBottom: 16 }}>
          <label style={labelStyle}>
            <Tag size={12} /> Título SEO <CharCounter value={seo.title ?? ""} max={70} />
          </label>
          <input
            type="text"
            value={seo.title ?? ""}
            onChange={(e) => onSeoChange({ title: e.target.value })}
            placeholder="Ex: Loja de Moda Sustentável | Entrega Rápida"
            style={inputStyle(!!errors.seoTitle)}
          />
          <FieldError error={errors.seoTitle} />
        </div>

        {/* Description */}
        <div style={{ marginBottom: 16 }}>
          <label style={labelStyle}>
            Descrição SEO <CharCounter value={seo.description ?? ""} max={160} />
          </label>
          <textarea
            value={seo.description ?? ""}
            onChange={(e) => onSeoChange({ description: e.target.value })}
            placeholder="Descrição que aparece nos resultados do Google..."
            style={{ ...inputStyle(!!errors.seoDescription), minHeight: 60, resize: "vertical" }}
          />
          <FieldError error={errors.seoDescription} />
        </div>

        {/* Keywords */}
        <div style={{ marginBottom: 16 }}>
          <label style={labelStyle}>
            <Hash size={12} /> Palavras-chave ({(seo.keywords ?? []).length}/10)
          </label>
          <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
            <input
              type="text"
              value={keywordInput}
              onChange={(e) => setKeywordInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addKeyword())}
              placeholder="Digite e pressione Enter"
              style={{ ...inputStyle(), flex: 1 }}
            />
            <Button variant="outline" size="sm" onClick={addKeyword} disabled={(seo.keywords ?? []).length >= 10}>+</Button>
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {(seo.keywords ?? []).map((kw, i) => (
              <span key={i} style={{ padding: "4px 10px", borderRadius: 20, font: "11px var(--sans)", background: "var(--accent-soft)", color: "var(--accent)", border: "1px solid var(--accent-line)", display: "flex", alignItems: "center", gap: 4 }}>
                {kw}
                <button onClick={() => removeKeyword(i)} style={{ background: "none", border: "none", color: "var(--danger)", cursor: "pointer", padding: 0, font: "inherit", lineHeight: 1 }}>×</button>
              </span>
            ))}
          </div>
          <FieldError error={errors.keywords} />
        </div>

        {/* Open Graph */}
        <div style={{ marginTop: 16, border: "1px solid var(--border)", borderRadius: 8, overflow: "hidden" }}>
          <div style={{ padding: "12px 14px", background: "var(--bg)", font: "600 12px var(--sans)", color: "var(--muted)", cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center" }} onClick={() => onToggleSection?.("og")}>
            Open Graph (compartilhamento social)
          </div>
          {showOgSection && (
            <div style={{ display: "grid", gap: 14, padding: "14px 14px", borderTop: "1px solid var(--border)" }}>
              <div>
                <label style={labelStyle}>OG Título <CharCounter value={seo.ogTitle ?? ""} max={70} /></label>
                <input type="text" value={seo.ogTitle ?? ""} onChange={(e) => onSeoChange({ ogTitle: e.target.value })} placeholder="Título para redes sociais" style={inputStyle(!!errors.ogTitle)} />
                <FieldError error={errors.ogTitle} />
              </div>
              <div>
                <label style={labelStyle}>OG Descrição <CharCounter value={seo.ogDescription ?? ""} max={160} /></label>
                <textarea value={seo.ogDescription ?? ""} onChange={(e) => onSeoChange({ ogDescription: e.target.value })} placeholder="Descrição para redes sociais" style={{ ...inputStyle(!!errors.ogDescription), minHeight: 50, resize: "vertical" }} />
                <FieldError error={errors.ogDescription} />
              </div>
              <div>
                <label style={labelStyle}>OG Imagem (URL)</label>
                <input type="url" value={seo.ogImage ?? ""} onChange={(e) => onSeoChange({ ogImage: e.target.value })} placeholder="https://..." style={inputStyle()} />
                {seo.ogImage && <img src={seo.ogImage} alt="OG preview" style={{ marginTop: 8, maxWidth: 200, maxHeight: 105, borderRadius: 6, border: "1px solid var(--border)", objectFit: "cover" }} />}
              </div>
              <div>
                <label style={labelStyle}>URL Canônica</label>
                <input type="url" value={seo.canonicalUrl ?? ""} onChange={(e) => onSeoChange({ canonicalUrl: e.target.value })} placeholder="https://sualoja.com (auto-preenchido se vazio)" style={inputStyle()} />
              </div>
            </div>
          )}
        </div>
      </section>

      {/* ── GTM Section ── */}
      <section style={sectionCard}>
        <h3 style={{ font: "600 14px var(--sans)", color: "var(--accent)", marginBottom: 18 }}>
          GTM & Analytics
        </h3>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          <div>
            <label style={labelStyle}><Monitor size={12} /> Google Tag Manager ID</label>
            <input type="text" value={gtm.gtmId ?? ""} onChange={(e) => onGtmChange({ gtmId: e.target.value })} placeholder="GTM-XXXXXX" style={inputStyle(!!errors.gtmId)} />
            <FieldError error={errors.gtmId} />
          </div>
          <div>
            <label style={labelStyle}>Google Analytics 4 ID</label>
            <input type="text" value={gtm.gaTrackingId ?? ""} onChange={(e) => onGtmChange({ gaTrackingId: e.target.value })} placeholder="G-XXXXXX" style={inputStyle(!!errors.gaTrackingId)} />
            <FieldError error={errors.gaTrackingId} />
          </div>
        </div>

        {/* Pixels */}
        <div style={{ marginTop: 16, border: "1px solid var(--border)", borderRadius: 8, overflow: "hidden" }}>
          <div style={{ padding: "12px 14px", background: "var(--bg)", font: "600 12px var(--sans)", color: "var(--muted)", cursor: "pointer" }} onClick={() => onToggleSection?.("pixels")}>
            Pixels de conversão
          </div>
          {showPixelsSection && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, padding: "14px 14px", borderTop: "1px solid var(--border)" }}>
              <div>
                <label style={labelStyle}>Facebook Pixel ID</label>
                <input type="text" value={gtm.pixelIds?.facebook ?? ""} onChange={(e) => onGtmChange({ pixelIds: { ...gtm.pixelIds, facebook: e.target.value } })} placeholder="123456789012345" style={inputStyle()} />
              </div>
              <div>
                <label style={labelStyle}>TikTok Pixel ID</label>
                <input type="text" value={gtm.pixelIds?.tiktok ?? ""} onChange={(e) => onGtmChange({ pixelIds: { ...gtm.pixelIds, tiktok: e.target.value } })} placeholder="CXXXXXXXXXXXXXXX" style={inputStyle()} />
              </div>
            </div>
          )}
        </div>

        {/* Data Layer Toggle */}
        <div style={{ marginTop: 16, display: "flex", alignItems: "center", gap: 10 }}>
          <ToggleSwitch
            id="gtm-datalayer"
            checked={gtm.dataLayerEnabled !== false}
            disabled={false}
            onChange={(v) => onGtmChange({ dataLayerEnabled: v })}
          />
          <span id="gtm-datalayer" style={{ font: "12px var(--sans)", color: "var(--muted)" }}>Ativar GTM Data Layer (eventos: pageview, purchase, add_to_cart)</span>
        </div>
      </section>

      {/* ── Save Button ── */}
      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 8 }}>
        <Button variant="primary" size="sm" arrow onClick={onSave} disabled={saving} loading={saving}>
          Salvar SEO & GTM
        </Button>
      </div>

      {/* ── Generator Modal ── */}
      <SeoGeneratorModal
        isOpen={showGeneratorModal}
        onClose={onCloseModal}
        onGenerate={onGenerate}
        onApply={onApplySuggestion}
        loading={generatingAi}
        suggestions={suggestions}
      />
    </div>
  );
}
