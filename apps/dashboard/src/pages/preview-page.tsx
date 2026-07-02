import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Eye, Maximize2, Minimize2, Monitor, Smartphone, Tablet, RefreshCw } from "lucide-react";
import { createDashboardApi, type MerchantProfile, type MerchantTheme } from "../api-client.js";
import { LivePreviewPanel, type LivePreviewPanelRef } from "../components/LivePreviewPanel.js";

type Presentation = "floating" | "conversational";
type DeviceSize = keyof typeof DEVICE_SIZES;

export const DEVICE_SIZES = {
  desktop: { width: "100%", label: "Desktop" },
  tablet: { width: "768px", label: "Tablet" },
  mobile: { width: "375px", label: "Mobile" },
} as const;

const PREVIEW_SCOPES = ["checkout:start", "checkout:chat", "checkout:track", "offers:apply", "coupons:apply"];

export function useCountdown(expiresAtUnix: number | null): string | null {
  if (expiresAtUnix === null) return null;
  const secs = Math.max(0, expiresAtUnix - Math.floor(Date.now() / 1000));
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function useAutoRenewal(expiresAtUnix: number | null, reload: () => void): () => void {
  if (expiresAtUnix === null) return () => {};
  const renewAtMs = (expiresAtUnix - 60) * 1000;
  const now = Date.now();
  const delay = renewAtMs - now;
  if (delay <= 0) {
    reload();
    return () => {};
  }
  const timer = setTimeout(reload, delay);
  return () => clearTimeout(timer);
}

export function CheckoutPreviewPage(props: { apiBaseUrl: string; me: MerchantProfile }) {
  const api = useMemo(() => createDashboardApi({ baseUrl: props.apiBaseUrl }), [props.apiBaseUrl]);
  const previewRef = useRef<LivePreviewPanelRef>(null);

  const [presentation, setPresentation] = useState<Presentation>("floating");
  const [device, setDevice] = useState<DeviceSize>("desktop");
  const [tokenExpiresAt, setTokenExpiresAt] = useState<number | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [theme, setTheme] = useState<MerchantTheme | null>(null);
  const [themeError, setThemeError] = useState<string | null>(null);
  const [countdown, setCountdown] = useState<string | null>(null);

  const handleTokenIssued = useCallback((expiresAtUnix: number) => {
    setTokenExpiresAt(expiresAtUnix);
  }, []);

  // Countdown ticker
  useEffect(() => {
    if (!tokenExpiresAt) {
      setCountdown(null);
      return;
    }
    const tick = () => {
      const secs = Math.max(0, tokenExpiresAt - Math.floor(Date.now() / 1000));
      const m = Math.floor(secs / 60);
      const s = secs % 60;
      setCountdown(`${m}:${String(s).padStart(2, "0")}`);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [tokenExpiresAt]);

  // Auto-renewal at T-60s
  useEffect(() => {
    if (!tokenExpiresAt) return;
    const renewAtMs = (tokenExpiresAt - 60) * 1000;
    const now = Date.now();
    const delay = renewAtMs - now;
    if (delay <= 0) {
      previewRef.current?.reload();
      return;
    }
    const timer = setTimeout(() => previewRef.current?.reload(), delay);
    return () => clearTimeout(timer);
  }, [tokenExpiresAt]);

  // Theme fetch
  useEffect(() => {
    api.getMerchantTheme()
      .then(setTheme)
      .catch(() => setThemeError("Não foi possível carregar tema"));
  }, [api]);

  const reloadTheme = useCallback(() => {
    setThemeError(null);
    api.getMerchantTheme()
      .then((t) => {
        setTheme(t);
        previewRef.current?.postThemeUpdate(t);
      })
      .catch(() => setThemeError("Não foi possível carregar tema"));
  }, [api]);

  // Fullscreen escape key
  useEffect(() => {
    if (!isFullscreen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setIsFullscreen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [isFullscreen]);

  const tokenStatus = tokenExpiresAt
    ? (countdown === "0:00" ? "expired" : "active")
    : "issuing";

  const statusText = tokenStatus === "active"
    ? "Sessão ativa"
    : tokenStatus === "expired"
      ? "Sessão expirada"
      : "Iniciando sessão...";

  const statusDotClass = tokenStatus === "active"
    ? "green"
    : tokenStatus === "expired"
      ? "red"
      : "amber";

  if (isFullscreen) {
    return (
      <div className="preview-fullscreen">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "var(--space-4)" }}>
          <h2 style={{ fontSize: 15 }}>Preview em tela cheia</h2>
          <button
            type="button"
            onClick={() => setIsFullscreen(false)}
            aria-expanded={true}
            aria-label="Sair da tela cheia"
          >
            <Minimize2 size={14} /> Sair da tela cheia
          </button>
        </div>
        <div className="preview-stage" style={{ flex: 1 }}>
          <LivePreviewPanel
            ref={previewRef}
            apiBaseUrl={props.apiBaseUrl}
            me={props.me}
            presentation={presentation}
            hideControls
            onTokenIssued={handleTokenIssued}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="dashboard-content">
      <header className="page-head">
        <div>
          <span className="eyebrow">Preview</span>
          <h1>Visualize o checkout</h1>
          <p className="page-lead">Veja como o widget aparece para o comprador em tempo real.</p>
        </div>
        <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
          <button type="button" onClick={() => previewRef.current?.reload()} style={{ minHeight: 36 }}>
            <RefreshCw size={13} /> Reiniciar
          </button>
          <button type="button" onClick={() => setIsFullscreen(true)} style={{ minHeight: 36 }}>
            <Maximize2 size={13} /> Tela cheia
          </button>
        </div>
      </header>

      {/* ── Compact control strip ── */}
      <div className="panel" style={{ padding: 'var(--space-4) var(--space-5)', marginBottom: 'var(--space-4)', display: 'flex', alignItems: 'center', gap: 'var(--space-6)', flexWrap: 'wrap' }}>
        {/* Status */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
          <span className={`status-dot ${statusDotClass}`} />
          <span style={{ fontSize: 12, fontWeight: 600 }}>{statusText}</span>
          {countdown && tokenStatus === "active" && <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>{countdown}</span>}
        </div>

        {/* Mode */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
          <span style={{ fontSize: 11, color: 'var(--color-text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', display: 'inline-flex', alignItems: 'center', gap: 4 }}><Eye size={11} /> Modo</span>
          <div className="filter-tabs">
            <button type="button" className={`filter-tab${presentation === 'floating' ? ' active' : ''}`} onClick={() => setPresentation('floating')}>Flutuante</button>
            <button type="button" className={`filter-tab${presentation === 'conversational' ? ' active' : ''}`} onClick={() => setPresentation('conversational')}>Tela cheia</button>
          </div>
        </div>

        {/* Device */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
          <span style={{ fontSize: 11, color: 'var(--color-text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', display: 'inline-flex', alignItems: 'center', gap: 4 }}><Monitor size={11} /> Tela</span>
          <div className="filter-tabs">
            {(Object.keys(DEVICE_SIZES) as DeviceSize[]).map((size) => (
              <button key={size} type="button" className={`filter-tab${device === size ? ' active' : ''}`} onClick={() => setDevice(size)}>
                {DEVICE_SIZES[size].label}
              </button>
            ))}
          </div>
        </div>

        {/* Theme indicator */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginLeft: 'auto' }}>
          {theme && <span style={{ width: 14, height: 14, borderRadius: 4, background: theme.accentColor ?? 'var(--color-brand)', border: '1px solid var(--color-border)' }} />}
          <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>Edite na aba Tema</span>
        </div>
      </div>

      {/* ── Preview Stage ── */}
      <div style={{ background: "#0f172a", borderRadius: "var(--radius-lg)", padding: presentation === 'conversational' ? 'var(--space-2)' : 'var(--space-4)', display: "flex", flexDirection: "column", alignItems: "center" }}>
        {/* Browser chrome */}
        <div style={{ width: device === 'desktop' ? '100%' : DEVICE_SIZES[device].width, maxWidth: '100%', margin: '0 auto', transition: 'width 0.3s ease' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 16px', background: '#1e293b', borderRadius: '12px 12px 0 0' }}>
            <div style={{ display: 'flex', gap: 6 }}>
              {['#ef4444','#f59e0b','#22c55e'].map(c => <span key={c} style={{ width: 10, height: 10, borderRadius: '50%', background: c }} />)}
            </div>
            <div style={{ flex: 1, textAlign: 'center', fontSize: 11, color: '#94a3b8', fontFamily: 'var(--font-mono)' }}>
              {props.me.name || 'Preview'} — {DEVICE_SIZES[device].label} · {presentation === 'floating' ? 'Flutuante' : 'Fullscreen'}
            </div>
          </div>

          {/* Widget iframe container */}
          <div style={{ background: '#fff', borderRadius: '0 0 12px 12px', overflow: 'hidden', height: 'calc(100vh - 320px)', minHeight: 500 }}>
            <LivePreviewPanel
              ref={previewRef}
              apiBaseUrl={props.apiBaseUrl}
              me={props.me}
              presentation={presentation}
              hideControls
              width="100%"
              onTokenIssued={handleTokenIssued}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
