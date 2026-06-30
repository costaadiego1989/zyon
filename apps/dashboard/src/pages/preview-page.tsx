import React, { useEffect, useMemo, useState } from "react";
import { Eye, RefreshCw } from "lucide-react";
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
    <section className="panel stacked checkout-preview">
      <header className="page-head">
        <div>
          <h1>
            <Eye size={18} /> Live preview do checkout
          </h1>
          <p className="page-lead">
            Widget real de {props.me.name}, com a sua configuracao salva e um token de preview
            (origem + expiracao {PREVIEW_TTL_SECONDS / 60} min). Sem efeito em dados de producao.
          </p>
        </div>
        <div className="preview-controls">
          <div className="segmented">
            <button
              type="button"
              className={presentation === "floating" ? "active" : ""}
              onClick={() => setPresentation("floating")}
            >
              Flutuante
            </button>
            <button
              type="button"
              className={presentation === "conversational" ? "active" : ""}
              onClick={() => setPresentation("conversational")}
            >
              Conversacional
            </button>
          </div>
          <button type="button" disabled={busy} onClick={() => void issuePreview()}>
            <RefreshCw size={15} /> Renovar token
          </button>
        </div>
      </header>

      {message ? <p className="panel panel-info">{message}</p> : null}

      <div className="preview-stage">
        {srcDoc ? (
          <iframe
            key={`${presentation}:${token}`}
            className="preview-frame"
            title="Live preview do checkout"
            srcDoc={srcDoc}
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
          />
        ) : (
          <p className="page-lead">{busy ? "Emitindo token de preview..." : "Sem preview."}</p>
        )}
      </div>
    </section>
  );
}
