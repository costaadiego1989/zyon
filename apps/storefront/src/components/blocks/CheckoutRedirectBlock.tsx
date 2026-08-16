"use client";

import { useEffect } from "react";
import type { CheckoutRedirectBlock as CheckoutRedirectBlockType } from "@/lib/types";
import { useCart } from "@/lib/cart-store";

interface CheckoutRedirectBlockProps {
  block: CheckoutRedirectBlockType;
  onOpenCheckout?: (url: string, sessionId: string) => void;
}

export default function CheckoutRedirectBlock({
  block,
  onOpenCheckout,
}: CheckoutRedirectBlockProps) {
  const { url, sessionId } = block.data;
  const { setCheckout } = useCart();

  useEffect(() => {
    setCheckout(url, sessionId);
    if (onOpenCheckout) {
      const timer = setTimeout(() => onOpenCheckout(url, sessionId), 300);
      return () => clearTimeout(timer);
    }
  }, [url, sessionId, setCheckout, onOpenCheckout]);

  return (
    <div
      style={{
        background: "var(--aacp-surface-2)",
        borderRadius: "var(--aacp-radius-md, 12px)",
        border: "1px solid var(--aacp-line)",
        padding: "12px 16px",
        display: "flex",
        alignItems: "center",
        gap: 12,
        animation: "fadeSlideIn 0.35s ease both",
      }}
    >
      <style>{`
        @keyframes fadeSlideIn {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>

      {/* Lock icon */}
      <div
        style={{
          width: "36px",
          height: "36px",
          borderRadius: "50%",
          background: "color-mix(in srgb, var(--aacp-accent) 15%, transparent)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
        }}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--aacp-accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
          <path d="M7 11V7a5 5 0 0 1 10 0v4" />
        </svg>
      </div>

      <div style={{ flex: 1 }}>
        <p style={{ margin: 0, fontSize: "13px", fontWeight: 600, color: "var(--aacp-fg)" }}>
          Checkout seguro
        </p>
        <p style={{ margin: "2px 0 0", fontSize: "11px", color: "var(--aacp-muted)" }}>
          Abrindo pagamento...
        </p>
      </div>

      <div
        style={{
          width: "20px",
          height: "20px",
          border: "2px solid var(--aacp-line)",
          borderTopColor: "var(--aacp-accent)",
          borderRadius: "50%",
          animation: "spin 0.8s linear infinite",
          flexShrink: 0,
        }}
      />
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
