import React, {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { RefreshCw } from "lucide-react";
import {
  createDashboardApi,
  DashboardHttpError,
  normalizeApiBase,
  type MerchantProfile,
} from "../api-client.js";

const PREVIEW_SCOPES = ["checkout:start", "checkout:chat", "checkout:track", "offers:apply"];
const PREVIEW_TTL_SECONDS = 900;

type Presentation = "floating" | "conversational";

export interface LivePreviewPanelProps {
  apiBaseUrl: string;
  me: MerchantProfile | null;
  presentation?: Presentation;
  className?: string;
  onTokenIssued?: (expiresAtUnix: number) => void;
  hideControls?: boolean;
  width?: string;
}

export interface LivePreviewPanelRef {
  reload: () => void;
  postThemeUpdate: (theme: unknown) => void;
}

function errorText(e: unknown): string {
  if (e instanceof DashboardHttpError) return e.responseBody.slice(0, 200);
  return e instanceof Error ? e.message : String(e);
}

function widgetBundleBase(apiBaseUrl: string): string {
  const override = (import.meta.env.VITE_WIDGET_BUNDLE_URL as string | undefined)?.trim();
  if (override) return override.replace(/\/$/, "");
  return `${normalizeApiBase(apiBaseUrl)}/widget`;
}

export const LivePreviewPanel = forwardRef<LivePreviewPanelRef, LivePreviewPanelProps>(
  function LivePreviewPanel(props, ref) {
    const { apiBaseUrl, me, className, onTokenIssued, hideControls, width } = props;

    const api = useMemo(() => createDashboardApi({ baseUrl: apiBaseUrl }), [apiBaseUrl]);
    const apiBase = useMemo(() => normalizeApiBase(apiBaseUrl), [apiBaseUrl]);
    const bundleBase = useMemo(() => widgetBundleBase(apiBaseUrl), [apiBaseUrl]);

    const [token, setToken] = useState<string | null>(null);
    const [presentation, setPresentation] = useState<Presentation>(
      props.presentation ?? "floating"
    );
    const [busy, setBusy] = useState(false);
    const [errorMsg, setErrorMsg] = useState<string | null>(null);

    const iframeRef = useRef<HTMLIFrameElement>(null);

    async function issueToken() {
      if (!me) return;
      setBusy(true);
      setErrorMsg(null);
      try {
        const session = await api.createEmbedSession({
          ttl_seconds: PREVIEW_TTL_SECONDS,
          allowed_origin: window.location.origin,
          scopes: PREVIEW_SCOPES,
        });
        setToken(session.embed_session_token);
        onTokenIssued?.(session.expires_at_unix);
      } catch (e) {
        setErrorMsg(errorText(e));
      } finally {
        setBusy(false);
      }
    }

    useEffect(() => {
      void issueToken();
    }, [apiBaseUrl, me?.id]);

    useImperativeHandle(ref, () => ({
      reload() {
        void issueToken();
      },
      postThemeUpdate(theme: unknown) {
        iframeRef.current?.contentWindow?.postMessage(
          { type: "THEME_UPDATE", payload: theme },
          window.location.origin
        );
      },
    }));

    const srcDoc = useMemo(() => {
      if (!token) return null;
      return [
        '<!doctype html><html lang="pt-BR"><head><meta charset="utf-8" />',
        '<meta name="viewport" content="width=device-width, initial-scale=1" />',
        `<link rel="stylesheet" href="${bundleBase}/widget.css" />`,
        '<style>html,body{margin:0;padding:0;background:#0d1117;font-family:ui-sans-serif,system-ui,sans-serif;height:100%;overflow:hidden;display:flex;align-items:stretch}</style>',
        "</head><body>",
        `<script defer src="${bundleBase}/aacp.js"></script>`,
        "<zyon-checkout-agent",
        `  embed-session-token="${token}"`,
        `  api-base-url="${apiBase}"`,
        `  ui-presentation="${presentation}"`,
        "></zyon-checkout-agent>",
        `<style>`,
        presentation === "conversational"
          ? `.zyon-widget{position:relative!important;inset:auto!important;width:100%!important;height:100%!important;display:flex!important;align-items:center!important;justify-content:center!important} .zyon-panel{width:100%!important;height:100%!important;max-width:none!important;border-radius:0!important;border:none!important;box-shadow:none!important} .zyon-channel-gate{position:absolute!important;inset:0!important;display:grid!important;place-items:center!important;padding:0!important} .zyon-channel-gate__panel{width:100%!important;max-width:none!important;border-radius:0!important;height:100%!important;border:none!important}`
          : `.zyon-widget{position:relative!important;inset:auto!important;width:100%!important;height:100%!important;display:flex!important;align-items:center!important;justify-content:center!important} .zyon-panel{height:100%!important;max-width:none!important;border-radius:0!important} .zyon-channel-gate{position:absolute!important;inset:0!important;display:flex!important;align-items:center!important;justify-content:center!important;padding:0!important} .zyon-channel-gate__backdrop{display:none!important} .zyon-channel-gate__panel{max-width:none!important;width:100%!important;height:100%!important;border-radius:0!important;overflow-y:auto!important;border:none!important}`,
        `</style>`,
        "</body></html>",
      ].join("\n");
    }, [token, apiBase, bundleBase, presentation]);

    if (!me) {
      return <WidgetFallback className={className} />;
    }

    return (
      <section
        className={className}
        style={{ display: "flex", flexDirection: "column", gap: 0, width: width ?? "100%", height: "100%" }}
      >
        {!hideControls && (
          <div style={{ display: "flex", gap: 6, alignItems: "center", padding: "10px 14px", background: "var(--bg)", borderRadius: "12px 12px 0 0", borderBottom: "1px solid var(--border)" }}>
            <div style={{ display: "flex", gap: 3, background: "var(--card)", borderRadius: 7, padding: 3 }}>
              {(["floating", "conversational"] as const).map(mode => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setPresentation(mode)}
                  style={{ padding: "6px 12px", borderRadius: 6, border: "none", font: "600 11px var(--sans)", cursor: "pointer", background: presentation === mode ? "var(--accent-soft)" : "transparent", color: presentation === mode ? "var(--accent)" : "var(--faint)" }}
                >
                  {mode === "floating" ? "Flutuante" : "Conversacional"}
                </button>
              ))}
            </div>
            <button type="button" disabled={busy} onClick={() => void issueToken()} style={{ marginLeft: "auto", padding: "6px 12px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--card)", font: "600 11px var(--sans)", color: "var(--muted)", cursor: "pointer", display: "flex", alignItems: "center", gap: 5 }}>
              <RefreshCw size={12} /> Renovar token
            </button>
          </div>
        )}

        {errorMsg ? <p style={{ padding: "10px 14px", font: "12px var(--sans)", color: "var(--danger)", background: "var(--danger-soft)", margin: 0 }}>{errorMsg}</p> : null}

        <div style={{ flex: 1, minHeight: 520, width: "100%", overflow: "hidden", borderRadius: hideControls ? 0 : "0 0 12px 12px" }}>
          {srcDoc ? (
            <iframe
              ref={iframeRef}
              key={`${presentation}:${token}`}
              title="Live preview do checkout"
              srcDoc={srcDoc}
              sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
              style={{ width: "100%", height: "100%", border: "none", display: "block" }}
            />
          ) : (
            <WidgetFallback />
          )}
        </div>
      </section>
    );
  }
);

