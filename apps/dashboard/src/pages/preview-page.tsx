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
      <header style={{ marginBottom: "var(--space-6)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)" }}>
          <div className="page-icon"><Eye size={18} /></div>
          <div>
            <h1>Visualize como seus clientes verão o checkout</h1>
            <p className="page-lead">Simule a experiência de compra em diferentes dispositivos e modos de apresentação.</p>
          </div>
        </div>
      </header>

      <div className="split-panel preview-split-panel" style={{ gap: "var(--space-5)" }}>
        {/* Left — Controls Sidebar */}
        <div className="split-panel-controls">
          {/* Token Status Card */}
          <section className="panel stacked">
            <h2 style={{ fontSize: 13, color: "var(--color-text-secondary)", marginBottom: "var(--space-2)" }}>
              Sessão de preview
            </h2>
            <div
              aria-live="polite"
              aria-atomic="true"
              style={{
                padding: "var(--space-3)",
                borderRadius: "var(--radius-sm)",
                background: tokenStatus === "active" ? "var(--color-success-bg)"
                  : tokenStatus === "expired" ? "var(--color-error-bg)" : "var(--color-bg)",
                border: `1px solid ${tokenStatus === "active" ? "var(--color-success-border)"
                  : tokenStatus === "expired" ? "var(--color-error-border)" : "var(--color-border)"}`,
                display: "flex",
                alignItems: "center",
                gap: "var(--space-2)"
              }}
            >
              <span className={`status-dot ${statusDotClass}`} aria-hidden="true" />
              <span style={{ fontSize: 12, fontWeight: 600 }}>{statusText}</span>
              {countdown && tokenStatus === "active" && (
                <span
                  className="preview-countdown"
                  aria-label={`Expira em ${countdown}`}
                  style={{ marginLeft: "auto", color: "var(--color-success)" }}
                >
                  {countdown}
                </span>
              )}
            </div>
          </section>

          {/* Presentation Mode Selector */}
          <section className="panel stacked">
            <h2 style={{ fontSize: 13, color: "var(--color-text-secondary)", marginBottom: "var(--space-2)" }}>
              Modo de apresentação
            </h2>
            <p style={{ fontSize: 11, color: "var(--color-text-muted)", margin: "0 0 var(--space-2)" }}>
              Como o widget aparece para o comprador
            </p>
            <div role="radiogroup" aria-label="Modo de apresentação" style={{ display: "grid", gap: "var(--space-2)" }}>
              {(["floating", "conversational"] as Presentation[]).map((mode) => {
                const active = presentation === mode;
                return (
                  <button
                    key={mode}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => setPresentation(mode)}
                    style={{
                      justifyContent: "flex-start",
                      gap: "var(--space-3)",
                      padding: "var(--space-3)",
                      minHeight: 44,
                      borderRadius: "var(--radius-sm)",
                      background: active ? "var(--color-brand-subtle)" : "var(--color-surface-raised)",
                      borderColor: active ? "var(--color-brand)" : "var(--color-border)",
                      color: active ? "var(--color-brand)" : "var(--color-text-secondary)",
                      fontWeight: active ? 700 : 500,
                      transition: "all var(--duration-fast) var(--ease)"
                    }}
                  >
                    <div style={{ textAlign: "left" }}>
                      <span style={{ display: "block", fontSize: 13 }}>
                        {mode === "floating" ? "Flutuante" : "Tela cheia"}
                      </span>
                      <span style={{ display: "block", fontSize: 11, fontWeight: 400, color: "var(--color-text-muted)", marginTop: 1 }}>
                        {mode === "floating"
                          ? "Botão no canto da tela com chat expansível"
                          : "Experiência de conversa em tela inteira"}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          </section>

          {/* Device Viewport Selector */}
          <section className="panel stacked">
            <h2 style={{ fontSize: 13, color: "var(--color-text-secondary)", marginBottom: "var(--space-2)" }}>
              Dispositivo
            </h2>
            <p style={{ fontSize: 11, color: "var(--color-text-muted)", margin: "0 0 var(--space-2)" }}>
              Simule a largura de tela dos seus compradores
            </p>
            <div role="radiogroup" aria-label="Tamanho de dispositivo" style={{ display: "flex", gap: "var(--space-2)" }}>
              {(Object.keys(DEVICE_SIZES) as DeviceSize[]).map((size) => {
                const active = device === size;
                const IconComponent = size === "desktop" ? Monitor : size === "tablet" ? Tablet : Smartphone;
                return (
                  <button
                    key={size}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => setDevice(size)}
                    style={{
                      flex: 1,
                      justifyContent: "center",
                      flexDirection: "column",
                      alignItems: "center",
                      gap: "var(--space-1)",
                      padding: "var(--space-3)",
                      minHeight: 52,
                      borderRadius: "var(--radius-sm)",
                      background: active ? "var(--color-brand-subtle)" : "var(--color-surface-raised)",
                      borderColor: active ? "var(--color-brand)" : "var(--color-border)",
                      color: active ? "var(--color-brand)" : "var(--color-text-muted)",
                      fontWeight: active ? 700 : 500,
                      transition: "all var(--duration-fast) var(--ease)"
                    }}
                  >
                    <IconComponent size={16} />
                    <span style={{ fontSize: 11 }}>{DEVICE_SIZES[size].label}</span>
                  </button>
                );
              })}
            </div>
          </section>

          {/* Scopes Info Card */}
          <section className="panel stacked">
            <h2 style={{ fontSize: 13, color: "var(--color-text-secondary)", marginBottom: "var(--space-2)" }}>
              Permissões ativas
            </h2>
            <div style={{ display: "grid", gap: "var(--space-1)" }}>
              {PREVIEW_SCOPES.map((scope) => (
                <div key={scope} style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
                  <span className="status-dot green" style={{ flexShrink: 0 }} />
                  <code style={{ fontSize: 11, fontFamily: "var(--font-mono)", color: "var(--color-text-muted)" }}>
                    {scope}
                  </code>
                </div>
              ))}
              <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", marginTop: "var(--space-1)" }}>
                <span className="status-dot" style={{ background: "var(--color-border-strong)", flexShrink: 0 }} />
                <code style={{ fontSize: 11, fontFamily: "var(--font-mono)", color: "var(--color-text-faint)", textDecoration: "line-through" }}>
                  payment:intents:create
                </code>
              </div>
            </div>
          </section>

          {/* Theme Applied Card */}
          <section className="panel stacked">
            <h2 style={{ fontSize: 13, color: "var(--color-text-secondary)", marginBottom: "var(--space-2)" }}>
              Tema atual
            </h2>
            {themeError ? (
              <p style={{ fontSize: 12, color: "var(--color-error)", margin: 0 }}>{themeError}</p>
            ) : theme ? (
              <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
                <span
                  style={{
                    width: 16,
                    height: 16,
                    borderRadius: "var(--radius-sm)",
                    background: theme.accentColor ?? "var(--color-brand)",
                    border: "1px solid var(--color-border)",
                    flexShrink: 0
                  }}
                />
                <span style={{ fontSize: 12, color: "var(--color-text-muted)", fontFamily: "var(--font-mono)" }}>
                  {theme.accentColor ?? "padrão"}
                </span>
              </div>
            ) : (
              <p style={{ fontSize: 12, color: "var(--color-text-faint)", margin: 0 }}>Carregando...</p>
            )}
            <button
              type="button"
              onClick={reloadTheme}
              style={{ marginTop: "var(--space-2)", width: "100%", justifyContent: "center" }}
            >
              <RefreshCw size={13} /> Atualizar tema
            </button>
          </section>

          {/* Action Buttons */}
          <button
            type="button"
            onClick={() => previewRef.current?.reload()}
            style={{ width: "100%", justifyContent: "center", minHeight: 40 }}
          >
            <RefreshCw size={14} /> Reiniciar sessão
          </button>

          <button
            type="button"
            onClick={() => setIsFullscreen(true)}
            aria-expanded={isFullscreen}
            aria-label="Tela cheia"
            style={{ width: "100%", justifyContent: "center", minHeight: 40 }}
          >
            <Maximize2 size={14} /> Tela cheia
          </button>
        </div>

        {/* Right — Preview Stage */}
        <div className="split-panel-preview" style={{ minWidth: 0 }}>
          <div
            className="preview-device-frame"
            style={{ "--preview-device-width": DEVICE_SIZES[device].width } as React.CSSProperties}
          >
            <div className="preview-stage" style={{ margin: 0, borderRadius: "var(--radius-lg)" }}>
              {/* Chrome Bar */}
              <div style={{
                display: "flex",
                alignItems: "center",
                gap: "var(--space-3)",
                padding: "var(--space-3) var(--space-4)",
                background: "var(--color-surface)",
                borderBottom: "1px solid var(--color-border)"
              }}>
                <div style={{ display: "flex", gap: 6 }}>
                  {["#F87171", "#FBBF24", "#34D399"].map((c) => (
                    <span key={c} style={{ width: 10, height: 10, borderRadius: "50%", background: c, flexShrink: 0 }} />
                  ))}
                </div>
                <div style={{
                  flex: 1,
                  maxWidth: 480,
                  margin: "0 auto",
                  padding: "4px var(--space-3)",
                  borderRadius: "var(--radius-sm)",
                  background: "var(--color-bg)",
                  border: "1px solid var(--color-border)",
                  display: "flex",
                  alignItems: "center",
                  gap: "var(--space-2)"
                }}>
                  <span className="status-dot green" style={{ width: 6, height: 6 }} />
                  <span style={{ fontSize: 11, color: "var(--color-text-muted)", fontFamily: "var(--font-mono)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    preview — {props.me.name}
                  </span>
                </div>
                <span className="badge muted" style={{ fontSize: 10, flexShrink: 0 }}>
                  {DEVICE_SIZES[device].label}
                </span>
              </div>

              {/* LivePreviewPanel */}
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
    </div>
  );
}
