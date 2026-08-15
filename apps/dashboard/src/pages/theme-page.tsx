import React, { useEffect, useMemo, useRef, useState } from "react";
import { RotateCcw, Save, X } from "lucide-react";
import { DEFAULT_MERCHANT_THEME, type MerchantTheme } from "@zyon/shared-types";
import { createDashboardApi, DashboardHttpError, type MerchantProfile } from "../api-client.js";
import { LivePreviewPanel, type LivePreviewPanelRef } from "../components/LivePreviewPanel.js";

// ── Exported Constants & Helpers (testable) ──────────────────────────────────

export const LABELS = {
  loginRequired: "Login necessário.",
  tenantSubtitle: "Personalize a aparência do checkout para combinar com sua marca.",
  headerTitle: "Nome da loja",
  headerSubtitle: "Subtítulo da loja",
  badges: "Selos de confiança",
  fontUi: "Tipografia da interface",
  fontDisplay: "Tipografia de destaque",
  borderRadius: "Arredondamento",
  assetsLayout: "Imagens e layout",
  reset: "Restaurar padrão",
  saveSuccess: "Tema salvo com sucesso.",
  resetConfirm: "Restaurar o tema padrão? Suas alterações não salvas serão perdidas.",
  urlInvalid: "URL inválida — use https://...",
  unsavedChanges: "Alterações não salvas",
  badgesMax: "máximo 4",
  addBadge: "Adicionar",
} as const;

export const COLOR_FIELDS: Array<{ key: keyof MerchantTheme; label: string }> = [
  { key: "accentColor", label: "Cor principal — botões e destaques" },
  { key: "secondaryColor", label: "Cor secundária — elementos de apoio" },
  { key: "textColor", label: "Texto principal" },
  { key: "mutedTextColor", label: "Texto discreto" },
  { key: "backgroundColor", label: "Fundo da página" },
  { key: "surfaceColor", label: "Fundo de cartões" },
  { key: "surfaceElevatedColor", label: "Fundo de modais" },
  { key: "borderColor", label: "Bordas e separadores" },
  { key: "successColor", label: "Sucesso e confirmações" },
  { key: "warningColor", label: "Alertas e avisos" },
];

export const DENSITY_OPTIONS: Array<{ value: NonNullable<MerchantTheme["density"]>; label: string }> = [
  { value: "compact", label: "Compacto" },
  { value: "comfortable", label: "Normal" },
  { value: "spacious", label: "Amplo" },
];

