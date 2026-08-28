import { useEffect } from "react";
import { useCheckoutStore } from "@/store/checkout-store";
import { CheckoutLayout } from "@/layouts/CheckoutLayout";
import { MascotOverlay } from "@/components/MascotOverlay";
import { setupAbandonmentTracking, trackEvent } from "@/lib/tracking";
import { onOrderCompleted } from "@/lib/lifecycle";
import { setupIdleTrigger, setupExitIntentTrigger, type TriggerName } from "@/lib/triggers";
import type { DiscountStage } from "@/components/DiscountBanner";

const DEFAULT_API_BASE = "http://localhost:3009";
const SESSION_KEY = "aacp_checkout_session";

function readUrlParams() {
  const params = new URLSearchParams(window.location.search);
  let embedToken =
    params.get("embedToken") ||
    params.get("embedSessionToken") ||
    params.get("embed_session_token") ||
    "";
  let merchantId = params.get("merchantId") || params.get("merchant_id") || "";
  let cartRef = params.get("cartId") || params.get("cartRef") || params.get("cart_ref") || undefined;
  let apiBaseUrl = params.get("apiBaseUrl") || params.get("api_base_url") || DEFAULT_API_BASE;
  let globalUserId = params.get("globalUserId") || params.get("global_user_id") || undefined;

  // SECURITY (W2-016): Enforce HTTPS in production.
  // Allow http only on localhost (development). On any other domain, enforce https
  // to prevent tokens being sent over plaintext.
  const isLocalhost = apiBaseUrl.includes("localhost") || apiBaseUrl.includes("127.0.0.1");
  if (!isLocalhost && apiBaseUrl.startsWith("http://")) {
    apiBaseUrl = apiBaseUrl.replace("http://", "https://");
  }

  // If URL has params, persist to sessionStorage for refresh resilience
  if (embedToken && merchantId) {
    try {
      sessionStorage.setItem(SESSION_KEY, JSON.stringify({ embedToken, merchantId, cartRef, apiBaseUrl, globalUserId }));
    } catch { /* quota */ }
  } else {
    // No URL params — try to recover from sessionStorage (page refresh)
    try {
      const saved = sessionStorage.getItem(SESSION_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        embedToken = parsed.embedToken || "";
        merchantId = parsed.merchantId || "";
        cartRef = parsed.cartRef || undefined;
        apiBaseUrl = parsed.apiBaseUrl || DEFAULT_API_BASE;
        globalUserId = parsed.globalUserId || undefined;
      }
    } catch { /* corrupted */ }
  }

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

  return { embedToken, merchantId, cartRef, apiBaseUrl, globalUserId };
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

  // Setup behavioral triggers (idle, exit intent).
  // Subscribe to triggerConfig so the effect re-runs when it loads async in init()
  // (was gated on [status] only, which ran before triggerConfig existed → never armed).
  const triggerConfig = useCheckoutStore((s) => s.triggerConfig);
  const triggerMessages = useCheckoutStore((s) => s.triggerMessages);
  useEffect(() => {
    if (!triggerConfig) return;

    const stageMap: Partial<Record<TriggerName, DiscountStage>> = {
      idle_30_seconds: "initial_coupon",
      exit_intent_detected: "exit_intent",
    };

    const onTrigger = (trigger: TriggerName) => {
      const stage = stageMap[trigger];
      if (!stage) return;
      const msg = triggerMessages?.[trigger];
      // Pass the merchant's configured message + coupon so the banner shows them.
      useCheckoutStore.getState().setActiveDiscount(stage, 5, msg?.couponCode, msg?.message);
    };

    const cleanupIdle = setupIdleTrigger(triggerConfig, onTrigger);
    const cleanupExit = setupExitIntentTrigger(triggerConfig, onTrigger);

    return () => {
      cleanupIdle();
      cleanupExit();
    };
  }, [triggerConfig, triggerMessages, status]);

  useEffect(() => {
    const { embedToken, merchantId, cartRef, apiBaseUrl, globalUserId } = readUrlParams();
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
    void init({ embedToken, merchantId, cartRef, apiBaseUrl, globalUserId });
  }, [init]);

  // Issue #1: Set page title with store name
  useEffect(() => {
    if (brand.name) document.title = `Checkout · ${brand.name}`;
  }, [brand.name]);

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
    // Short-form aliases used by inline styles in V2 components
    if (brand.backgroundColor) root.style.setProperty("--bg", brand.backgroundColor);
    if (brand.textColor) root.style.setProperty("--tx", brand.textColor);
    if (brand.mutedTextColor) root.style.setProperty("--mut", brand.mutedTextColor);
    if (brand.borderColor) root.style.setProperty("--bd", brand.borderColor);
    if (brand.surfaceColor) root.style.setProperty("--card", brand.surfaceColor);
    if (brand.successColor) root.style.setProperty("--dot", brand.successColor);
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
    // Background image
    if (brand.backgroundImageUrl) {
      document.body.style.background = `url(${brand.backgroundImageUrl}) center/cover no-repeat fixed`;
      document.body.style.backgroundColor = brand.backgroundColor || "";
    }
    // Favicon
    const favicon = brand.favicon || brand.logoUrl;
    if (favicon) {
      let link = document.querySelector("link[rel='icon']") as HTMLLinkElement;
      if (!link) {
        link = document.createElement("link");
        link.rel = "icon";
        document.head.appendChild(link);
      }
      link.href = favicon;
    }
    // Density → max-width shell
    const density = brand.density;
    if (density === "compact") root.style.setProperty("--aacp-shell-max-width", "480px");
    else if (density === "comfortable") root.style.setProperty("--aacp-shell-max-width", "680px");
    else root.style.setProperty("--aacp-shell-max-width", "100%");
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
    return <MascotOverlay message="Preparando seu checkout..." sub="Só um instante" />;
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
