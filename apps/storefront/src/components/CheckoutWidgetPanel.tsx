"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useCart } from "@/lib/cart-store";
import { useWidgetConfig } from "@/lib/widget-config";

const WIDGET_BASE_URL =
  process.env.NEXT_PUBLIC_WIDGET_BASE_URL ?? "http://localhost:5173";

interface CheckoutWidgetPanelProps {
  merchantId?: string;
  onClose: () => void;
  onOrderComplete?: (orderId: string) => void;
}

export default function CheckoutWidgetPanel({
  merchantId,
  onClose,
  onOrderComplete,
}: CheckoutWidgetPanelProps) {
  const { cart, clearCheckout } = useCart();
  const { config } = useWidgetConfig();
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [loading, setLoading] = useState(true);
  const [closing, setClosing] = useState(false);

  const widgetUrl = buildWidgetUrl(cart, merchantId, config);

  const handleClose = useCallback(() => {
    setClosing(true);
    setTimeout(() => {
      clearCheckout();
      onClose();
    }, 250);
  }, [clearCheckout, onClose]);

  // Listen for postMessage from widget iframe
  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      const widgetOrigin = new URL(WIDGET_BASE_URL).origin;
      if (event.origin !== widgetOrigin) return;

      const { type, orderId } = event.data ?? {};
      if (type === "aacp:order-completed") {
        onOrderComplete?.(orderId);
        handleClose();
      }
      if (type === "aacp:checkout-close" || type === "CHECKOUT_CLOSE") {
        handleClose();
      }
    }

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [handleClose, onOrderComplete]);

  // Send theme to widget once loaded
  useEffect(() => {
    if (!iframeRef.current || loading) return;
    const accentColor = getComputedStyle(document.documentElement)
      .getPropertyValue("--aacp-accent")
      .trim();
    if (accentColor) {
      iframeRef.current.contentWindow?.postMessage(
        { type: "THEME_UPDATE", payload: { accentColor } },
        new URL(WIDGET_BASE_URL).origin
      );
    }
  }, [loading]);

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 10000,
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "flex-end",
        padding: "16px",
        pointerEvents: "none",
      }}
    >
      {/* Backdrop */}
      <div
        onClick={handleClose}
        style={{
          position: "absolute",
          inset: 0,
          background: "rgba(0, 0, 0, 0.4)",
          backdropFilter: "blur(2px)",
          pointerEvents: "auto",
          opacity: closing ? 0 : 1,
          transition: "opacity 0.25s ease",
        }}
      />

      {/* Panel */}
      <div
        style={{
          position: "relative",
          width: "min(420px, calc(100vw - 32px))",
          height: "min(680px, calc(100vh - 32px))",
          borderRadius: "20px",
          overflow: "hidden",
          boxShadow: "0 24px 64px rgba(0, 0, 0, 0.4), 0 0 0 1px rgba(255, 255, 255, 0.08)",
          pointerEvents: "auto",
          transform: closing ? "translateY(20px) scale(0.96)" : "translateY(0) scale(1)",
          opacity: closing ? 0 : 1,
          transition: "transform 0.3s cubic-bezier(0.22, 1, 0.36, 1), opacity 0.25s ease",
          animation: "widgetSlideUp 0.35s cubic-bezier(0.22, 1, 0.36, 1) both",
        }}
      >
        <style>{`
          @keyframes widgetSlideUp {
            from { transform: translateY(40px) scale(0.95); opacity: 0; }
            to { transform: translateY(0) scale(1); opacity: 1; }
          }
        `}</style>

        {/* Close button */}
        <button
          type="button"
          onClick={handleClose}
          aria-label="Fechar checkout"
          style={{
            position: "absolute",
            top: "12px",
            right: "12px",
            zIndex: 10,
            width: "32px",
            height: "32px",
            borderRadius: "50%",
            border: "none",
            background: "rgba(0, 0, 0, 0.5)",
            color: "#fff",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            backdropFilter: "blur(8px)",
            transition: "background 0.15s ease",
          }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>

        {/* Loading state */}
        {loading && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: "var(--aacp-bg, #08080c)",
              zIndex: 5,
            }}
          >
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "12px" }}>
              <div
                style={{
                  width: "32px",
                  height: "32px",
                  border: "3px solid var(--aacp-line, rgba(255,255,255,0.1))",
                  borderTopColor: "var(--aacp-accent, #0f766e)",
                  borderRadius: "50%",
                  animation: "spin 0.8s linear infinite",
                }}
              />
              <span style={{ fontSize: "12px", color: "var(--aacp-muted, #8b8b95)" }}>
                Carregando checkout...
              </span>
            </div>
            <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
          </div>
        )}

        {/* Widget iframe */}
        <iframe
          ref={iframeRef}
          src={widgetUrl}
          onLoad={() => setLoading(false)}
          title="Checkout"
          allow="payment"
          style={{
            width: "100%",
            height: "100%",
            border: "none",
            borderRadius: "20px",
            background: "var(--aacp-bg, #08080c)",
          }}
        />
      </div>
    </div>
  );
}

function buildWidgetUrl(
  cart: { cartId: string | null; checkoutUrl: string | null; checkoutSessionId: string | null },
  merchantId?: string,
  config?: any
): string {
  // If we have a pre-built checkout URL, use it directly
  if (cart.checkoutUrl) return cart.checkoutUrl;

  // Build URL from parts
  const params = new URLSearchParams();
  if (merchantId) params.set("merchantId", merchantId);
  if (cart.cartId) params.set("cartId", cart.cartId);

  return `${WIDGET_BASE_URL}?${params.toString()}`;
}
