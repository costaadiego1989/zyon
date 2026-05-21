import React, { useEffect, useMemo, useState } from "react";
import { Palette, RotateCcw, Save } from "lucide-react";
import { DEFAULT_MERCHANT_THEME, type MerchantTheme } from "@aacp/shared-types";
import { createDashboardApi, DashboardHttpError, type MerchantProfile } from "../api-client.js";

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
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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
        setMessage(e instanceof DashboardHttpError ? e.responseBody.slice(0, 160) : e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
      }
    }
    void load();
  }, [api, props.me]);

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
      setMessage("Tema salvo.");
    } catch (e) {
      setMessage(e instanceof DashboardHttpError ? e.responseBody.slice(0, 180) : e instanceof Error ? e.message : String(e));
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
        <h1>Tema</h1>
        <p className="page-lead">Login necessario.</p>
      </>
    );
  }

  const previewTheme = normalizedTheme();
  const previewHeaderTitle = previewTheme.headerTitle?.trim() || "Aurora";
  const previewHeaderSubtitle = previewTheme.headerSubtitle?.trim() || "Northstar Atelier · online · responde em segundos";
  const previewAgentName = previewTheme.agentName?.trim() || "Aurora";
  const previewBadges = previewTheme.trustBadges ?? [];
  const previewStyle = {
    "--preview-accent": previewTheme.accentColor,
    "--preview-bg": previewTheme.backgroundColor,
    "--preview-fg": previewTheme.textColor,
    "--preview-muted": previewTheme.mutedTextColor ?? DEFAULT_MERCHANT_THEME.mutedTextColor,
    "--preview-surface": previewTheme.surfaceColor ?? DEFAULT_MERCHANT_THEME.surfaceColor,
    "--preview-surface-strong": previewTheme.surfaceElevatedColor ?? DEFAULT_MERCHANT_THEME.surfaceElevatedColor,
    "--preview-border": previewTheme.borderColor ?? DEFAULT_MERCHANT_THEME.borderColor,
    "--preview-radius": `${previewTheme.borderRadius ?? DEFAULT_MERCHANT_THEME.borderRadius}px`,
    fontFamily: previewTheme.fontFamily,
    backgroundImage: previewTheme.backgroundImageUrl ? `linear-gradient(rgba(247,248,250,.88), rgba(247,248,250,.88)), url(${previewTheme.backgroundImageUrl})` : undefined
  } as React.CSSProperties;

  return (
    <>
      <header className="page-head">
        <div>
          <h1>Tema enterprise</h1>
          <p className="page-lead">{props.me.name ?? props.me.id} - checkout configuravel por tenant.</p>
        </div>
        <div className="button-row">
          <button type="button" onClick={reset} disabled={busy}>
            <RotateCcw size={16} />
            Reset
          </button>
          <button type="button" onClick={() => void save()} disabled={busy}>
            <Save size={16} />
            Salvar
          </button>
        </div>
      </header>

      {message ? <p className="panel panel-info">{message}</p> : null}

      <div className="ops-grid theme-workbench">
        <section className="panel stacked">
          <div className="panel-title">
            <h2>Identidade</h2>
            <Palette size={16} />
          </div>
          <div className="form-grid">
            <label>
              Fonte UI
              <select value={theme.fontFamily} onChange={(event) => patch({ fontFamily: event.target.value })}>
                {FONT_OPTIONS.map((font) => <option key={font} value={font}>{font.split(",")[0]}</option>)}
              </select>
            </label>
            <label>
              Fonte display
              <select value={theme.fontDisplay ?? theme.fontFamily} onChange={(event) => patch({ fontDisplay: event.target.value })}>
                {FONT_OPTIONS.map((font) => <option key={font} value={font}>{font.split(",")[0]}</option>)}
              </select>
            </label>
            <label>
              Titulo header
              <input value={theme.headerTitle ?? ""} onChange={(event) => patch({ headerTitle: event.target.value })} />
            </label>
            <label>
              Subtitulo header
              <input value={theme.headerSubtitle ?? ""} onChange={(event) => patch({ headerSubtitle: event.target.value })} />
            </label>
            <label>
              Nome do agente
              <input value={theme.agentName ?? ""} onChange={(event) => patch({ agentName: event.target.value })} />
            </label>
            <label>
              Badges de confianca
              <input value={badgesText} onChange={(event) => setBadgesText(event.target.value)} />
            </label>
          </div>
        </section>

        <section className="panel stacked">
          <h2>Cores e assets</h2>
          <div className="theme-color-grid">
            {COLOR_FIELDS.map((field) => (
              <label key={String(field.key)} className="swatch-field">
                <span>{field.label}</span>
                <input
                  type="color"
                  value={String(theme[field.key] ?? "#000000")}
                  onChange={(event) => patch({ [field.key]: event.target.value } as Partial<MerchantTheme>)}
                />
                <code>{String(theme[field.key] ?? "")}</code>
              </label>
            ))}
          </div>
          <div className="form-grid">
            <label>
              Logo URL
              <input value={theme.logoUrl ?? ""} onChange={(event) => patch({ logoUrl: event.target.value })} placeholder="https://cdn.example/logo.png" />
            </label>
            <label>
              Avatar URL
              <input value={theme.agentAvatarUrl ?? ""} onChange={(event) => patch({ agentAvatarUrl: event.target.value })} placeholder="https://cdn.example/avatar.png" />
            </label>
            <label>
              Background image URL
              <input value={theme.backgroundImageUrl ?? ""} onChange={(event) => patch({ backgroundImageUrl: event.target.value })} placeholder="https://cdn.example/bg.jpg" />
            </label>
            <label>
              Raio
              <input type="number" min={4} max={24} value={theme.borderRadius ?? 8} onChange={(event) => patch({ borderRadius: Number(event.target.value) })} />
            </label>
          </div>
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
        </section>

        <section className="panel theme-preview-panel">
          <div className="theme-preview" style={previewStyle}>
            <div className="theme-preview-card">
              <div className="theme-preview-head">
                <div className="theme-preview-avatar">
                  {previewTheme.agentAvatarUrl ? <img src={previewTheme.agentAvatarUrl} alt="" /> : <span>A</span>}
                </div>
                <div>
                  <strong>{previewHeaderTitle}</strong>
                  <small>{previewHeaderSubtitle}</small>
                </div>
              </div>
              <div className="theme-preview-bubble">
                Ola, sou {previewAgentName}. Seu pedido esta quase pronto.
              </div>
              <div className="theme-preview-actions">
                <button type="button">Finalizar</button>
                <span>PIX aprovado em tempo real</span>
              </div>
              <div className="theme-preview-badges">
                {previewBadges.map((badge) => <span key={badge}>{badge}</span>)}
              </div>
            </div>
          </div>
        </section>
      </div>
    </>
  );
}
