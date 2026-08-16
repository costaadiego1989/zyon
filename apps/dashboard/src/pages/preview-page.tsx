import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Eye,
  Maximize2,
  Minimize2,
  Monitor,
  RefreshCw,
  ShoppingCart,
  Smartphone,
  Store,
  Tablet,
} from "lucide-react";
import { type MerchantProfile, type MerchantTheme } from "../api-client.js";
import { LivePreviewPanel, type LivePreviewPanelRef } from "../components/LivePreviewPanel.js";
import { useApi } from "../hooks/useApi.js";

type Presentation = "floating" | "conversational";
type DeviceSize = keyof typeof DEVICE_SIZES;
type PreviewMode = "checkout" | "storefront";

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

function pickInitialMode(plan: MerchantProfile["plan"] | undefined): PreviewMode {
  if (plan === "STORE_ONLY") return "storefront";
  return "checkout";
}

export function CheckoutPreviewPage(props: { apiBaseUrl: string; me: MerchantProfile }) {
  const api = useApi();
  const previewRef = useRef<LivePreviewPanelRef>(null);

  const [presentation, setPresentation] = useState<Presentation>("floating");
  const [device, setDevice] = useState<DeviceSize>("mobile");
  const [tokenExpiresAt, setTokenExpiresAt] = useState<number | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [theme, setTheme] = useState<MerchantTheme | null>(null);
  const [themeError, setThemeError] = useState<string | null>(null);
  const [countdown, setCountdown] = useState<string | null>(null);

  const [previewMode, setPreviewMode] = useState<PreviewMode>(() => pickInitialMode(props.me.plan));
  const [storefrontKey, setStorefrontKey] = useState(0);

  const showTabs = props.me.plan === "BOTH";
  const isCheckoutTab = !showTabs || previewMode === "checkout";
  const isStorefrontTab = !showTabs || previewMode === "storefront";

  const merchantSlug =
    (props.me as unknown as { storeSettings?: { slug?: string } }).storeSettings?.slug ||
    props.me.id;
  const storefrontBase =
    (import.meta as any).env?.VITE_STOREFRONT_URL || "http://localhost:3001";
  const storefrontUrl = `${storefrontBase}/store/${encodeURIComponent(merchantSlug)}`;

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

  const title = isCheckoutTab ? "Preview do Checkout" : "Preview da Loja";
  const subtitle = isCheckoutTab
    ? "Widget que aparece no checkout do seu e-commerce"
    : "Storefront conversacional como seus clientes verão";

  const refresh = useCallback(() => {
    if (isCheckoutTab) {
      previewRef.current?.reload();
    } else {
      setStorefrontKey((k) => k + 1);
    }
  }, [isCheckoutTab]);

  // ----- Fullscreen -----
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

  // ----- Shared chrome (dots + URL bar) -----
  const chrome = (
    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 16px", background: "var(--bg)", borderBottom: "1px solid var(--border)" }}>
      <div style={{ display: "flex", gap: 5 }}>
        {["oklch(60% 0.2 25)", "oklch(76% 0.15 80)", "oklch(70% 0.17 149)"].map((c) => (
          <span key={c} style={{ width: 8, height: 8, borderRadius: "50%", background: c }} />
        ))}
      </div>
      <div style={{ flex: 1, textAlign: "center", font: "11px var(--mono)", color: "var(--faint)" }}>
        {isCheckoutTab
          ? `${props.me.name || "Preview"} — ${DEVICE_SIZES[device].label} · ${presentation === "floating" ? "Flutuante" : "Fullscreen"}`
          : `${storefrontUrl} — ${DEVICE_SIZES[device].label}`}
      </div>
    </div>
  );

  return (
    <div>
      {/* ── Title ── */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ font: "600 10px var(--mono)", letterSpacing: "0.06em", color: "var(--faint)", marginBottom: 4 }}>PREVIEW AO VIVO</div>
        <h1 style={{ font: "700 22px var(--serif)", color: "var(--ink)", letterSpacing: "-0.02em", marginBottom: 6 }}>{title}</h1>
        <div style={{ font: "17px var(--serif)", fontStyle: "italic", color: "var(--muted)" }}>{subtitle}</div>
      </div>

      {/* ── Product tab toggle (only when BOTH) ── */}
      {showTabs && (
        <div style={{ display: "flex", gap: 4, background: "var(--bg)", borderRadius: 10, padding: 4, marginBottom: 12, width: "fit-content" }}>
          {(
            [
              { id: "checkout" as const, label: "Widget Checkout", Icon: ShoppingCart },
              { id: "storefront" as const, label: "Loja (Storefront)", Icon: Store },
            ]
          ).map(({ id, label, Icon }) => {
            const active = previewMode === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => setPreviewMode(id)}
                style={{
                  padding: "8px 14px",
                  borderRadius: 7,
                  border: "none",
                  font: "600 12px var(--sans)",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  background: active ? "var(--card)" : "transparent",
                  color: active ? "var(--ink)" : "var(--faint)",
                  boxShadow: active ? "0 1px 3px rgba(0,0,0,0.2)" : "none",
                }}
              >
                <Icon size={13} /> {label}
              </button>
            );
          })}
        </div>
      )}

      {/* ── Control bar ── */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 18px", background: "var(--card)", border: "1px solid var(--border)", borderRadius: 12, marginBottom: 16 }}>
        {/* Status — checkout only */}
        {isCheckoutTab && (
          <>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span
                style={{
                  width: 7,
                  height: 7,
                  borderRadius: "50%",
                  background: tokenStatus === "active" ? "var(--good)" : tokenStatus === "expired" ? "var(--danger)" : "var(--warn)",
                }}
              />
              <span style={{ font: "600 12px var(--sans)", color: "var(--ink)" }}>{statusText}</span>
              {countdown && tokenStatus === "active" && (
                <span style={{ font: "11px var(--mono)", color: "var(--faint)" }}>{countdown}</span>
              )}
            </div>
            <div style={{ width: 1, height: 20, background: "var(--border)" }} />
          </>
        )}

        {/* Presentation mode — checkout only */}
        {isCheckoutTab && (
          <>
            <div style={{ display: "flex", gap: 4, background: "var(--bg)", borderRadius: 8, padding: 3 }}>
              {(["floating", "conversational"] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setPresentation(mode)}
                  style={{
                    padding: "6px 12px",
                    borderRadius: 6,
                    border: "none",
                    font: "600 11px var(--sans)",
                    cursor: "pointer",
                    background: presentation === mode ? "var(--card)" : "transparent",
                    color: presentation === mode ? "var(--ink)" : "var(--faint)",
                    boxShadow: presentation === mode ? "0 1px 3px rgba(0,0,0,0.2)" : "none",
                  }}
                >
                  {mode === "floating" ? "Flutuante" : "Tela cheia"}
                </button>
              ))}
            </div>
            <div style={{ width: 1, height: 20, background: "var(--border)" }} />
          </>
        )}

        {/* Device toggle — both tabs */}
        <div style={{ display: "flex", gap: 4, background: "var(--bg)", borderRadius: 8, padding: 3 }}>
          {(Object.keys(DEVICE_SIZES) as DeviceSize[]).map((size) => {
            const Icon = size === "desktop" ? Monitor : size === "tablet" ? Tablet : Smartphone;
            return (
              <button
                key={size}
                type="button"
                onClick={() => setDevice(size)}
                style={{
                  padding: "6px 10px",
                  borderRadius: 6,
                  border: "none",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: 5,
                  font: "600 11px var(--sans)",
                  background: device === size ? "var(--card)" : "transparent",
                  color: device === size ? "var(--ink)" : "var(--faint)",
                  boxShadow: device === size ? "0 1px 3px rgba(0,0,0,0.2)" : "none",
                }}
              >
                <Icon size={13} /> {DEVICE_SIZES[size].label}
              </button>
            );
          })}
        </div>

        <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
          <button
            type="button"
            onClick={refresh}
            style={{
              width: 32,
              height: 32,
              borderRadius: 8,
              border: "1px solid var(--border)",
              background: "var(--bg)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
              color: "var(--muted)",
            }}
            aria-label="Atualizar preview"
          >
            <RefreshCw size={13} />
          </button>
          <button
            type="button"
            onClick={() => setIsFullscreen(true)}
            style={{
              width: 32,
              height: 32,
              borderRadius: 8,
              border: "1px solid var(--border)",
              background: "var(--bg)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
              color: "var(--muted)",
            }}
            aria-label="Tela cheia"
          >
            <Maximize2 size={13} />
          </button>
        </div>
      </div>

      {/* ── Preview Stage ── */}
      <div style={{ display: "flex", justifyContent: "center", padding: 0 }}>
        <div
          style={{
            width: device === "desktop" ? "100%" : DEVICE_SIZES[device].width,
            maxWidth: "100%",
            transition: "width 0.25s ease",
            background: "var(--card)",
            border: "1px solid var(--border)",
            borderRadius: 14,
            overflow: "hidden",
          }}
        >
          {chrome}

          <div style={{ height: "calc(100vh - 280px)", minHeight: 520 }}>
            {isCheckoutTab ? (
              <LivePreviewPanel
                ref={previewRef}
                apiBaseUrl={props.apiBaseUrl}
                me={props.me}
                presentation={presentation}
                hideControls
                width="100%"
                onTokenIssued={handleTokenIssued}
              />
            ) : (
              <iframe
                key={storefrontKey}
                src={storefrontUrl}
                title="Storefront preview"
                style={{
                  width: "100%",
                  height: "100%",
                  border: "none",
                  display: "block",
                  background: "var(--bg)",
                }}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
