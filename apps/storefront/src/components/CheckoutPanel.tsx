"use client";

import { useState, useEffect, useRef, useCallback, lazy, Suspense } from "react";
import { useCart } from "@/lib/cart-store";
import { cartApi } from "@/lib/api/api-client";
import { requestStorefrontCheckoutToken } from "@/lib/checkout-session-access";
import { getValidBuyer } from "@/lib/buyer-auth";
import CheckoutErrorBoundary from "./CheckoutErrorBoundary";
import type { OpenCheckoutProductDetail } from "@zyon/widget-v2";

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
  theme?: "dark" | "light";
  onClose: () => void;
  suspended?: boolean;
  onOpenProductDetail?: OpenCheckoutProductDetail;
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
  theme,
  onClose,
  suspended = false,
  onOpenProductDetail,
}: CheckoutPanelProps) {
  // React.lazy caches rejected imports. A fresh mount must be able to retry
  // loading the checkout after a network failure, including after closing it.
  const [InlineCheckout] = useState(createInlineCheckout);
  const effectiveTheme = resolveInitialTheme(theme);
  const tokenContext = JSON.stringify([merchantId, cartRef, initialEmbedToken, recovered]);
  const [issuedToken, setIssuedToken] = useState<{ context: string; value: string } | null>(
    initialEmbedToken ? { context: tokenContext, value: initialEmbedToken } : null,
  );
  // Never render an old tenant/cart token while a context-change effect waits.
  const embedToken = issuedToken?.context === tokenContext ? issuedToken.value : null;
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
    let active = true;
    if (initialEmbedToken) {
      setIssuedToken({ context: tokenContext, value: initialEmbedToken });
      setError(null);
      return;
    }
    setIssuedToken(null);
    const cartRefForToken = cartRef || tokenCartRef.current || undefined;
    if (!cartRefForToken) { setError("Seu carrinho está vazio neste navegador. Volte à loja para adicionar produtos."); return; }
    setError(null);
    requestStorefrontCheckoutToken({ merchantId, cartRef: cartRefForToken })
      .then((value) => { if (active) setIssuedToken({ context: tokenContext, value }); })
      .catch(() => { if (active) setError("Erro ao conectar com servidor de checkout"); });
    // The shared request captures its receipt across remounts; only this view
    // detaches. Do not abort and silently mint another nonce on the next mount.
    return () => { active = false; };
    // Intentionally excludes cart.cartId: see comment above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [merchantId, cartRef, initialEmbedToken, recovered, tokenContext]);

  const refreshEmbedToken = useCallback(async (previousEmbedToken: string): Promise<string | null> => {
    const cartRefForToken = cartRef || tokenCartRef.current || undefined;
    if (!cartRefForToken) return null;
    try {
      return await requestStorefrontCheckoutToken({ merchantId, cartRef: cartRefForToken, previousToken: previousEmbedToken });
    } catch { return null; }
  }, [merchantId, cartRef]);

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
    <div aria-hidden={suspended || undefined} style={{ position: "fixed", inset: 0, zIndex: 9999, background: "var(--aacp-bg, #f7f8fa)", overflow: "hidden", display: suspended ? "none" : "flex", flexDirection: "column" }}>
      <Suspense fallback={<div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--aacp-fg, #f0f0f0)" }}>Carregando...</div>}>
        <InlineCheckout
          embedToken={embedToken}
          merchantId={merchantId}
          apiBaseUrl={apiBase}
          embedApiBaseUrl="/api"
          cartRef={recovered ? undefined : cartRef || tokenCartRef.current || undefined}
          globalUserId={globalUserId}
          buyerAccessToken={getValidBuyer()?.token}
          onRefreshEmbedToken={refreshEmbedToken}
          oneBuyClickPreferences={oneBuyClickPreferences}
          initialChannel="chat"
          theme={effectiveTheme}
          onClose={onClose}
          onOpenProductDetail={onOpenProductDetail}
        />
      </Suspense>
    </div>
  );
}
