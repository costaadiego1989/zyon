import React, { useEffect, useMemo, useState } from "react";
import { Eye, MonitorSmartphone, RefreshCw, Smartphone } from "lucide-react";
import {
  createDashboardApi,
  DashboardHttpError,
  normalizeApiBase,
  type MerchantProfile,
} from "../api-client.js";

/** Read-only scopes: render the real flow without creating payment intents. */
const PREVIEW_SCOPES = ["checkout:start", "checkout:track", "checkout:chat", "offers:apply", "coupons:apply"];
const PREVIEW_TTL_SECONDS = 900;

type Presentation = "floating" | "conversational";

function errorText(e: unknown): string {
  if (e instanceof DashboardHttpError) return e.responseBody.slice(0, 200);
  return e instanceof Error ? e.message : String(e);
}

function widgetBundleBase(apiBaseUrl: string): string {
  const override = (import.meta.env.VITE_WIDGET_BUNDLE_URL as string | undefined)?.trim();
  if (override) return override.replace(/\/$/, "");
  return `${normalizeApiBase(apiBaseUrl)}/widget`;
}

/**
 * Live preview of the **real** checkout widget (custom element
 * `zyon-checkout-agent`), loaded from the API origin inside a sandboxed iframe
 * and fed by a short-lived, tenant-scoped preview embed token. The widget
 * hydrates the merchant's saved theme/agent/copy server-side, so this reflects
 * the live configuration without touching production data.
 */
