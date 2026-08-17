"use client";

import { useEffect, useState } from "react";
import { useCart } from "@/lib/cart-store";
import { useWidgetConfig } from "@/lib/widget-config";

interface CartFABProps {
  onClick: () => void;
}

function formatPrice(value: number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(value);
}

export default function CartFAB({ onClick }: CartFABProps) {
  const { cart } = useCart();
  const { config } = useWidgetConfig();
  const [mounted, setMounted] = useState(false);
  const [pulse, setPulse] = useState(false);
  const [prevCount, setPrevCount] = useState(0);

  const position = config?.position ?? "bottom_right";
  const fabColor = config?.fabColor ?? "var(--aacp-accent, #0f766e)";

  const positionStyles: Record<string, { bottom?: string; top?: string; left?: string; right?: string }> = {
    bottom_right: { bottom: "120px", right: "16px" },
    bottom_left: { bottom: "120px", left: "16px" },
    top_right: { top: "16px", right: "16px" },
    top_left: { top: "16px", left: "16px" },
  };
  const posStyle = positionStyles[position] ?? positionStyles.bottom_right;

  useEffect(() => {
    requestAnimationFrame(() => setMounted(true));
  }, []);

  useEffect(() => {
    if (cart.itemCount > prevCount && prevCount > 0) {
      setPulse(true);
      const timer = setTimeout(() => setPulse(false), 600);
      return () => clearTimeout(timer);
    }
    setPrevCount(cart.itemCount);
  }, [cart.itemCount, prevCount]);

  if (cart.itemCount === 0) return null;

  return (
    <>
      <style>{`
        @keyframes cartFabIn { from { transform: scale(0) translateY(10px); opacity: 0; } to { transform: scale(1) translateY(0); opacity: 1; } }
        @keyframes cartPulseRing { 0% { transform: scale(1); opacity: 0.6; } 100% { transform: scale(1.8); opacity: 0; } }
        @keyframes badgePop { 0% { transform: scale(0.5); } 60% { transform: scale(1.2); } 100% { transform: scale(1); } }
      `}</style>

      <button
        type="button"
        onClick={onClick}
        aria-label={`Carrinho: ${cart.itemCount} ${cart.itemCount === 1 ? "item" : "itens"}, total ${formatPrice(cart.total)}`}
        style={{
          position: "fixed",
          ...posStyle,
          zIndex: 9998,
          display: "flex",
          alignItems: "center",
          gap: "8px",
          padding: "0 16px 0 14px",
          height: "48px",
          borderRadius: "24px",
          border: "none",
          background: fabColor,
          color: "#fff",
          cursor: "pointer",
          boxShadow: `0 4px 20px rgba(0,0,0,0.25), 0 0 0 3px color-mix(in srgb, ${fabColor} 18%, transparent)`,
          fontFamily: "inherit",
          fontSize: "13px",
          fontWeight: 600,
          transform: mounted ? "scale(1) translateY(0)" : "scale(0) translateY(10px)",
          opacity: mounted ? 1 : 0,
          transition: "transform 0.3s cubic-bezier(0.22, 1, 0.36, 1), opacity 0.25s ease, box-shadow 0.2s ease",
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.boxShadow = `0 8px 28px rgba(0,0,0,0.35), 0 0 0 4px color-mix(in srgb, ${fabColor} 25%, transparent)`;
          e.currentTarget.style.transform = "scale(1.03) translateY(-1px)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.boxShadow = `0 4px 20px rgba(0,0,0,0.25), 0 0 0 3px color-mix(in srgb, ${fabColor} 18%, transparent)`;
          e.currentTarget.style.transform = "scale(1) translateY(0)";
        }}
      >
        {/* Pulse ring on add */}
        {pulse && (
          <span
            style={{
              position: "absolute",
              inset: 0,
              borderRadius: "24px",
              border: `2px solid ${fabColor}`,
              animation: "cartPulseRing 0.6s ease-out forwards",
              pointerEvents: "none",
            }}
          />
        )}

        {/* Cart icon */}
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="9" cy="21" r="1" />
          <circle cx="20" cy="21" r="1" />
          <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" />
        </svg>

        {/* Total */}
        <span style={{ fontVariantNumeric: "tabular-nums", letterSpacing: "-0.01em" }}>
          {formatPrice(cart.total)}
        </span>

        {/* Item count badge */}
        <span
          style={{
            position: "absolute",
            top: "-4px",
            right: "-4px",
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
            animation: pulse ? "badgePop 0.4s ease" : undefined,
          }}
        >
          {cart.itemCount}
        </span>
      </button>
    </>
  );
}
