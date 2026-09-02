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
        const msg = errorText(e);
        // Don't propagate 401 as session-expired — it's an embed token issue, not login
        if (msg.includes("401") || msg.includes("issuer") || msg.includes("Unauthorized")) {
          setErrorMsg("Não foi possível gerar preview. Verifique se a API está rodando e tente recarregar a página.");
        } else {
          setErrorMsg(msg);
        }
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
        '<style>html,body{margin:0;padding:0;background:#0d1117;font-family:ui-sans-serif,system-ui,sans-serif;height:100%;overflow:hidden}body{display:flex;flex-direction:column}</style>',
        "</head><body>",
        `<script defer src="${bundleBase}/aacp.js"></script>`,
        // Give the host element a definite box that fills the iframe — the widget's
        // internal `height:100%` chain (shell→frame→inner) needs a sized host to
        // resolve against. This mirrors the working embed contract in the widget's
        // own test-embed.html, which sizes the element via an inline style box (there
        // a fixed 380x640; here fill the preview iframe). Without a definite host size
        // the frame/inner collapse to 0 and the hero clips to black.
        "<zyon-checkout-agent",
        `  style="position:relative;display:block;width:100%;height:100%;overflow:hidden"`,
        `  embed-session-token="${token}"`,
        `  api-base-url="${apiBase}"`,
        // Real merchant id so buyer-scoped calls resolve to this merchant (else the
        // element defaults to "mrc_demo" → 401s on buyer/me/* against the wrong tenant).
        me?.id ? `  merchant-id="${me.id}"` : "",
        `  ui-presentation="${presentation}"`,
        "></zyon-checkout-agent>",
        `<style>`,
        // Establish an unbroken height chain host→shell→frame→inner. The IntroStage
        // root is `position:absolute; inset:0`, so it fills its nearest positioned
        // ancestor (pulse-widget-inner) — if that ancestor has 0 height (the collapse
        // we saw in embed mode), the whole intro clips to nothing (black body). Force
        // each link to a definite height and make inner the positioning context.
        `.pulse-widget-shell{height:100%!important;min-height:0!important;display:flex!important;flex-direction:column!important}`,
        `.pulse-widget-frame{flex:1 1 auto!important;height:auto!important;min-height:0!important;max-width:none!important;border-radius:0!important;border:none!important;box-shadow:none!important;filter:none!important;display:flex!important;flex-direction:column!important}`,
        `.pulse-widget-inner{flex:1 1 auto!important;height:auto!important;min-height:0!important;position:relative!important;overflow:hidden!important}`,
        `</style>`,
        "</body></html>",
      ].join("\n");
    }, [token, apiBase, bundleBase, presentation, me?.id]);

    if (!me) {
      return <WidgetFallback className={className} />;
    }

    return (
      <section
        className={className}
        style={{ display: "flex", flexDirection: "column", gap: 0, width: width ?? "100%", height: "100%" }}
      >
        {!hideControls && (
          <div style={{ display: "flex", gap: 6, alignItems: "center", padding: "10px 14px", background: "var(--surface-1)", borderRadius: "12px 12px 0 0", borderBottom: "1px solid var(--color-border)" }}>
            <div style={{ display: "flex", gap: 3, background: "var(--surface-2)", borderRadius: 7, padding: 3 }}>
              {(["floating", "conversational"] as const).map(mode => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setPresentation(mode)}
                  style={{ padding: "6px 12px", borderRadius: 6, border: "none", font: "600 11px var(--font-sans)", cursor: "pointer", background: presentation === mode ? "var(--color-brand-subtle)" : "transparent", color: presentation === mode ? "var(--color-brand)" : "var(--color-text-faint)" }}
                >
                  {mode === "floating" ? "Flutuante" : "Conversacional"}
                </button>
              ))}
            </div>
            <button type="button" disabled={busy} onClick={() => void issueToken()} style={{ marginLeft: "auto", padding: "6px 12px", borderRadius: 6, border: "1px solid var(--color-border)", background: "var(--surface-2)", font: "600 11px var(--font-sans)", color: "var(--color-text-muted)", cursor: "pointer", display: "flex", alignItems: "center", gap: 5 }}>
              <RefreshCw size={12} /> Renovar token
            </button>
          </div>
        )}

        {errorMsg ? <p style={{ padding: "10px 14px", font: "12px var(--font-sans)", color: "var(--color-error)", background: "var(--color-error-bg)", margin: 0 }}>{errorMsg}</p> : null}

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
