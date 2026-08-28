"use client";
import { useEffect } from "react";
import { useCheckoutStore } from "./store/checkout-store";
import { CheckoutLayout } from "./layouts/CheckoutLayout";
import { MascotOverlay } from "./components/MascotOverlay";
import { setupAbandonmentTracking, trackEvent } from "./lib/tracking";
import { onOrderCompleted } from "./lib/lifecycle";

export interface InlineCheckoutProps {
  embedToken: string;
  merchantId: string;
  apiBaseUrl: string;
  cartRef?: string;
  globalUserId?: string;
  theme?: "dark" | "light";
  onClose?: () => void;
}

export function InlineCheckout(props: InlineCheckoutProps) {
  const status = useCheckoutStore((s) => s.status);
  const error = useCheckoutStore((s) => s.error);
  const init = useCheckoutStore((s) => s.init);
  const brand = useCheckoutStore((s) => s.brand);
  const sessionId = useCheckoutStore((s) => s.sessionId);

  // Initialize store with provided props (not URL)
  useEffect(() => {
    if (!props.embedToken || !props.merchantId) return;
    void init({
      embedToken: props.embedToken,
      merchantId: props.merchantId,
      cartRef: props.cartRef,
      apiBaseUrl: props.apiBaseUrl,
      globalUserId: props.globalUserId,
    });
  }, [init, props.embedToken, props.merchantId]);

  // Apply theme from storefront preference
  useEffect(() => {
    if (props.theme === "light") {
      document.body.classList.add("theme-light");
      document.body.classList.remove("theme-dark");
    } else {
      document.body.classList.add("theme-dark");
      document.body.classList.remove("theme-light");
    }
    return () => {
      document.body.classList.remove("theme-dark", "theme-light");
    };
  }, [props.theme]);

  // Abandonment tracking
  useEffect(() => {
    const cleanup = setupAbandonmentTracking();
    return cleanup;
  }, []);

  useEffect(() => {
    if (status === "completed" && sessionId) {
      void trackEvent("order_completed");
      onOrderCompleted(sessionId);
    }
  }, [status, sessionId]);

  useEffect(() => {
    const root = document.documentElement;
    if (brand.accentColor) root.style.setProperty("--aacp-accent", brand.accentColor);
    if (brand.fontFamily) root.style.setProperty("--aacp-font", brand.fontFamily);
  }, [brand]);

  if (status === "loading") {
    return <MascotOverlay message="Preparando seu checkout..." sub="Só um instante" />;
  }

  if (status === "error") {
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", gap: 12, color: "var(--aacp-fg, #f5f5f7)" }}>
        <h2 style={{ margin: 0 }}>Erro</h2>
        <p style={{ margin: 0, opacity: 0.7, fontSize: 13 }}>{error || "Não foi possível iniciar o checkout."}</p>
        {props.onClose && <button onClick={props.onClose} style={{ marginTop: 12, padding: "8px 16px", borderRadius: 8, border: "1px solid var(--aacp-border-color, #333)", background: "transparent", color: "inherit", cursor: "pointer" }}>Voltar</button>}
      </div>
    );
  }

  return <CheckoutLayout forcedTheme={props.theme} />;
}
