"use client";

import { useState, useEffect, useRef, lazy, Suspense } from "react";
import { useCart } from "@/lib/cart-store";
import { cartApi } from "@/lib/api/api-client";
import { conversationFetch } from "@/lib/conversation-access";
import { getValidBuyer } from "@/lib/buyer-auth";
import CheckoutErrorBoundary from "./CheckoutErrorBoundary";

interface CheckoutPanelProps {
  merchantId: string;
  globalUserId: string;
  cartRef: string | undefined;
  initialEmbedToken?: string;
  recovered?: boolean;
  oneBuyClickPreferences?: {
    shippingPreference: "fastest" | "cheapest";
    paymentPreference: "pix" | "card";
  };
  initialChannel?: "chat" | "voice";
  theme?: "dark" | "light";
  onClose: () => void;
}

const createInlineCheckout = () => lazy(() =>
  import("@zyon/widget-v2").then((mod) => ({ default: mod.InlineCheckout }))
);

function resolveInitialTheme(propTheme?: "dark" | "light"): "dark" | "light" {
  if (propTheme === "dark" || propTheme === "light") return propTheme;
  try {
    const saved = localStorage.getItem("zyon-theme");
    if (saved === "dark" || saved === "light") return saved;
  } catch {  }
  return "light";
}

export default function CheckoutPanel(props: CheckoutPanelProps) {
  const [attempt, setAttempt] = useState(0);

  return (
    <CheckoutErrorBoundary key={attempt} onClose={props.onClose} onRetry={() => setAttempt((value) => value + 1)}>
      <CheckoutPanelContent {...props} />
    </CheckoutErrorBoundary>
  );
}

function CheckoutPanelContent({
  merchantId,
  globalUserId: initialGlobalUserId,
  cartRef,
  initialEmbedToken,
  recovered = false,
  oneBuyClickPreferences,
  initialChannel,
  theme,
  onClose,
}: CheckoutPanelProps) {
  // React.lazy caches rejected imports. A fresh mount must be able to retry
  // loading the checkout after a network failure, including after closing it.
  const [InlineCheckout] = useState(createInlineCheckout);
  const effectiveTheme = resolveInitialTheme(theme);
  const [embedToken, setEmbedToken] = useState<string | null>(initialEmbedToken ?? null);
  const [error, setError] = useState<string | null>(null);
  const [globalUserId, setGlobalUserId] = useState(initialGlobalUserId);
  const { cart, clearCart } = useCart();

  useEffect(() => {
    const onOrderCompleted = () => {
      if (recovered) return;
      const cid = cart.cartId;
      if (cid && merchantId) void cartApi.clear(cid, merchantId).catch(() => {});
      clearCart();
    };
    window.addEventListener("aacp:order-completed", onOrderCompleted);
    return () => window.removeEventListener("aacp:order-completed", onOrderCompleted);
  }, [clearCart, cart.cartId, merchantId, recovered]);

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

  const tokenCartRef = useRef<string | null>(null);
  if (tokenCartRef.current === null) {
    tokenCartRef.current = recovered ? "" : cartRef || cart.cartId || "";
  }
  useEffect(() => {
    if (initialEmbedToken) return;
    const cartRefForToken = cartRef || tokenCartRef.current || undefined;
    if (!cartRefForToken) { setError("Seu carrinho está vazio neste navegador. Volte à loja para adicionar produtos."); return; }
    setError(null);
    conversationFetch(cartRefForToken ?? "", "/api/checkout-token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        merchant_id: merchantId,
        cart_ref: cartRefForToken,
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
    // Intentionally excludes cart.cartId: see comment above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [merchantId, cartRef, initialEmbedToken]);

  if (error) {
    return (
      <div style={{ position: "fixed", inset: 0, zIndex: 9999, background: "var(--aacp-bg, #f7f8fa)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
        <p style={{ color: "var(--aacp-fg, #111827)", marginBottom: 16 }}>{error}</p>
        <button data-neu="control" onClick={onClose} style={{ padding: "10px 20px", background: "var(--aacp-surface, #ffffff)", border: "1px solid var(--aacp-border-color, #e5e7eb)", color: "var(--aacp-fg, #111827)", borderRadius: 8, cursor: "pointer" }}>
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
      <Suspense fallback={<div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--aacp-fg, #f0f0f0)" }}>Carregando...</div>}>
        <InlineCheckout
          embedToken={embedToken}
          merchantId={merchantId}
          apiBaseUrl={apiBase}
          embedApiBaseUrl="/api"
          cartRef={recovered ? undefined : cartRef || tokenCartRef.current || undefined}
          globalUserId={globalUserId}
          buyerAccessToken={getValidBuyer()?.token}
          oneBuyClickPreferences={oneBuyClickPreferences}
          initialChannel={initialChannel}
          theme={effectiveTheme}
          onClose={onClose}
        />
      </Suspense>
    </div>
  );
}
