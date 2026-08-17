import React, { useEffect, useMemo, useState } from "react";
import { RotateCcw, Save, X, Type, Shield, Palette, Image, Layout } from "lucide-react";
import { DEFAULT_MERCHANT_THEME, type MerchantTheme } from "@zyon/shared-types";
import { createDashboardApi, DashboardHttpError, type MerchantProfile } from "../api-client.js";
import { CheckoutPreviewWidget } from "../components/CheckoutPreviewWidget.js";
import { ImageUploader } from "../components/ImageUploader.js";
import { showToast } from "../components/Toast.js";
import { Button } from "../components/Button.js";

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

export const DENSITY_OPTIONS: Array<{ value: NonNullable<MerchantTheme["density"]>; label: string; desc: string }> = [
  { value: "compact", label: "Estreito", desc: "Widget fino, ideal para sidebar" },
  { value: "comfortable", label: "Médio", desc: "Tamanho padrão equilibrado" },
  { value: "spacious", label: "Full", desc: "Ocupa toda largura disponível" },
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
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [initialTheme, setInitialTheme] = useState<MerchantTheme>(mergeTheme());
  const [initialBadges, setInitialBadges] = useState((DEFAULT_MERCHANT_THEME.trustBadges ?? []).join(", "));

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
      try {
        const next = mergeTheme(await api.getMerchantTheme());
        setTheme(next);
        const badges = (next.trustBadges ?? []).join(", ");
        setBadgesText(badges);
        setInitialTheme(next);
        setInitialBadges(badges);
      } catch (e) {
        const text = e instanceof DashboardHttpError ? e.responseBody.slice(0, 160) : e instanceof Error ? e.message : String(e);
        showToast("error", text);
      } finally {
        setBusy(false);
        setLoaded(true);
      }
    }
    void load();
  }, [api, props.me]);

  // Preview updates reactively via ThemeInlinePreview props

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
      showToast("success", LABELS.saveSuccess);
    } catch (e) {
      const text = e instanceof DashboardHttpError ? e.responseBody.slice(0, 180) : e instanceof Error ? e.message : String(e);
      showToast("error", text);
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
          <span className="eyebrow">CHECKOUT</span>
          <h1>Aparência do checkout</h1>
          <p className="page-lead">Adapte cores, fontes e imagens para combinar com sua marca.</p>
        </div>
        <div className="button-row">
          {dirty && <span className="badge warn">Alterações não salvas</span>}
          <Button variant="ghost" onClick={reset} disabled={busy}>
            <RotateCcw size={14} style={{ marginRight: 6 }} /> Resetar
          </Button>
          <Button variant="primary" arrow onClick={() => void save()} disabled={busy} loading={busy}>
            <Save size={14} style={{ marginRight: 6 }} /> Salvar
          </Button>
        </div>
      </header>

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
              <div className="section-header"><Type size={15} strokeWidth={1.75} style={{ color: "var(--accent)" }} /><h3>Identidade e tipografia</h3></div>

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
                  Tipografia primária
                  <select value={theme.fontFamily} onChange={(e) => patch({ fontFamily: e.target.value })}>
                    {FONT_OPTIONS.map((font) => (
                      <option key={font} value={font}>{font.split(",")[0]}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Tipografia secundária
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

            </div>

            {/* Panel — Selos de confiança */}
            <div className="panel stacked">
              <div className="section-header"><Shield size={15} strokeWidth={1.75} style={{ color: "var(--accent)" }} /><h3>Selos de confiança</h3></div>
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
                <Button variant="outline" onClick={addBadge} disabled={!badgeInput.trim() || !canAddBadge(badgesText)}>
                  Adicionar selo
                </Button>
              </div>
              <span className="field-hint">{parseBadges(badgesText).length}/4 selos</span>
            </div>

            {/* Panel 2 — Cores */}
            <div className="panel stacked">
              <div className="section-header"><Palette size={15} strokeWidth={1.75} style={{ color: "var(--accent)" }} /><h3>Paleta de cores</h3></div>
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
              <div className="section-header"><Image size={15} strokeWidth={1.75} style={{ color: "var(--accent)" }} /><h3>Imagens</h3></div>

              <ImageUploader
                label="Logo da marca"
                hint="Exibida no topo do widget"
                value={theme.logoUrl}
                onChange={(url) => patch({ logoUrl: url })}
                height={100}
              />

              <ImageUploader
                label="Avatar do assistente"
                hint="Foto do agente na conversa"
                value={theme.agentAvatarUrl}
                onChange={(url) => patch({ agentAvatarUrl: url })}
                height={100}
              />

              <ImageUploader
                label="Imagem de fundo"
                hint="Background do painel principal"
                value={theme.backgroundImageUrl}
                onChange={(url) => patch({ backgroundImageUrl: url })}
                height={160}
              />
            </div>

            {/* Panel 4 — Layout */}
            <div className="panel stacked">
              <div className="section-header"><Layout size={15} strokeWidth={1.75} style={{ color: "var(--accent)" }} /><h3>Layout e espaçamento</h3></div>

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
                  style={{ accentColor: "var(--accent)" }}
                />
              </label>

              <label>
                Layout do widget
                <span className="field-hint">Largura do checkout na página</span>
              </label>
              <div className="filter-tabs">
                {DENSITY_OPTIONS.map((opt) => (
                  <button
                    type="button"
                    key={opt.value}
                    className={`filter-tab${theme.density === opt.value ? " active" : ""}`}
                    onClick={() => patch({ density: opt.value })}
                    title={opt.desc}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>

              <label>
                Modo de cor
                <span className="field-hint">Aparência geral do checkout</span>
              </label>
              <div className="filter-tabs">
                {([
                  { value: "dark", label: "Dark" },
                  { value: "grey", label: "Grey" },
                  { value: "light", label: "Light" },
                ] as const).map((opt) => (
                  <button
                    type="button"
                    key={opt.value}
                    className={`filter-tab${(theme.mode ?? "dark") === opt.value ? " active" : ""}`}
                    onClick={() => patch({ mode: opt.value })}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

          </div>

          {/* ── Preview ── */}
          <div className="split-panel-preview">
            <CheckoutPreviewWidget
              theme={{ ...theme, trustBadges: parseBadges(badgesText) }}
              merchantName={props.me?.name}
            />
          </div>
        </div>
      )}
    </>
  );
}

