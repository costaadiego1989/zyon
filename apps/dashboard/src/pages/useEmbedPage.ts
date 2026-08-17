import { useState } from "react";
import { useApi } from "../hooks/useApi.js";
import { DashboardHttpError } from "../api/http/index.js";
import { type EmbedSessionResponse } from "../api-client.js";

const EMBED_SCOPES = ["checkout:start", "checkout:track", "checkout:chat", "offers:apply", "coupons:apply", "payment:intents:create"];

export type EmbedTab = "install" | "config";

export interface EmbedPageState {
  tab: EmbedTab;
  allowedOrigin: string;
  cartRef: string;
  ttl: number;
  session: EmbedSessionResponse | null;
  message: string | null;
  busy: boolean;
  copied: boolean;
  selectedScopes: string[];
  validationErrors: Record<string, string>;
}

export interface EmbedPageActions {
  setTab: (tab: EmbedTab) => void;
  setAllowedOrigin: (v: string) => void;
  setCartRef: (v: string) => void;
  setTtl: (v: number) => void;
  setSelectedScopes: React.Dispatch<React.SetStateAction<string[]>>;
  generateToken: () => void;
  copySnippet: () => void;
}

export interface EmbedPageViewModel extends EmbedPageState {
  actions: EmbedPageActions;
  snippet: string;
  hasToken: boolean;
}

export function useEmbedPage(apiBaseUrl: string): EmbedPageViewModel {
  const api = useApi();
  const [tab, setTab] = useState<EmbedTab>("install");
  const [allowedOrigin, setAllowedOrigin] = useState("https://");
  const [cartRef, setCartRef] = useState("");
  const [ttl, setTtl] = useState(900);
  const [session, setSession] = useState<EmbedSessionResponse | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [selectedScopes, setSelectedScopes] = useState<string[]>(EMBED_SCOPES);
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({});

  const hasToken = Boolean(session);

  const snippet = session
    ? `<script src="${apiBaseUrl}/widget/aacp.js" async></script>\n<zyon-checkout-agent\n  embed-session-token="${session.embed_session_token}"\n  api-base-url="${apiBaseUrl}"\n></zyon-checkout-agent>`
    : `<script src="${apiBaseUrl}/widget/aacp.js" async></script>\n<zyon-checkout-agent\n  embed-session-token="SEU_TOKEN_AQUI"\n  api-base-url="${apiBaseUrl}"\n></zyon-checkout-agent>`;

  function generateToken() {
    const errors = validateEmbedForm({ allowedOrigin, cartRef, ttl, scopes: selectedScopes });
    setValidationErrors(errors);
    if (Object.keys(errors).length > 0) return;

    setBusy(true);
    setMessage(null);
    void api
      .createEmbedSession({
        ttl_seconds: ttl,
        allowed_origin: allowedOrigin,
        cart_ref: cartRef,
        scopes: selectedScopes,
      })
      .then((res) => {
        setSession(res);
        setMessage("Token gerado com sucesso.");
      })
      .catch((e) => {
        setMessage(
          e instanceof DashboardHttpError
            ? e.responseBody.slice(0, 160)
            : e instanceof Error
              ? e.message
              : String(e)
        );
      })
      .finally(() => setBusy(false));
  }

  function copySnippet() {
    void copyToClipboard(snippet).then((ok) => {
      if (ok) {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }
    });
  }

  return {
    tab,
    allowedOrigin,
    cartRef,
    ttl,
    session,
    message,
    busy,
    copied,
    selectedScopes,
    validationErrors,
    snippet,
    hasToken,
    actions: {
      setTab,
      setAllowedOrigin,
      setCartRef,
      setTtl,
      setSelectedScopes,
      generateToken,
      copySnippet,
    },
  };
}

// ── Pure functions (exported for testing) ───────────────────────────────────

export function formatExpiry(unixSeconds: number): string {
  const date = new Date(unixSeconds * 1000);
  const formatted = date.toLocaleString("pt-BR", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
  const diffMs = unixSeconds * 1000 - Date.now();
  const diffMin = Math.round(diffMs / 60000);
  if (diffMin <= 0) return `${formatted} (expirado)`;
  if (diffMin < 60) return `${formatted} (expira em ${diffMin} min)`;
  const diffH = Math.round(diffMin / 60);
  return `${formatted} (expira em ${diffH}h)`;
}

export function validateEmbedForm(params: {
  allowedOrigin: string;
  cartRef: string;
  ttl: number;
  scopes: string[];
}): Record<string, string> {
  const errors: Record<string, string> = {};
  try {
    const url = new URL(params.allowedOrigin);
    if (!["http:", "https:"].includes(url.protocol)) {
      errors.allowedOrigin = "Protocolo deve ser http ou https";
    }
  } catch {
    errors.allowedOrigin = "URL inválida. Ex: https://minha-loja.com";
  }
  if (!params.cartRef.trim()) {
    errors.cartRef = "Referência do carrinho é obrigatória";
  }
  if (params.ttl !== 0 && (params.ttl < 60 || params.ttl > 31536000)) {
    errors.ttl = "Selecione uma validade válida";
  }
  if (params.scopes.length === 0) {
    errors.scopes = "Selecione ao menos uma permissão";
  }
  return errors;
}

export async function copyToClipboard(text: string): Promise<boolean> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch { /* fall through */ }
  }
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  try {
    return document.execCommand("copy");
  } finally {
    document.body.removeChild(textarea);
  }
}
