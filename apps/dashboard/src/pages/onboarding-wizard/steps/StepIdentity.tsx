import React, { useState } from "react";
import { Check } from "lucide-react";
import type { ThemeDraft } from "../useOnboardingWizard.js";
import { FormField, FormSelect } from "../../../components/FormField.js";

type StepIdentityProps = {
  themeDraft: ThemeDraft;
  setThemeDraft: React.Dispatch<React.SetStateAction<ThemeDraft>>;
  fieldErrors: Record<string, string>;
  FONT_OPTIONS: string[];
  STORE_CATEGORIES: { value: string; label: string; emoji: string }[];
  me: { name: string };
};

function StoreCategorySelect({ value, onChange, categories }: { value: string; onChange: (v: string) => void; categories: { value: string; label: string; emoji: string }[] }) {
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);

  const filtered = search
    ? categories.filter((c) => c.label.toLowerCase().includes(search.toLowerCase()) || c.value.includes(search.toLowerCase()))
    : categories;

  const selected = categories.find((c) => c.value === value);

  return (
    <div style={{ position: "relative" }}>
      <div
        onClick={() => setOpen(!open)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: "8px",
          padding: "8px 12px",
          borderRadius: "8px",
          border: "1px solid var(--color-border)",
          background: "var(--color-surface-raised)",
          cursor: "pointer",
          fontSize: "13px",
          minHeight: "38px",
        }}
      >
        {selected ? (
          <>
            <span>{selected.emoji}</span>
            <span style={{ flex: 1 }}>{selected.label}</span>
          </>
        ) : (
          <span style={{ flex: 1, color: "var(--color-muted)" }}>Selecione o tipo de loja...</span>
        )}
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 9l6 6 6-6" /></svg>
      </div>

      {open && (
        <div style={{
          position: "absolute",
          top: "100%",
          left: 0,
          right: 0,
          marginTop: "4px",
          background: "var(--color-surface-raised)",
          border: "1px solid var(--color-border)",
          borderRadius: "10px",
          boxShadow: "0 12px 40px rgba(0,0,0,0.18)",
          zIndex: 50,
          maxHeight: "260px",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}>
          <div style={{ padding: "8px", borderBottom: "1px solid var(--color-border)" }}>
            <input
              type="text"
              placeholder="Buscar categoria..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              autoFocus
              style={{
                width: "100%",
                padding: "7px 10px",
                borderRadius: "6px",
                border: "1px solid var(--color-border)",
                background: "var(--color-bg)",
                fontSize: "12px",
                outline: "none",
              }}
            />
          </div>
          <div style={{ overflowY: "auto", flex: 1 }}>
            {filtered.map((cat) => (
              <div
                key={cat.value}
                onClick={() => { onChange(cat.value); setOpen(false); setSearch(""); }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  padding: "8px 12px",
                  cursor: "pointer",
                  fontSize: "12.5px",
                  background: cat.value === value ? "var(--color-accent-subtle, rgba(15,118,110,0.08))" : "transparent",
                  transition: "background 0.1s",
                }}
                onMouseEnter={(e) => { if (cat.value !== value) (e.currentTarget).style.background = "var(--color-bg)"; }}
                onMouseLeave={(e) => { if (cat.value !== value) (e.currentTarget).style.background = "transparent"; }}
              >
                <span style={{ fontSize: "16px" }}>{cat.emoji}</span>
                <span style={{ flex: 1 }}>{cat.label}</span>
                {cat.value === value && <Check size={14} style={{ color: "var(--color-accent)" }} />}
              </div>
            ))}
            {filtered.length === 0 && (
              <div style={{ padding: "16px", textAlign: "center", color: "var(--color-muted)", fontSize: "12px" }}>
                Nenhuma categoria encontrada
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function StepIdentity({ themeDraft, setThemeDraft, fieldErrors, FONT_OPTIONS, STORE_CATEGORIES, me }: StepIdentityProps) {
  return (
    <div className="onb-fields">
      <div className="onb-field">
        <label className="onb-field-label" htmlFor="onb-accent">Cor principal da marca</label>
        <div className="onb-color-field">
          <input
            id="onb-accent"
            type="color"
            value={themeDraft.accentColor}
            onChange={(e) => setThemeDraft((d) => ({ ...d, accentColor: e.target.value }))}
            className="onb-color-swatch"
          />
          <span className="onb-mono">{themeDraft.accentColor}</span>
        </div>
        {fieldErrors.accentColor && <span className="onb-field-error">{fieldErrors.accentColor}</span>}
      </div>

      <div className="onb-field">
        <label className="onb-field-label" htmlFor="onb-secondary">Cor secundária (botões e links)</label>
        <div className="onb-color-field">
          <input
            id="onb-secondary"
            type="color"
            value={themeDraft.secondaryColor}
            onChange={(e) => setThemeDraft((d) => ({ ...d, secondaryColor: e.target.value }))}
            className="onb-color-swatch"
          />
          <span className="onb-mono">{themeDraft.secondaryColor}</span>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <FormSelect
          label="Tipografia títulos"
          value={themeDraft.headingFont}
          onChange={(value) => setThemeDraft((d) => ({ ...d, headingFont: value }))}
          options={FONT_OPTIONS.map((f) => ({ value: f, label: f.split(",")[0] }))}
        />
        <FormSelect
          label="Tipografia corpo"
          value={themeDraft.bodyFont}
          onChange={(value) => setThemeDraft((d) => ({ ...d, bodyFont: value }))}
          options={FONT_OPTIONS.map((f) => ({ value: f, label: f.split(",")[0] }))}
        />
      </div>

      <div className="onb-field">
        <label className="onb-field-label" htmlFor="onb-logo">Logotipo da loja</label>
        <div
          style={{
            border: "2px dashed var(--color-border)",
            borderRadius: "var(--radius-sm)",
            padding: "20px",
            textAlign: "center",
            cursor: "pointer",
            transition: "border-color 0.15s",
            position: "relative",
          }}
          onDragOver={(e) => { e.preventDefault(); e.currentTarget.style.borderColor = "var(--color-brand)"; }}
          onDragLeave={(e) => { e.currentTarget.style.borderColor = "var(--color-border)"; }}
          onDrop={(e) => {
            e.preventDefault();
            e.currentTarget.style.borderColor = "var(--color-border)";
            const file = e.dataTransfer.files[0];
            if (file && file.type.startsWith("image/")) {
              const reader = new FileReader();
              reader.onload = () => setThemeDraft((d) => ({ ...d, logoUrl: reader.result as string }));
              reader.readAsDataURL(file);
            }
          }}
          onClick={() => document.getElementById("onb-logo-file")?.click()}
        >
          <input
            id="onb-logo-file"
            type="file"
            accept="image/*"
            style={{ display: "none" }}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) {
                const reader = new FileReader();
                reader.onload = () => setThemeDraft((d) => ({ ...d, logoUrl: reader.result as string }));
                reader.readAsDataURL(file);
              }
            }}
          />
          {themeDraft.logoUrl ? (
            <img src={themeDraft.logoUrl} alt="Logo" style={{ maxHeight: 48, maxWidth: "100%", objectFit: "contain" }} />
          ) : (
            <span style={{ font: "13px var(--font-sans, 'Manrope', sans-serif)", color: "var(--color-text-muted)" }}>
              Arraste uma imagem ou clique para selecionar
            </span>
          )}
        </div>
        {themeDraft.logoUrl && (
          <button type="button" onClick={() => setThemeDraft((d) => ({ ...d, logoUrl: "" }))} style={{ marginTop: 6, fontSize: "11px", color: "var(--color-text-muted)", background: "none", border: "none", cursor: "pointer", padding: 0 }}>
            Remover logo
          </button>
        )}
      </div>

      <div className="onb-field">
        <FormField
          label="Nome exibido no widget"
          type="text"
          placeholder="Ex: Minha Loja Official"
          value={themeDraft.headerTitle ?? ""}
          onChange={(value) => setThemeDraft((d) => ({ ...d, headerTitle: value }))}
          error={fieldErrors.headerTitle}
        />
      </div>

      <div className="onb-field">
        <label className="onb-field-label" htmlFor="onb-category">Tipo de loja</label>
        <StoreCategorySelect
          value={themeDraft.storeCategory ?? ""}
          onChange={(v) => setThemeDraft((d) => ({ ...d, storeCategory: v }))}
          categories={STORE_CATEGORIES}
        />
        <p className="onb-field-help">A IA usa esse contexto para não sugerir produtos fora do seu segmento.</p>
        {fieldErrors.storeCategory && <span className="onb-field-error">{fieldErrors.storeCategory}</span>}
      </div>

      <div className="onb-field">
        <FormField
          label="Nome do assistente de vendas"
          type="text"
          placeholder="Ex: Luna, Max, Sofia"
          value={themeDraft.agentName ?? ""}
          onChange={(value) => setThemeDraft((d) => ({ ...d, agentName: value }))}
          error={fieldErrors.agentName}
        />
      </div>
    </div>
  );
}
