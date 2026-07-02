import React, { useEffect, useMemo, useRef, useState } from "react";
import { Palette, RotateCcw, Save, X } from "lucide-react";
import { DEFAULT_MERCHANT_THEME, type MerchantTheme } from "@zyon/shared-types";
import { createDashboardApi, DashboardHttpError, type MerchantProfile } from "../api-client.js";
import { LivePreviewPanel, type LivePreviewPanelRef } from "../components/LivePreviewPanel.js";

// ── Exported Constants & Helpers (testable) ──────────────────────────────────

export const LABELS = {
  loginRequired: "Login necessário.",
  tenantSubtitle: "Checkout configurável por tenant.",
  headerTitle: "Título do header",
  headerSubtitle: "Subtítulo do header",
  badges: "Badges de confiança",
  fontUi: "Fonte da interface",
  fontDisplay: "Fonte de destaque",
  borderRadius: "Raio da borda",
  assetsLayout: "Recursos e layout",
  reset: "Resetar",
  saveSuccess: "Tema salvo com sucesso.",
  resetConfirm: "Resetar para padrão? Alterações não salvas serão perdidas.",
  urlInvalid: "URL inválida — use https://...",
  unsavedChanges: "Alterações não salvas",
  badgesMax: "máximo 4",
  addBadge: "Adicionar",
} as const;

export const COLOR_FIELDS: Array<{ key: keyof MerchantTheme; label: string }> = [
  { key: "accentColor", label: "Cor de destaque" },
  { key: "secondaryColor", label: "Cor secundária" },
  { key: "textColor", label: "Texto" },
  { key: "mutedTextColor", label: "Texto secundário" },
  { key: "backgroundColor", label: "Fundo" },
  { key: "surfaceColor", label: "Superfície" },
  { key: "surfaceElevatedColor", label: "Superfície elevada" },
  { key: "borderColor", label: "Borda" },
  { key: "successColor", label: "Sucesso" },
  { key: "warningColor", label: "Aviso" },
];

