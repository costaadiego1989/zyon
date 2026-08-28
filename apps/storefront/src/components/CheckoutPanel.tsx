"use client";

import { useState, useEffect, lazy, Suspense } from "react";
import { useCart } from "@/lib/cart-store";

interface CheckoutPanelProps {
  merchantId: string;
  globalUserId: string;
  cartRef: string | undefined;
  theme?: "dark" | "light";
  onClose: () => void;
}

// Dynamic import to avoid SSR issues (widget uses browser APIs)
const InlineCheckout = lazy(() =>
  import("@zyon/widget-v2").then((mod) => ({ default: mod.InlineCheckout }))
);

function resolveInitialTheme(propTheme?: "dark" | "light"): "dark" | "light" {
  if (propTheme === "dark" || propTheme === "light") return propTheme;
  // Fall back to the shared theme key the storefront writes, not a hardcoded dark.
  try {
    const saved = localStorage.getItem("zyon-theme");
    if (saved === "dark" || saved === "light") return saved;
  } catch { /* SSR/privacy */ }
  return "light";
}

export default function CheckoutPanel({
  merchantId,
  globalUserId: initialGlobalUserId,
  cartRef,
  theme,
  onClose,
}: CheckoutPanelProps) {
  const effectiveTheme = resolveInitialTheme(theme);
  const [embedToken, setEmbedToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [globalUserId, setGlobalUserId] = useState(initialGlobalUserId);
  const { cart, clearCart } = useCart();

  // When the checkout widget completes an order, clear the storefront cart so
  // the buyer starts fresh next time (session products are cleared post-payment).
  useEffect(() => {
    const onOrderCompleted = () => {
      clearCart();
    };
    window.addEventListener("aacp:order-completed", onOrderCompleted);
    return () => window.removeEventListener("aacp:order-completed", onOrderCompleted);
  }, [clearCart]);

  useEffect(() => {
    if (!initialGlobalUserId) {
      const buyerToken = localStorage.getItem("zyon_buyer_token");
      if (buyerToken) {
        try {
          const payload = JSON.parse(atob(buyerToken.split(".")[1]));
          const userId = payload.sub || payload.globalUserId;
          if (userId) setGlobalUserId(userId);
        } catch {}
      }
    }
  }, [initialGlobalUserId]);

  useEffect(() => {
    fetch("/api/checkout-token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        merchant_id: merchantId,
        cart_ref: cartRef || cart.cartId,
        allowed_origin: typeof window !== "undefined" ? window.location.origin : "",
      }),
    })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data) => {
        if (data.embed_session_token) setEmbedToken(data.embed_session_token);
        else setError("Falha ao iniciar checkout");
      })
      .catch(() => setError("Erro ao conectar com servidor de checkout"));
  }, [merchantId, cartRef, cart.cartId]);

  if (error) {
    return (
      <div style={{ position: "fixed", inset: 0, zIndex: 9999, background: "var(--aacp-bg, #f7f8fa)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
        <p style={{ color: "var(--aacp-fg, #111827)", marginBottom: 16 }}>{error}</p>
        <button onClick={onClose} style={{ padding: "10px 20px", background: "var(--aacp-surface, #ffffff)", border: "1px solid var(--aacp-border-color, #e5e7eb)", color: "var(--aacp-fg, #111827)", borderRadius: 8, cursor: "pointer" }}>
          Voltar
        </button>
      </div>
    );
  }

  if (!embedToken) {
    return (
      <div style={{ position: "fixed", inset: 0, zIndex: 9999, background: "var(--aacp-bg, #f7f8fa)", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--aacp-fg, #111827)" }}>
        Carregando checkout...
      </div>
    );
  }

  const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3009";

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 9999, background: "var(--aacp-bg, #f7f8fa)", overflow: "hidden", display: "flex", flexDirection: "column" }}>
      <button
        onClick={onClose}
        style={{ position: "absolute", top: 12, right: 12, zIndex: 10001, background: "var(--aacp-surface, #ffffff)", border: "1px solid var(--aacp-border-color, #e5e7eb)", color: "var(--aacp-fg, #111827)", borderRadius: 6, padding: "8px 12px", cursor: "pointer", fontSize: 13, fontWeight: 500 }}
      >
        ✕ Voltar
      </button>
      <Suspense fallback={<div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--aacp-fg, #f0f0f0)" }}>Carregando...</div>}>
        <InlineCheckout
          embedToken={embedToken}
          merchantId={merchantId}
          apiBaseUrl={apiBase}
          cartRef={cartRef || cart.cartId || undefined}
          globalUserId={globalUserId}
          theme={effectiveTheme}
          onClose={onClose}
        />
      </Suspense>
    </div>
  );
}