function WidgetFallback({ className }: { className?: string }) {
  return (
    <div
      className={className}
      style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", minHeight: 520, padding: "32px 24px", background: "#0a0f0a", borderRadius: 8, gap: 20, textAlign: "center" }}
    >
      <div style={{ width: 72, height: 72, borderRadius: "50%", background: "radial-gradient(circle, #34d399 0%, #065f46 100%)", boxShadow: "0 0 48px #10b98140", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ display: "flex", gap: 10 }}>
          <div style={{ width: 10, height: 10, borderRadius: "50%", background: "#0a0f0a" }} />
          <div style={{ width: 10, height: 10, borderRadius: "50%", background: "#0a0f0a" }} />
        </div>
      </div>
      <div style={{ font: "600 10px 'IBM Plex Mono', monospace", letterSpacing: "0.1em", color: "#34d399" }}>GERENTE DE VENDAS DA LOJA</div>
      <div style={{ font: "700 24px 'Space Grotesk', sans-serif", color: "#f0fdf4", letterSpacing: "-0.02em" }}>Oi, eu sou a Zyon.</div>
      <div style={{ font: "14px/1.6 'Space Grotesk', sans-serif", color: "#6b7280", maxWidth: 280 }}>
        Eu cuido da sua compra do inicio ao fim: acho a melhor opcao, aplico promocoes, organizo a entrega e finalizo o pagamento.
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8, width: "100%", maxWidth: 300, marginTop: 8 }}>
        {["Acho a melhor opção e aplico promoções", "Calculo o frete e organizo a entrega", "Pago com Pix, cartão ou crypto"].map((cap) => (
          <div key={cap} style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", borderRadius: 10, background: "#111827", border: "1px solid #1f2937" }}>
            <div style={{ width: 26, height: 26, borderRadius: 7, background: "#064e3b", display: "flex", alignItems: "center", justifyContent: "center", flex: "none" }}>
              <div style={{ width: 9, height: 9, borderRadius: 2, background: "#34d399" }} />
            </div>
            <span style={{ font: "500 13px 'Space Grotesk', sans-serif", color: "#e5e7eb" }}>{cap}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