export const DENSITY_OPTIONS: Array<{ value: NonNullable<MerchantTheme["density"]>; label: string }> = [
  { value: "compact", label: "Compacto" },
  { value: "comfortable", label: "Confortável" },
  { value: "spacious", label: "Espaçoso" },
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
  "Manrope, Inter, ui-sans-serif, system-ui, sans-serif",
  "Plus Jakarta Sans, Inter, ui-sans-serif, system-ui, sans-serif",
  "DM Sans, Inter, ui-sans-serif, system-ui, sans-serif",
  "Sora, Inter, ui-sans-serif, system-ui, sans-serif",
  "Outfit, Inter, ui-sans-serif, system-ui, sans-serif",
  "Montserrat, Inter, ui-sans-serif, system-ui, sans-serif",
];

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
      const saved = mergeTheme(await api.putMerchantTheme(normalizedTheme()));
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
            <h1>Tema</h1>
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
          <span className="eyebrow">Plataforma</span>
          <h1>Tema enterprise</h1>
          <p className="page-lead">
            {props.me.name ?? props.me.id}
            <span className="badge" style={{ marginLeft: 8 }}>tenant</span>
            {dirty ? (
              <span className="badge warn" style={{ marginLeft: 8 }} aria-label={LABELS.unsavedChanges}>
                não salvo
              </span>
            ) : null}
            {" "}— {LABELS.tenantSubtitle}
          </p>
        </div>
        <div className="button-row">
          <button type="button" onClick={reset} disabled={busy}>
            <RotateCcw size={15} />
            {LABELS.reset}
          </button>
          <button type="button" className="primary-action" onClick={() => void save()} disabled={busy}>
            <Save size={15} />
            Salvar tema
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

            {/* 1 — Identidade */}
            <section className="panel stacked">
              <div className="panel-title">
                <h2>Identidade</h2>
                <Palette size={15} />
              </div>

              <div className="form-grid">
                <label>
                  {LABELS.fontUi}
                  <select value={theme.fontFamily} onChange={(e) => patch({ fontFamily: e.target.value })}>
                    {FONT_OPTIONS.map((font) => (
                      <option key={font} value={font}>{font.split(",")[0]}</option>
                    ))}
                  </select>
                </label>

                <label>
                  {LABELS.fontDisplay}
                  <select
                    value={theme.fontDisplay ?? theme.fontFamily}
                    onChange={(e) => patch({ fontDisplay: e.target.value })}
                  >
                    {FONT_OPTIONS.map((font) => (
                      <option key={font} value={font}>{font.split(",")[0]}</option>
                    ))}
                  </select>
                </label>

                <label>
                  {LABELS.headerTitle}
                  <input
                    value={theme.headerTitle ?? ""}
                    onChange={(e) => patch({ headerTitle: e.target.value })}
                    placeholder="Nome que aparece no header do widget"
                  />
                </label>

                <label>
                  {LABELS.headerSubtitle}
                  <input
                    value={theme.headerSubtitle ?? ""}
                    onChange={(e) => patch({ headerSubtitle: e.target.value })}
                    placeholder="Subtítulo do header"
                  />
                </label>

                <label>
                  Nome do agente
                  <input
                    value={theme.agentName ?? ""}
                    onChange={(e) => patch({ agentName: e.target.value })}
                    placeholder="Nome do agente AI"
                  />
                </label>
              </div>

              {/* Badges chip UX */}
              <div className="form-grid" style={{ marginTop: "var(--space-4)" }}>
                <label>{LABELS.badges} ({LABELS.badgesMax})</label>
                <div className="chip-list">
                  {parseBadges(badgesText).map((badge, i) => (
                    <span key={`${badge}-${i}`} className="chip">
                      {badge}
                      <button
                        type="button"
                        className="chip-remove"
                        onClick={() => removeBadge(i)}
                        aria-label={`Remover badge ${badge}`}
                      >
                        <X size={12} />
                      </button>
                    </span>
                  ))}
                </div>
                <div className="badge-input-row">
                  <input
                    value={badgeInput}
                    onChange={(e) => setBadgeInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addBadge(); } }}
                    placeholder="Novo badge..."
                    disabled={!canAddBadge(badgesText)}
                  />
                  <button
                    type="button"
                    onClick={addBadge}
                    disabled={!badgeInput.trim() || !canAddBadge(badgesText)}
                  >
                    {LABELS.addBadge}
                  </button>
                </div>
                <span className="field-hint">{parseBadges(badgesText).length} de 4</span>
              </div>
            </section>

            {/* 2 — Cores */}
            <section className="panel stacked">
              <div className="panel-title">
                <h2>Cores</h2>
                <span className="badge">{COLOR_FIELDS.length} tokens</span>
              </div>

              <div className="theme-color-grid">
                {COLOR_FIELDS.map((field) => (
                  <label key={String(field.key)} className="swatch-field">
                    <span>{field.label}</span>
                    <input
                      type="color"
                      aria-label={`Cor: ${field.label}`}
                      value={String(theme[field.key] ?? "#000000")}
                      onChange={(e) => patch({ [field.key]: e.target.value } as Partial<MerchantTheme>)}
                    />
                    <code>{String(theme[field.key] ?? "")}</code>
                  </label>
                ))}
              </div>
            </section>

            {/* 3 — Recursos e layout */}
            <section className="panel stacked">
              <div className="panel-title">
                <h2>{LABELS.assetsLayout}</h2>
              </div>

              <div className="form-grid">
                <label>
                  Logo URL
                  <input
                    value={theme.logoUrl ?? ""}
                    onChange={(e) => patch({ logoUrl: e.target.value })}
                    placeholder="https://..."
                  />
                  {!isValidUrl(theme.logoUrl ?? "") && (
                    <span className="field-error" role="alert">{LABELS.urlInvalid}</span>
                  )}
                </label>

                <label>
                  Avatar URL
                  <input
                    value={theme.agentAvatarUrl ?? ""}
                    onChange={(e) => patch({ agentAvatarUrl: e.target.value })}
                    placeholder="https://..."
                  />
                  {!isValidUrl(theme.agentAvatarUrl ?? "") && (
                    <span className="field-error" role="alert">{LABELS.urlInvalid}</span>
                  )}
                </label>

                <label>
                  Background image URL
                  <input
                    value={theme.backgroundImageUrl ?? ""}
                    onChange={(e) => patch({ backgroundImageUrl: e.target.value })}
                    placeholder="https://..."
                  />
                  {!isValidUrl(theme.backgroundImageUrl ?? "") && (
                    <span className="field-error" role="alert">{LABELS.urlInvalid}</span>
                  )}
                </label>
              </div>

              <div className="slider-row">
                <label>{LABELS.borderRadius}</label>
                <input
                  type="range"
                  min={0}
                  max={24}
                  step={1}
                  value={theme.borderRadius ?? DEFAULT_MERCHANT_THEME.borderRadius}
                  onChange={(e) => patch({ borderRadius: Number(e.target.value) })}
                />
                <output>{theme.borderRadius ?? DEFAULT_MERCHANT_THEME.borderRadius}px</output>
              </div>

              <div>
                <p style={{ marginBottom: 8, fontWeight: 600, color: "var(--color-text-secondary)", fontSize: 13 }}>
                  Densidade
                </p>
                <div className="segmented-control" role="group" aria-label="Densidade">
                  {DENSITY_OPTIONS.map((opt) => (
                    <button
                      type="button"
                      key={opt.value}
                      className={theme.density === opt.value ? "active" : ""}
                      onClick={() => patch({ density: opt.value })}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
            </section>

          </div>

          {/* ── preview column ── */}
          <div className="split-panel-preview">
            <LivePreviewPanel
              ref={previewRef}
              apiBaseUrl={props.apiBaseUrl}
              me={props.me}
            />
          </div>
        </div>
      )}
    </>
  );
}