export function isValidUrl(value: string): boolean {
  if (!value) return true;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

export function parseBadges(text: string): string[] {
  return text
    .split(",")
    .map((b) => b.trim())
    .filter(Boolean)
    .slice(0, 4);
}

export function canAddBadge(badgesText: string): boolean {
  return parseBadges(badgesText).length < 4;
}

export function computeDirty(
  currentTheme: MerchantTheme,
  currentBadges: string,
  initialTheme: MerchantTheme,
  initialBadges: string
): boolean {
  const currentNormalized = { ...currentTheme, trustBadges: parseBadges(currentBadges) };
  const initialNormalized = { ...initialTheme, trustBadges: parseBadges(initialBadges) };
  return JSON.stringify(currentNormalized) !== JSON.stringify(initialNormalized);
}

// ── Internal Helpers ─────────────────────────────────────────────────────────

const FONT_OPTIONS = [
  "Inter, ui-sans-serif, system-ui, sans-serif",
  "DM Sans, Inter, ui-sans-serif, system-ui, sans-serif",
  "Plus Jakarta Sans, Inter, ui-sans-serif, system-ui, sans-serif",
  "Outfit, Inter, ui-sans-serif, system-ui, sans-serif",
  "Space Grotesk, Inter, ui-sans-serif, system-ui, sans-serif",
  "Nunito, Inter, ui-sans-serif, system-ui, sans-serif",
  "Poppins, Inter, ui-sans-serif, system-ui, sans-serif",
  "Manrope, Inter, ui-sans-serif, system-ui, sans-serif",
  "Sora, Inter, ui-sans-serif, system-ui, sans-serif",
  "Geist, Inter, ui-sans-serif, system-ui, sans-serif",
  "Montserrat, Inter, ui-sans-serif, system-ui, sans-serif",
];

function handleImageUpload(
  file: File,
  onResult: (dataUrl: string) => void
): void {
  const reader = new FileReader();
  reader.onload = () => {
    if (typeof reader.result === "string") {
      onResult(reader.result);
    }
  };
  reader.readAsDataURL(file);
}

function mergeTheme(theme?: Partial<MerchantTheme> | null): MerchantTheme {
  return {
    ...DEFAULT_MERCHANT_THEME,
    ...(theme ?? {}),
  };
}

// ── Component ────────────────────────────────────────────────────────────────

export function ThemePage(props: { apiBaseUrl: string; me: MerchantProfile | null }) {
  const api = useMemo(() => createDashboardApi({ baseUrl: props.apiBaseUrl }), [props.apiBaseUrl]);
  const [theme, setTheme] = useState<MerchantTheme>(mergeTheme());
  const [badgesText, setBadgesText] = useState((DEFAULT_MERCHANT_THEME.trustBadges ?? []).join(", "));
  const [badgeInput, setBadgeInput] = useState("");
  const [message, setMessage] = useState<{ text: string; kind: "info" | "error" } | null>(null);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [initialTheme, setInitialTheme] = useState<MerchantTheme>(mergeTheme());
  const [initialBadges, setInitialBadges] = useState((DEFAULT_MERCHANT_THEME.trustBadges ?? []).join(", "));
  const previewRef = useRef<LivePreviewPanelRef>(null);

  const dirty = useMemo(
    () => computeDirty(theme, badgesText, initialTheme, initialBadges),
    [theme, badgesText, initialTheme, initialBadges]
  );

  // ── Load theme ──
  useEffect(() => {
    async function load() {
      if (!props.me) {
        setTheme(mergeTheme());
        setLoaded(true);
        return;
      }
      setBusy(true);
      setMessage(null);
      try {
        const next = mergeTheme(await api.getMerchantTheme());
        setTheme(next);
        const badges = (next.trustBadges ?? []).join(", ");
        setBadgesText(badges);
        setInitialTheme(next);
        setInitialBadges(badges);
      } catch (e) {
        setMessage({
          text: e instanceof DashboardHttpError ? e.responseBody.slice(0, 160) : e instanceof Error ? e.message : String(e),
          kind: "error",
        });
      } finally {
        setBusy(false);
        setLoaded(true);
      }
    }
    void load();
  }, [api, props.me]);

  // ── Preview sync ──
  useEffect(() => {
    previewRef.current?.postThemeUpdate(normalizedTheme());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [theme, badgesText]);

  // ── Auto-dismiss success messages ──
  useEffect(() => {
    if (message?.kind !== "info") return;
    const timer = setTimeout(() => setMessage(null), 4000);
    return () => clearTimeout(timer);
  }, [message]);

  // ── beforeunload guard ──
  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  function patch(patchValue: Partial<MerchantTheme>) {
    setTheme((current) => ({ ...current, ...patchValue }));
  }

  function normalizedTheme(): MerchantTheme {
    return {
      ...theme,
      trustBadges: parseBadges(badgesText),
    };
  }

  async function save() {
    setBusy(true);
    setMessage(null);
    try {
      const payload = normalizedTheme();
      // Upload logo to S3 if it's a base64 data URI
      if (payload.logoUrl && payload.logoUrl.startsWith("data:")) {
        try {
          const { logoUrl } = await api.uploadLogo(payload.logoUrl);
          payload.logoUrl = logoUrl;
        } catch {
          // S3 failed — save inline as fallback
        }
      }
      const saved = mergeTheme(await api.putMerchantTheme(payload));
      setTheme(saved);
      const badges = (saved.trustBadges ?? []).join(", ");
      setBadgesText(badges);
      setInitialTheme(saved);
      setInitialBadges(badges);
      setMessage({ text: LABELS.saveSuccess, kind: "info" });
    } catch (e) {
      setMessage({
        text: e instanceof DashboardHttpError ? e.responseBody.slice(0, 180) : e instanceof Error ? e.message : String(e),
        kind: "error",
      });
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    if (dirty) {
      const confirmed = window.confirm(LABELS.resetConfirm);
      if (!confirmed) return;
    }
    const next = mergeTheme();
    setTheme(next);
    setBadgesText((next.trustBadges ?? []).join(", "));
  }

  function addBadge() {
    const trimmed = badgeInput.trim();
    if (!trimmed || !canAddBadge(badgesText)) return;
    const current = parseBadges(badgesText);
    current.push(trimmed);
    setBadgesText(current.join(", "));
    setBadgeInput("");
  }

  function removeBadge(index: number) {
    const current = parseBadges(badgesText);
    current.splice(index, 1);
    setBadgesText(current.join(", "));
  }

  // ── Login required state ──
  if (!props.me) {
    return (
      <>
        <header className="page-head">
          <div>
            <h1>Aparência</h1>
            <p className="page-lead">{LABELS.loginRequired}</p>
          </div>
        </header>
      </>
    );
  }

  return (
    <>
      <header className="page-head">
        <div>
          <span className="eyebrow">Personalização</span>
          <h1>Aparência do checkout</h1>
          <p className="page-lead">Adapte cores, fontes e imagens para combinar com sua marca.</p>
        </div>
        <div className="button-row">
          {dirty && <span className="badge warn">Alterações não salvas</span>}
          <button type="button" onClick={reset} disabled={busy} style={{ minHeight: 36 }}>
            <RotateCcw size={14} /> Resetar
          </button>
          <button type="button" className="btn-primary" onClick={() => void save()} disabled={busy} style={{ minHeight: 36 }}>
            <Save size={14} /> Salvar
          </button>
        </div>
      </header>

      {message ? (
        <div
          role="alert"
          aria-live="polite"
          className={`panel ${message.kind === "error" ? "panel-error" : "panel-info"}`}
        >
          {message.text}
        </div>
      ) : null}

      {!loaded && busy ? (
        <div className="split-panel" data-testid="theme-skeleton">
          <div className="split-panel-controls">
            <section className="panel stacked skeleton-panel">
              <div className="skeleton-line w-40" />
              <div className="skeleton-line w-full" />
              <div className="skeleton-line w-full" />
              <div className="skeleton-line w-60" />
            </section>
            <section className="panel stacked skeleton-panel">
              <div className="skeleton-line w-40" />
              <div className="skeleton-line w-full" />
              <div className="skeleton-line w-full" />
            </section>
          </div>
          <div className="split-panel-preview">
            <div className="skeleton-block" style={{ height: 460 }} />
          </div>
        </div>
      ) : (
        <div className="split-panel">
          {/* ── controls column ── */}
          <div className="split-panel-controls">

            {/* Panel 1 — Identidade */}
            <div className="panel stacked">
              <div className="section-header"><h3>Identidade e tipografia</h3></div>

              <label>
                Nome do assistente
                <input
                  type="text"
                  value={theme.agentName ?? ""}
                  onChange={(e) => patch({ agentName: e.target.value })}
                  placeholder="Ex: Pulse, Luna, Max"
                />
                <span className="field-hint">Aparece no cabeçalho do widget</span>
              </label>

              <div className="theme-grid-2">
                <label>
                  Fonte principal
                  <select value={theme.fontFamily} onChange={(e) => patch({ fontFamily: e.target.value })}>
                    {FONT_OPTIONS.map((font) => (
                      <option key={font} value={font}>{font.split(",")[0]}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Fonte de destaque
                  <select
                    value={theme.fontDisplay ?? theme.fontFamily}
                    onChange={(e) => patch({ fontDisplay: e.target.value })}
                  >
                    {FONT_OPTIONS.map((font) => (
                      <option key={font} value={font}>{font.split(",")[0]}</option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="theme-grid-2">
                <label>
                  Título do widget
                  <input
                    value={theme.headerTitle ?? ""}
                    onChange={(e) => patch({ headerTitle: e.target.value })}
                    placeholder="Minha Loja"
                  />
                </label>
                <label>
                  Subtítulo
                  <input
                    value={theme.headerSubtitle ?? ""}
                    onChange={(e) => patch({ headerSubtitle: e.target.value })}
                    placeholder="Finalize sua compra com o melhor preço"
                  />
                </label>
              </div>

            </div>

            {/* Panel — Selos de confiança */}
            <div className="panel stacked">
              <div className="section-header"><h3>Selos de confiança</h3></div>
              <p style={{ fontSize: 12, color: 'var(--color-text-muted)', margin: 0 }}>
                Exibidos como badges no rodapé do widget (ex: "Compra Segura", "Envio Rastreado"). Máximo 4.
              </p>

              {parseBadges(badgesText).length > 0 && (
                <div className="chip-list">
                  {parseBadges(badgesText).map((badge, i) => (
                    <span key={`${badge}-${i}`} className="chip">
                      {badge}
                      <button type="button" className="chip-remove" onClick={() => removeBadge(i)} aria-label={`Remover ${badge}`}>
                        <X size={12} />
                      </button>
                    </span>
                  ))}
                </div>
              )}

              <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                <input
                  style={{ flex: 1 }}
                  value={badgeInput}
                  onChange={(e) => setBadgeInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addBadge(); } }}
                  placeholder="Ex: Compra Segura, Frete Grátis..."
                  disabled={!canAddBadge(badgesText)}
                />
                <button type="button" onClick={addBadge} disabled={!badgeInput.trim() || !canAddBadge(badgesText)} style={{ minHeight: 40, whiteSpace: 'nowrap' }}>
                  Adicionar selo
                </button>
              </div>
              <span className="field-hint">{parseBadges(badgesText).length}/4 selos</span>
            </div>

            {/* Panel 2 — Cores */}
            <div className="panel stacked">
              <div className="section-header"><h3>Paleta de cores</h3></div>
              <div className="theme-grid-2">
                {COLOR_FIELDS.map((field) => (
                  <div key={String(field.key)} className="theme-color-field">
                    <span className="theme-color-label">{field.label}</span>
                    <div className="theme-color-input">
                      <input
                        type="color"
                        value={String(theme[field.key] ?? "#000000")}
                        onChange={(e) => patch({ [field.key]: e.target.value } as Partial<MerchantTheme>)}
                      />
                      <input
                        type="text"
                        value={String(theme[field.key] ?? "")}
                        onChange={(e) => patch({ [field.key]: e.target.value } as Partial<MerchantTheme>)}
                        style={{ flex: 1, fontFamily: 'var(--font-mono)', fontSize: 12 }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Panel 3 — Imagens */}
            <div className="panel stacked">
              <div className="section-header"><h3>Imagens</h3></div>

              {[
                { label: "Logo da marca", key: "logoUrl" as const, hint: "Exibida no topo do widget" },
                { label: "Avatar do assistente", key: "agentAvatarUrl" as const, hint: "Foto do agente na conversa" },
                { label: "Imagem de fundo", key: "backgroundImageUrl" as const, hint: "Background do painel principal" },
              ].map((img) => (
                <div key={img.key} style={{ marginBottom: 'var(--space-4)' }}>
                  <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-secondary)', display: 'block', marginBottom: 'var(--space-1)' }}>{img.label}</span>
                  <span className="field-hint" style={{ marginBottom: 'var(--space-2)', display: 'block' }}>{img.hint}</span>
                  <label
                    style={{
                      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                      gap: 'var(--space-2)', padding: 'var(--space-5)',
                      border: '2px dashed var(--color-border)', borderRadius: 'var(--radius-md)',
                      background: 'var(--color-surface-raised)', cursor: 'pointer',
                      transition: 'border-color 0.15s, background 0.15s',
                    }}
                    onDragOver={(e) => { e.preventDefault(); e.currentTarget.style.borderColor = 'var(--color-brand)'; e.currentTarget.style.background = 'var(--color-brand-subtle)'; }}
                    onDragLeave={(e) => { e.currentTarget.style.borderColor = 'var(--color-border)'; e.currentTarget.style.background = 'var(--color-surface-raised)'; }}
                    onDrop={(e) => { e.preventDefault(); e.currentTarget.style.borderColor = 'var(--color-border)'; e.currentTarget.style.background = 'var(--color-surface-raised)'; const file = e.dataTransfer.files?.[0]; if (file && file.type.startsWith('image/')) handleImageUpload(file, (url) => patch({ [img.key]: url } as Partial<MerchantTheme>)); }}
                  >
                    {theme[img.key] ? (
                      <img src={String(theme[img.key])} alt={img.label} style={{ maxHeight: 48, maxWidth: 120, objectFit: 'contain', borderRadius: 'var(--radius-sm)' }} />
                    ) : (
                      <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>Arraste uma imagem ou clique para enviar</span>
                    )}
                    <input
                      type="file"
                      accept="image/*"
                      style={{ display: "none" }}
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) handleImageUpload(file, (url) => patch({ [img.key]: url } as Partial<MerchantTheme>));
                      }}
                    />
                  </label>
                </div>
              ))}
            </div>

            {/* Panel 4 — Layout */}
            <div className="panel stacked">
              <div className="section-header"><h3>Layout e espaçamento</h3></div>

              <label>
                Arredondamento dos cantos
                <span className="field-hint">{theme.borderRadius ?? DEFAULT_MERCHANT_THEME.borderRadius}px</span>
                <input
                  type="range"
                  min={0}
                  max={24}
                  step={1}
                  value={theme.borderRadius ?? DEFAULT_MERCHANT_THEME.borderRadius}
                  onChange={(e) => patch({ borderRadius: Number(e.target.value) })}
                />
              </label>

              <label>
                Espaçamento
                <span className="field-hint">Distância entre elementos no widget</span>
              </label>
              <div className="filter-tabs">
                {DENSITY_OPTIONS.map((opt) => (
                  <button
                    type="button"
                    key={opt.value}
                    className={`filter-tab${theme.density === opt.value ? " active" : ""}`}
                    onClick={() => patch({ density: opt.value })}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

          </div>

          {/* ── Preview ── */}
          <div className="split-panel-preview">
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 16px", background: "var(--bg)", borderRadius: "14px 14px 0 0", borderBottom: "1px solid var(--border)" }}>
              <div style={{ display: "flex", gap: 5 }}>
                {["oklch(60% 0.2 25)", "oklch(76% 0.15 80)", "oklch(70% 0.17 149)"].map(c => <span key={c} style={{ width: 8, height: 8, borderRadius: "50%", background: c }} />)}
              </div>
              <div style={{ flex: 1, textAlign: "center", font: "11px var(--mono)", color: "var(--faint)" }}>
                Preview — {props.me?.name || "Widget"}
              </div>
            </div>
            <div style={{ overflow: "hidden", height: 600 }}>
              <LivePreviewPanel
                ref={previewRef}
                apiBaseUrl={props.apiBaseUrl}
                me={props.me}
                hideControls
              />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
