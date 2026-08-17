import { useEffect } from "react";
import { useCheckoutStore } from "@/store/checkout-store";
import { CheckoutLayout } from "@/layouts/CheckoutLayout";
import { setupAbandonmentTracking, trackEvent } from "@/lib/tracking";
import { onOrderCompleted } from "@/lib/lifecycle";

const DEFAULT_API_BASE = "http://localhost:3009";

function readUrlParams() {
  const params = new URLSearchParams(window.location.search);
  const embedToken =
    params.get("embedToken") ||
    params.get("embedSessionToken") ||
    params.get("embed_session_token") ||
    "";
  const merchantId = params.get("merchantId") || params.get("merchant_id") || "";
  const cartRef = params.get("cartId") || params.get("cartRef") || params.get("cart_ref") || undefined;
  const apiBaseUrl = params.get("apiBaseUrl") || params.get("api_base_url") || DEFAULT_API_BASE;

  // Strip sensitive params from URL (security: avoid leaking token in Referer/history)
  const sensitive = ["embedToken", "embedSessionToken", "embed_session_token", "merchantId", "merchant_id"];
  let changed = false;
  for (const key of sensitive) {
    if (params.has(key)) {
      params.delete(key);
      changed = true;
    }
  }
  if (changed) {
    const newSearch = params.toString();
    const newUrl = window.location.pathname + (newSearch ? `?${newSearch}` : "") + window.location.hash;
    window.history.replaceState(null, "", newUrl);
  }

  return { embedToken, merchantId, cartRef, apiBaseUrl };
}

export function App() {
  const status = useCheckoutStore((s) => s.status);
  const error = useCheckoutStore((s) => s.error);
  const init = useCheckoutStore((s) => s.init);
  const brand = useCheckoutStore((s) => s.brand);
  const sessionId = useCheckoutStore((s) => s.sessionId);

  // Setup abandonment tracking
  useEffect(() => {
    const cleanup = setupAbandonmentTracking();
    return cleanup;
  }, []);

  // Track order completion
  useEffect(() => {
    if (status === "completed" && sessionId) {
      void trackEvent("order_completed");
      onOrderCompleted(sessionId);
    }
  }, [status, sessionId]);

  useEffect(() => {
    const { embedToken, merchantId, cartRef, apiBaseUrl } = readUrlParams();
    if (!embedToken || !merchantId) {
      // Dev fallback: if on localhost and only cartId present, show helpful message
      const isLocalhost = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";
      if (isLocalhost && cartRef) {
        useCheckoutStore.setState({
          status: "error",
          error: "Ambiente de desenvolvimento: embedToken ou merchantId ausente na URL. Verifique se INTERNAL_SERVICE_TOKEN está configurado no storefront.",
        });
      } else {
        useCheckoutStore.setState({
          status: "error",
          error: "Token de sessão ou merchant inválido. Verifique o link.",
        });
      }
      return;
    }
    void init({ embedToken, merchantId, cartRef, apiBaseUrl });
  }, [init]);

  // Apply brand theme as CSS variables
  useEffect(() => {
    const root = document.documentElement;
    if (brand.accentColor) root.style.setProperty("--aacp-accent", brand.accentColor);
    if (brand.secondaryColor) root.style.setProperty("--aacp-accent-2", brand.secondaryColor);
    if (brand.backgroundColor) root.style.setProperty("--aacp-bg", brand.backgroundColor);
    if (brand.textColor) root.style.setProperty("--aacp-fg", brand.textColor);
    if (brand.fontFamily) root.style.setProperty("--aacp-font", brand.fontFamily);
    if (brand.fontDisplay) root.style.setProperty("--aacp-font-display", brand.fontDisplay);
    if (brand.borderColor) root.style.setProperty("--aacp-border-color", brand.borderColor);
    if (brand.borderRadius != null) root.style.setProperty("--aacp-radius", `${brand.borderRadius}px`);
    if (brand.surfaceColor) root.style.setProperty("--aacp-surface", brand.surfaceColor);
    if (brand.surfaceElevatedColor) root.style.setProperty("--aacp-surface-elevated", brand.surfaceElevatedColor);
    if (brand.mutedTextColor) root.style.setProperty("--aacp-muted", brand.mutedTextColor);
    if (brand.successColor) root.style.setProperty("--aacp-success", brand.successColor);
    if (brand.warningColor) root.style.setProperty("--aacp-warning", brand.warningColor);
    // Mode: light/dark
    if (brand.mode === "dark") {
      document.body.classList.add("theme-dark");
      document.body.classList.remove("theme-light");
    } else {
      document.body.classList.add("theme-light");
      document.body.classList.remove("theme-dark");
    }
    // Density
    if (brand.density) root.dataset.density = brand.density;
    // Font loading
    if (brand.fontFamily && !document.querySelector(`link[data-font-loaded]`)) {
      const stripQuotes = (s: string) => s.trim().replace(/^['"]|['"]$/g, "");
      const isSystem = (f: string) => f.startsWith("ui-") || f.startsWith("system");
      const families = brand.fontFamily.split(",").map(stripQuotes).filter((f) => f && !isSystem(f));
      const displayFamilies = brand.fontDisplay?.split(",").map(stripQuotes).filter((f) => f && !isSystem(f)) ?? [];
      const all = [...new Set([...families, ...displayFamilies])];
      if (all.length) {
        const link = document.createElement("link");
        link.rel = "stylesheet";
        link.href = `https://fonts.googleapis.com/css2?${all.map((f) => `family=${encodeURIComponent(f)}:wght@300;400;500;600;700`).join("&")}&display=swap`;
        link.dataset.fontLoaded = "true";
        document.head.appendChild(link);
      }
    }
  }, [brand]);

  if (status === "loading") {
    return (
      <div className="checkout-loading">
        <div className="checkout-loading__spinner" />
        <p>Carregando checkout...</p>
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className="checkout-error">
        <h2>Erro</h2>
        <p>{error || "Não foi possível iniciar a sessão de checkout."}</p>
        <button onClick={() => window.location.reload()}>Tentar novamente</button>
      </div>
    );
  }

  return <CheckoutLayout />;
}