export function CheckoutPreviewPage(props: { apiBaseUrl: string; me: MerchantProfile }) {
  const api = useMemo(() => createDashboardApi({ baseUrl: props.apiBaseUrl }), [props.apiBaseUrl]);
  const apiBase = useMemo(() => normalizeApiBase(props.apiBaseUrl), [props.apiBaseUrl]);
  const bundleBase = useMemo(() => widgetBundleBase(props.apiBaseUrl), [props.apiBaseUrl]);

  const [token, setToken] = useState<string | null>(null);
  const [presentation, setPresentation] = useState<Presentation>("floating");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function issuePreview() {
    setBusy(true);
    setMessage(null);
    try {
      const session = await api.createEmbedSession({
        ttl_seconds: PREVIEW_TTL_SECONDS,
        allowed_origin: window.location.origin,
        scopes: PREVIEW_SCOPES,
      });
      setToken(session.embed_session_token);
    } catch (e) {
      setMessage(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    void issuePreview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api]);

  const srcDoc = useMemo(() => {
    if (!token) return null;
    return [
      "<!doctype html><html lang=\"pt-BR\"><head><meta charset=\"utf-8\" />",
      "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\" />",
      `<link rel="stylesheet" href="${bundleBase}/widget.css" />`,
      "<style>html,body{margin:0;padding:16px;background:#f8fafc;font-family:ui-sans-serif,system-ui,sans-serif;}</style>",
      "</head><body>",
      `<script defer src="${bundleBase}/aacp.js"></script>`,
      "<zyon-checkout-agent",
      `  embed-session-token="${token}"`,
      `  api-base-url="${apiBase}"`,
      `  ui-presentation="${presentation}"`,
      "></zyon-checkout-agent>",
      "</body></html>",
    ].join("\n");
  }, [token, apiBase, bundleBase, presentation]);

  return (
    <div className="dashboard-content">
      <div className="split-panel" style={{ gridTemplateColumns: "280px 1fr", gap: "var(--space-5)" }}>

        {/* Left — controls */}
        <div className="split-panel-controls">
          <section className="panel stacked">
            <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", marginBottom: "var(--space-1)" }}>
              <div style={{
                width: 32,
                height: 32,
                display: "grid",
                placeItems: "center",
                borderRadius: "var(--radius-sm)",
                background: "var(--color-brand-subtle)",
                color: "var(--color-brand)",
                flexShrink: 0
              }}>
                <Eye size={16} />
              </div>
              <h2 style={{ fontSize: 15 }}>Live Preview</h2>
            </div>

            <p style={{ fontSize: 12, color: "var(--color-text-muted)", lineHeight: 1.6, margin: 0 }}>
              Widget real de <strong style={{ color: "var(--color-text-secondary)" }}>{props.me.name}</strong>,
              com configuração salva e token de preview (
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 11 }}>{PREVIEW_TTL_SECONDS / 60} min</span>).
              Sem efeito em dados de produção.
            </p>

            {/* Token status */}
            <div style={{
              padding: "var(--space-3)",
              borderRadius: "var(--radius-sm)",
              background: token ? "var(--color-success-bg)" : busy ? "var(--color-bg)" : "var(--color-error-bg)",
              border: `1px solid ${token ? "var(--color-success-border)" : busy ? "var(--color-border)" : "var(--color-error-border)"}`,
              display: "flex",
              alignItems: "center",
              gap: "var(--space-2)"
            }}>
              <span className={`status-dot ${token ? "green" : busy ? "amber" : "red"}`} />
              <span style={{
                fontSize: 12,
                fontWeight: 600,
                color: token ? "#065F46" : busy ? "var(--color-text-muted)" : "var(--color-error)"
              }}>
                {token ? "Token ativo" : busy ? "Emitindo token…" : "Sem token"}
              </span>
              {token && (
                <span style={{
                  marginLeft: "auto",
                  fontSize: 10,
                  fontFamily: "var(--font-mono)",
                  color: "#059669",
                  fontWeight: 600
                }}>
                  {PREVIEW_TTL_SECONDS / 60} min
                </span>
              )}
            </div>

            {message && (
              <p className="panel-error" style={{ margin: 0, fontSize: 12 }}>{message}</p>
            )}
          </section>

          {/* Presentation mode */}
          <section className="panel stacked">
            <h2 style={{ fontSize: 13, color: "var(--color-text-secondary)", marginBottom: "var(--space-1)" }}>
              Modo de apresentação
            </h2>

            <div style={{ display: "grid", gap: "var(--space-2)" }}>
              {(["floating", "conversational"] as Presentation[]).map((mode) => {
                const active = presentation === mode;
                return (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setPresentation(mode)}
                    style={{
                      justifyContent: "flex-start",
                      gap: "var(--space-3)",
                      padding: "var(--space-3) var(--space-3)",
                      minHeight: 44,
                      borderRadius: "var(--radius-sm)",
                      background: active ? "var(--color-brand-subtle)" : "var(--color-surface-raised)",
                      borderColor: active ? "var(--color-brand)" : "var(--color-border)",
                      color: active ? "var(--color-brand)" : "var(--color-text-secondary)",
                      fontWeight: active ? 700 : 500,
                      transition: "all var(--duration-fast) var(--ease)"
                    }}
                  >
                    {mode === "floating"
                      ? <MonitorSmartphone size={16} style={{ flexShrink: 0 }} />
                      : <Smartphone size={16} style={{ flexShrink: 0 }} />
                    }
                    <div style={{ textAlign: "left" }}>
                      <span style={{ display: "block", fontSize: 13 }}>
                        {mode === "floating" ? "Flutuante" : "Conversacional"}
                      </span>
                      <span style={{ display: "block", fontSize: 11, fontWeight: 400, color: "var(--color-text-muted)", marginTop: 1 }}>
                        {mode === "floating"
                          ? "Botão sobreposição com chat expandido"
                          : "Fluxo de chat tela cheia"}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          </section>

          {/* Scopes info */}
          <section className="panel stacked">
            <h2 style={{ fontSize: 13, color: "var(--color-text-secondary)", marginBottom: "var(--space-1)" }}>
              Escopos de preview
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

          {/* Renew button */}
          <button
            type="button"
            disabled={busy}
            onClick={() => void issuePreview()}
            style={{ width: "100%", justifyContent: "center", minHeight: 40 }}
          >
            <RefreshCw size={14} style={{ ...(busy ? { animation: "spin 1s linear infinite" } : {}) }} />
            {busy ? "Renovando…" : "Renovar token"}
          </button>
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>

        {/* Right — preview iframe */}
        <div className="split-panel-preview" style={{ minWidth: 0 }}>
          <div className="preview-stage" style={{ margin: 0, borderRadius: "var(--radius-lg)" }}>
            {/* Stage chrome bar */}
            <div style={{
              display: "flex",
              alignItems: "center",
              gap: "var(--space-3)",
              padding: "var(--space-3) var(--space-4)",
              background: "var(--color-surface)",
              borderBottom: "1px solid var(--color-border)"
            }}>
              {/* Traffic lights */}
              <div style={{ display: "flex", gap: 6 }}>
                {["#F87171", "#FBBF24", "#34D399"].map((c) => (
                  <span key={c} style={{ width: 10, height: 10, borderRadius: "50%", background: c, flexShrink: 0 }} />
                ))}
              </div>
              {/* Fake URL bar */}
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
                {presentation === "floating" ? "Flutuante" : "Conversacional"}
              </span>
            </div>

            {/* Frame content */}
            {srcDoc ? (
              <iframe
                key={`${presentation}:${token}`}
                className="preview-frame"
                title="Live preview do checkout"
                srcDoc={srcDoc}
                sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
                style={{ height: 720 }}
              />
            ) : busy ? (
              <div style={{ height: 720, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "var(--space-4)", background: "var(--color-surface-raised)" }}>
                <div style={{ display: "grid", gap: "var(--space-3)", width: "60%", maxWidth: 320 }}>
                  <div className="skeleton" style={{ height: 14, borderRadius: "var(--radius-sm)" }} />
                  <div className="skeleton" style={{ height: 14, borderRadius: "var(--radius-sm)", width: "75%" }} />
                  <div className="skeleton" style={{ height: 14, borderRadius: "var(--radius-sm)", width: "85%" }} />
                </div>
                <p style={{ fontSize: 13, color: "var(--color-text-muted)", margin: 0 }}>
                  Emitindo token de preview…
                </p>
              </div>
            ) : (
              <div className="empty-state" style={{ height: 720, justifyContent: "center" }}>
                <div className="empty-state-icon"><Eye size={22} /></div>
                <h3>Sem preview</h3>
                <p>Clique em "Renovar token" para iniciar o preview do widget.</p>
                <button type="button" className="btn-primary" onClick={() => void issuePreview()}>
                  <RefreshCw size={14} />
                  Iniciar preview
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
