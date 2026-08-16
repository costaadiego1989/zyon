"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useCart } from "@/lib/cart-store";
import { useWidgetConfig } from "@/lib/widget-config";

const WIDGET_BASE_URL =
  process.env.NEXT_PUBLIC_WIDGET_BASE_URL ?? "http://localhost:5173";

interface CheckoutWidgetPanelProps {
  merchantId?: string;
  open: boolean;
  onToggle: (open: boolean) => void;
  onOrderComplete?: (orderId: string) => void;
}

export default function CheckoutWidgetPanel({
  merchantId,
  open,
  onToggle,
  onOrderComplete,
}: CheckoutWidgetPanelProps) {
  const { cart } = useCart();
  const { config } = useWidgetConfig();
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [closing, setClosing] = useState(false);
  const sentCartRef = useRef<string>("");

  // Build widget URL with merchantId — widget handles cart internally
  const widgetUrl = `${WIDGET_BASE_URL}?merchantId=${encodeURIComponent(merchantId ?? "")}&ui-presentation=conversational`;

  // Send cart data to widget via postMessage when items change
  useEffect(() => {
    if (!iframeRef.current || !loaded) return;
    const cartKey = JSON.stringify({ id: cart.cartId, items: cart.items });
    if (cartKey === sentCartRef.current) return;
    sentCartRef.current = cartKey;

    const origin = new URL(WIDGET_BASE_URL).origin;
    iframeRef.current.contentWindow?.postMessage(
      {
        type: "CART_UPDATE",
        payload: {
          cartId: cart.cartId,
          items: cart.items.map((i) => ({
            sku: i.variantId,
            name: i.productName,
            price: i.price,
            quantity: i.quantity,
          })),
          total: cart.total,
          itemCount: cart.itemCount,
        },
      },
      origin
    );
  }, [cart, loaded]);

  // Auto-open panel when first item added
  useEffect(() => {
    if (cart.itemCount > 0 && !open && loaded) {
      onToggle(true);
    }
  }, [cart.itemCount]);

  // Listen for postMessage from widget
  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      const origin = new URL(WIDGET_BASE_URL).origin;
      if (event.origin !== origin) return;

      const { type, orderId, session_id } = event.data ?? {};
      if (type === "aacp:order-completed") {
        onOrderComplete?.(orderId ?? session_id);
        handleClose();
      }
    }

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [onOrderComplete]);

  const handleClose = useCallback(() => {
    setClosing(true);
    setTimeout(() => {
      setClosing(false);
      onToggle(false);
    }, 220);
  }, [onToggle]);

  // Send theme on load
  useEffect(() => {
    if (!iframeRef.current || !loaded) return;
    const accent = getComputedStyle(document.documentElement)
      .getPropertyValue("--aacp-accent")
      .trim();
    if (accent) {
      iframeRef.current.contentWindow?.postMessage(
        { type: "THEME_UPDATE", payload: { accentColor: accent } },
        new URL(WIDGET_BASE_URL).origin
      );
    }
  }, [loaded]);

  // FAB position from config
  const position = config?.position ?? "bottom_right";
  const fabColor = config?.fabColor ?? "var(--aacp-accent, #0f766e)";

  const posMap: Record<string, Record<string, string>> = {
    bottom_right: { bottom: "16px", right: "16px" },
    bottom_left: { bottom: "16px", left: "16px" },
    top_right: { top: "16px", right: "16px" },
    top_left: { top: "16px", left: "16px" },
  };
  const fabPos = posMap[position] ?? posMap.bottom_right;

  return (
    <>
      <style>{`
        @keyframes wPanelIn { from { transform: translateY(20px) scale(0.95); opacity: 0; } to { transform: translateY(0) scale(1); opacity: 1; } }
        @keyframes wSpin { to { transform: rotate(360deg); } }
      `}</style>

      {/* FAB — always visible when panel closed */}
      {!open && (
        <button
          type="button"
          onClick={() => onToggle(true)}
          aria-label={`Carrinho${cart.itemCount > 0 ? ` · ${cart.itemCount} itens` : ""}`}
          style={{
            position: "fixed",
            ...fabPos,
            zIndex: 9998,
            width: "52px",
            height: "52px",
            borderRadius: "50%",
            border: "none",
            background: fabColor,
            color: "#fff",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            boxShadow: `0 4px 20px rgba(0,0,0,0.3), 0 0 0 3px color-mix(in srgb, ${fabColor} 20%, transparent)`,
            transition: "transform 0.2s ease, box-shadow 0.2s ease",
          }}
          onMouseEnter={(e) => { e.currentTarget.style.transform = "scale(1.08)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.transform = "scale(1)"; }}
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="9" cy="21" r="1" />
            <circle cx="20" cy="21" r="1" />
            <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" />
          </svg>

          {cart.itemCount > 0 && (
            <span
              style={{
                position: "absolute",
                top: "-3px",
                right: "-3px",
                minWidth: "20px",
                height: "20px",
                borderRadius: "10px",
                background: "#ef4444",
                color: "#fff",
                fontSize: "11px",
                fontWeight: 700,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                padding: "0 5px",
                border: "2px solid var(--aacp-bg, #08080c)",
              }}
            >
              {cart.itemCount}
            </span>
          )}
        </button>
      )}

      {/* Widget panel — positioned same corner, slides up */}
      {open && (
        <div
          style={{
            position: "fixed",
            ...fabPos,
            zIndex: 9999,
            width: "min(400px, calc(100vw - 32px))",
            height: "min(640px, calc(100vh - 80px))",
            borderRadius: "20px",
            overflow: "hidden",
            boxShadow: "0 20px 60px rgba(0, 0, 0, 0.4), 0 0 0 1px rgba(255, 255, 255, 0.06)",
            transform: closing ? "translateY(16px) scale(0.96)" : undefined,
            opacity: closing ? 0 : 1,
            transition: closing ? "transform 0.22s ease, opacity 0.18s ease" : undefined,
            animation: !closing ? "wPanelIn 0.28s cubic-bezier(0.22, 1, 0.36, 1) both" : undefined,
          }}
        >
          {/* Close */}
          <button
            type="button"
            onClick={handleClose}
            aria-label="Fechar carrinho"
            style={{
              position: "absolute",
              top: "10px",
              right: "10px",
              zIndex: 10,
              width: "30px",
              height: "30px",
              borderRadius: "50%",
              border: "none",
              background: "rgba(0, 0, 0, 0.5)",
              color: "#fff",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              backdropFilter: "blur(8px)",
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>

          {/* Loading */}
          {!loaded && (
            <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", background: "var(--aacp-bg, #08080c)", zIndex: 5 }}>
              <div style={{ width: "28px", height: "28px", border: "3px solid var(--aacp-line, rgba(255,255,255,0.1))", borderTopColor: "var(--aacp-accent, #0f766e)", borderRadius: "50%", animation: "wSpin 0.7s linear infinite" }} />
            </div>
          )}

          {/* Widget iframe — always mounted, loads once */}
          <iframe
            ref={iframeRef}
            src={widgetUrl}
            onLoad={() => setLoaded(true)}
            title="Carrinho"
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
      )}
    </>
  );
}
