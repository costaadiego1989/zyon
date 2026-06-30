import { Download, RotateCcw, Save, Settings2, Upload, X } from "lucide-react";
import type { MerchantTheme } from "@zyon/shared-types";
import type { ThemeStudioState } from "../../hooks/use-theme-studio.js";
import { THEME_STUDIO_FONT_OPTIONS } from "../../hooks/checkout-presentation.js";
import { THEME_COLOR_FIELDS, THEME_PRESETS } from "../../lib/theme-studio.js";

function colorValue(theme: MerchantTheme, key: keyof MerchantTheme, fallback: string): string {
  const value = theme[key];
  return typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value) ? value : fallback;
}

function ColorField({
  label,
  value,
  onChange
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="aacp-studio-field">
      <span>{label}</span>
      <div className="aacp-studio-color">
        <input type="color" value={value} onChange={(e) => onChange(e.target.value)} aria-label={label} />
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          spellCheck={false}
          maxLength={7}
        />
      </div>
    </label>
  );
}

export function ThemeStudio({ studio, theme }: { studio: ThemeStudioState; theme: MerchantTheme }) {
  if (!studio.visible) return null;

  return (
    <>
      <button
        type="button"
        className={`aacp-studio-fab${studio.open ? " active" : ""}`}
        onClick={() => studio.setOpen(!studio.open)}
        aria-label={studio.open ? "Fechar Theme Studio" : "Abrir Theme Studio"}
        title="Theme Studio"
      >
        {studio.open ? <X size={22} /> : <Settings2 size={22} />}
      </button>

      <div
        className={`aacp-studio-backdrop${studio.open ? " open" : ""}`}
        onClick={() => studio.setOpen(false)}
        aria-hidden={!studio.open}
      />

      <aside
        className={`aacp-studio-panel${studio.open ? " open" : ""}`}
        aria-label="Theme Studio"
        aria-hidden={!studio.open}
      >
        <header className="aacp-studio-header">
          <div>
            <p className="aacp-studio-kicker">AACP</p>
            <h2>Theme Studio</h2>
            <p className="aacp-studio-sub">Personalize o checkout em tempo real.</p>
          </div>
          <button type="button" className="aacp-studio-close" onClick={() => studio.setOpen(false)} aria-label="Fechar">
            <X size={18} />
          </button>
        </header>

        <div className="aacp-studio-body">
          <section className="aacp-studio-section">
            <h3>Presets</h3>
            <div className="aacp-studio-presets">
              {THEME_PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  className="aacp-studio-preset"
                  onClick={() => studio.applyPreset(preset.id)}
                >
                  <strong>{preset.label}</strong>
                  <span>{preset.description}</span>
                </button>
              ))}
            </div>
          </section>

          <section className="aacp-studio-section">
            <h3>Tipografia</h3>
            <label className="aacp-studio-field">
              <span>Fonte principal</span>
              <select
                value={theme.fontFamily}
                onChange={(e) => studio.setField("fontFamily", e.target.value)}
              >
                {THEME_STUDIO_FONT_OPTIONS.map((opt) => (
                  <option key={opt.label} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </label>
            <label className="aacp-studio-field">
              <span>Fonte de destaque</span>
              <select
                value={theme.fontDisplay ?? theme.fontFamily}
                onChange={(e) => studio.setField("fontDisplay", e.target.value)}
              >
                {THEME_STUDIO_FONT_OPTIONS.map((opt) => (
                  <option key={`d-${opt.label}`} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </label>
          </section>

          <section className="aacp-studio-section">
            <h3>Cores</h3>
            <div className="aacp-studio-grid">
              {THEME_COLOR_FIELDS.map((field) => (
                <ColorField
                  key={field.key}
                  label={field.label}
                  value={colorValue(theme, field.key, "#0F766E")}
                  onChange={(value) => studio.setField(field.key, value)}
                />
              ))}
            </div>
          </section>

          <section className="aacp-studio-section">
            <h3>Layout</h3>
            <label className="aacp-studio-field">
              <span>Raio das bordas ({theme.borderRadius ?? 12}px)</span>
              <input
                type="range"
                min={4}
                max={24}
                step={1}
                value={theme.borderRadius ?? 12}
                onChange={(e) => studio.setField("borderRadius", Number(e.target.value))}
              />
            </label>
            <label className="aacp-studio-field">
              <span>Densidade</span>
              <select
                value={theme.density ?? "comfortable"}
                onChange={(e) => studio.setField("density", e.target.value as MerchantTheme["density"])}
              >
                <option value="compact">Compacta</option>
                <option value="comfortable">Confortável</option>
                <option value="spacious">Espaçosa</option>
              </select>
            </label>
          </section>

          <section className="aacp-studio-section">
            <h3>Cabeçalho</h3>
            <label className="aacp-studio-field">
              <span>Título</span>
              <input
                type="text"
                value={theme.headerTitle ?? ""}
                onChange={(e) => studio.setField("headerTitle", e.target.value)}
                placeholder="Concierge da loja"
                maxLength={80}
              />
            </label>
            <label className="aacp-studio-field">
              <span>Subtítulo</span>
              <input
                type="text"
                value={theme.headerSubtitle ?? ""}
                onChange={(e) => studio.setField("headerSubtitle", e.target.value)}
                placeholder="Pagamento seguro com acompanhamento"
                maxLength={140}
              />
            </label>
            <label className="aacp-studio-field">
              <span>Nome do agente</span>
              <input
                type="text"
                value={theme.agentName ?? ""}
                onChange={(e) => studio.setField("agentName", e.target.value)}
                placeholder="Assistente"
                maxLength={80}
              />
            </label>
          </section>
        </div>

        <footer className="aacp-studio-footer">
          {studio.error ? <p className="aacp-studio-error">{studio.error}</p> : null}
          {studio.status ? <p className="aacp-studio-status">{studio.status}</p> : null}
          <div className="aacp-studio-actions">
            <button type="button" className="aacp-studio-btn ghost" onClick={studio.resetDraft}>
              <RotateCcw size={14} />
              Reset
            </button>
            <button type="button" className="aacp-studio-btn ghost" onClick={studio.exportJson}>
              <Download size={14} />
              JSON
            </button>
            <button type="button" className="aacp-studio-btn" onClick={studio.saveLocal}>
              <Save size={14} />
              Salvar local
            </button>
            {studio.canPersist ? (
              <button
                type="button"
                className="aacp-studio-btn primary"
                disabled={studio.saving}
                onClick={() => void studio.saveRemote()}
              >
                <Upload size={14} />
                {studio.saving ? "Salvando..." : "Publicar agora"}
              </button>
            ) : null}
          </div>
        </footer>
      </aside>
    </>
  );
}
