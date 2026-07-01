import React, { useEffect, useMemo, useRef, useState } from "react";
import { Palette, RotateCcw, Save } from "lucide-react";
import { DEFAULT_MERCHANT_THEME, type MerchantTheme } from "@zyon/shared-types";
import { createDashboardApi, DashboardHttpError, type MerchantProfile } from "../api-client.js";
import { LivePreviewPanel, type LivePreviewPanelRef } from "../components/LivePreviewPanel.js";

const FONT_OPTIONS = [
  "Inter, ui-sans-serif, system-ui, sans-serif",
  "Manrope, Inter, ui-sans-serif, system-ui, sans-serif",
  "Plus Jakarta Sans, Inter, ui-sans-serif, system-ui, sans-serif",
  "DM Sans, Inter, ui-sans-serif, system-ui, sans-serif",
  "Sora, Inter, ui-sans-serif, system-ui, sans-serif",
  "Outfit, Inter, ui-sans-serif, system-ui, sans-serif",
  "Montserrat, Inter, ui-sans-serif, system-ui, sans-serif"
];

const COLOR_FIELDS: Array<{ key: keyof MerchantTheme; label: string }> = [
  { key: "accentColor", label: "Accent" },
  { key: "textColor", label: "Texto" },
  { key: "mutedTextColor", label: "Texto secundario" },
  { key: "backgroundColor", label: "Background" },
  { key: "surfaceColor", label: "Surface" },
  { key: "surfaceElevatedColor", label: "Surface elevada" },
  { key: "borderColor", label: "Borda" },
  { key: "successColor", label: "Sucesso" },
  { key: "warningColor", label: "Aviso" }
];

function mergeTheme(theme?: Partial<MerchantTheme> | null): MerchantTheme {
  return {
    ...DEFAULT_MERCHANT_THEME,
    ...(theme ?? {})
  };
}

export function ThemePage(props: { apiBaseUrl: string; me: MerchantProfile | null }) {
  const api = useMemo(() => createDashboardApi({ baseUrl: props.apiBaseUrl }), [props.apiBaseUrl]);
  const [theme, setTheme] = useState<MerchantTheme>(mergeTheme());
  const [badgesText, setBadgesText] = useState((DEFAULT_MERCHANT_THEME.trustBadges ?? []).join(", "));
  const [message, setMessage] = useState<{ text: string; kind: "info" | "error" } | null>(null);
  const [busy, setBusy] = useState(false);
  const previewRef = useRef<LivePreviewPanelRef>(null);

  useEffect(() => {
    async function load() {
      if (!props.me) {
        setTheme(mergeTheme());
        return;
      }
      setBusy(true);
      setMessage(null);
      try {
        const next = mergeTheme(await api.getMerchantTheme());
        setTheme(next);
        setBadgesText((next.trustBadges ?? []).join(", "));
      } catch (e) {
        setMessage({
          text: e instanceof DashboardHttpError ? e.responseBody.slice(0, 160) : e instanceof Error ? e.message : String(e),
          kind: "error"
        });
      } finally {
        setBusy(false);
      }
    }
    void load();
  }, [api, props.me]);

  useEffect(() => {
    previewRef.current?.postThemeUpdate(normalizedTheme());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [theme, badgesText]);

  function patch(patchValue: Partial<MerchantTheme>) {
    setTheme((current) => ({ ...current, ...patchValue }));
  }

  function normalizedTheme(): MerchantTheme {
    return {
      ...theme,
      trustBadges: badgesText
        .split(",")
        .map((badge) => badge.trim())
        .filter(Boolean)
        .slice(0, 4)
    };
  }

  async function save() {
    setBusy(true);
    setMessage(null);
    try {
      const saved = mergeTheme(await api.putMerchantTheme(normalizedTheme()));
      setTheme(saved);
      setBadgesText((saved.trustBadges ?? []).join(", "));
      setMessage({ text: "Tema salvo.", kind: "info" });
    } catch (e) {
      setMessage({
        text: e instanceof DashboardHttpError ? e.responseBody.slice(0, 180) : e instanceof Error ? e.message : String(e),
        kind: "error"
      });
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    const next = mergeTheme();
    setTheme(next);
    setBadgesText((next.trustBadges ?? []).join(", "));
  }

  if (!props.me) {
    return (
      <>
        <header className="page-head">
          <div>
            <h1>Tema</h1>
            <p className="page-lead">Login necessario.</p>
          </div>
        </header>
      </>
    );
  }

  return (
    <>
      <header className="page-head">
        <div>
          <h1>Tema enterprise</h1>
          <p className="page-lead">
            {props.me.name ?? props.me.id}
            <span className="badge" style={{ marginLeft: 8 }}>tenant</span>
            {" "}— checkout configuravel por tenant.
          </p>
        </div>
        <div className="button-row">
          <button type="button" onClick={reset} disabled={busy}>
            <RotateCcw size={15} />
            Reset
          </button>
          <button type="button" className="primary-action" onClick={() => void save()} disabled={busy}>
            <Save size={15} />
            Salvar tema
          </button>
        </div>
      </header>

      {message ? (
        <p className={`panel ${message.kind === "error" ? "panel-error" : "panel-info"}`}>
          {message.text}
        </p>
      ) : null}

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
                Fonte UI
                <select value={theme.fontFamily} onChange={(e) => patch({ fontFamily: e.target.value })}>
                  {FONT_OPTIONS.map((font) => (
                    <option key={font} value={font}>{font.split(",")[0]}</option>
                  ))}
                </select>
              </label>

              <label>
                Fonte display
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
                Titulo header
                <input
                  value={theme.headerTitle ?? ""}
                  onChange={(e) => patch({ headerTitle: e.target.value })}
                  placeholder="Nome que aparece no header do widget"
                />
              </label>

              <label>
                Subtitulo header
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

              <label>
                Badges de confianca
                <input value={badgesText} onChange={(e) => setBadgesText(e.target.value)} />
              </label>
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
                    value={String(theme[field.key] ?? "#000000")}
                    onChange={(e) => patch({ [field.key]: e.target.value } as Partial<MerchantTheme>)}
                  />
                  <code>{String(theme[field.key] ?? "")}</code>
                </label>
              ))}
            </div>
          </section>

          {/* 3 — Assets e layout */}
          <section className="panel stacked">
            <div className="panel-title">
              <h2>Assets e layout</h2>
            </div>

            <div className="form-grid">
              <label>
                Logo URL
                <input
                  value={theme.logoUrl ?? ""}
                  onChange={(e) => patch({ logoUrl: e.target.value })}
                  placeholder="https://..."
                />
              </label>

              <label>
                Avatar URL
                <input
                  value={theme.agentAvatarUrl ?? ""}
                  onChange={(e) => patch({ agentAvatarUrl: e.target.value })}
                  placeholder="https://..."
                />
              </label>

              <label>
                Background image URL
                <input
                  value={theme.backgroundImageUrl ?? ""}
                  onChange={(e) => patch({ backgroundImageUrl: e.target.value })}
                  placeholder="https://..."
                />
              </label>
            </div>

            <div className="slider-row">
              <label>Raio de borda</label>
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
                {(["compact", "comfortable", "spacious"] as const).map((density) => (
                  <button
                    type="button"
                    key={density}
                    className={theme.density === density ? "active" : ""}
                    onClick={() => patch({ density })}
                  >
                    {density}
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
    </>
  );
}
