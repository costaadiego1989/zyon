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
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [api, me]);

    useImperativeHandle(ref, () => ({
      reload() {
        void issueToken();
      },
      postThemeUpdate(theme: unknown) {
        iframeRef.current?.contentWindow?.postMessage(
          { type: "THEME_UPDATE", payload: theme },
          "*"
        );
      },
    }));

    const srcDoc = useMemo(() => {
      if (!token) return null;
      return [
        '<!doctype html><html lang="pt-BR"><head><meta charset="utf-8" />',
        '<meta name="viewport" content="width=device-width, initial-scale=1" />',
        `<link rel="stylesheet" href="${bundleBase}/widget.css" />`,
        '<style>html,body{margin:0;padding:0;background:#f8fafc;font-family:ui-sans-serif,system-ui,sans-serif;height:100%;overflow:hidden}</style>',
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
          : `.zyon-widget{position:relative!important;inset:auto!important;width:100%!important;height:100%!important;display:flex!important;align-items:center!important;justify-content:center!important} .zyon-panel{height:100%!important;max-width:none!important;border-radius:16px!important} .zyon-channel-gate{position:absolute!important;inset:0!important;display:grid!important;place-items:center!important;padding:8px!important} .zyon-channel-gate__panel{max-width:420px!important;height:100%!important;max-height:100%!important;border-radius:12px!important;overflow-y:auto!important}`,
        `</style>`,
        "</body></html>",
      ].join("\n");
    }, [token, apiBase, bundleBase, presentation]);

    if (!me) {
      return (
        <div
          className={className}
          style={{
            height: 600,
            width: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "#f8fafc",
            borderRadius: 8,
            color: "#64748b",
          }}
        >
          Faça login para ver o preview
        </div>
      );
    }

    return (
      <section
        className={className}
        style={{ display: "flex", flexDirection: "column", gap: 12, width: width ?? "100%", height: "100%" }}
      >
        {!hideControls && (
          <div className="preview-controls" style={{ display: "flex", gap: 8, alignItems: "center" }}>
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
            <button type="button" disabled={busy} onClick={() => void issueToken()}>
              <RefreshCw size={15} /> Renovar token
            </button>
          </div>
        )}

        {errorMsg ? <p className="panel panel-info">{errorMsg}</p> : null}

        <div
          className="preview-stage"
          style={{ height: "100%", minHeight: 600, width: "100%", borderRadius: 8, overflow: "hidden" }}
        >
          {srcDoc ? (
            <iframe
              ref={iframeRef}
              key={`${presentation}:${token}`}
              className="preview-frame"
              title="Live preview do checkout"
              srcDoc={srcDoc}
              sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
              style={{ width: "100%", height: "100%", border: "none" }}
            />
          ) : (
            <p className="page-lead" style={{ padding: 16 }}>
              {busy ? "Emitindo token de preview..." : "Sem preview."}
            </p>
          )}
        </div>
      </section>
    );
  }
);
