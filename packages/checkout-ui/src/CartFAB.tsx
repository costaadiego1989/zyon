import React, { useEffect, useState } from "react";
import type { CartFABProps } from "./types";

function formatPrice(value: number): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);
}

export function CartFAB({ itemCount, total, onClick }: CartFABProps) {
  const [pulse, setPulse] = useState(false);
  const [prevCount, setPrevCount] = useState(itemCount);

  useEffect(() => {
    if (itemCount > prevCount) {
      setPulse(true);
      const t = setTimeout(() => setPulse(false), 600);
      return () => clearTimeout(t);
    }
    setPrevCount(itemCount);
  }, [itemCount, prevCount]);

  return (
    <>
      <style>{`
        @keyframes ckui-pulse { 0%{box-shadow:0 0 0 0 var(--aacp-accent,#0f766e)} 70%{box-shadow:0 0 0 10px transparent} 100%{box-shadow:0 0 0 0 transparent} }
        @keyframes ckui-badge-pop { 0%{transform:scale(0.5)} 60%{transform:scale(1.2)} 100%{transform:scale(1)} }
      `}</style>
      <button
        type="button"
        onClick={onClick}
        aria-label={itemCount > 0 ? `Carrinho: ${itemCount} itens, ${formatPrice(total)}` : "Carrinho"}
        style={{
          position: "fixed",
          bottom: "80px",
          right: "16px",
          zIndex: 9998,
          width: "48px",
          height: "48px",
          borderRadius: "50%",
          border: "none",
          background: "var(--aacp-accent, #0f766e)",
          color: "#fff",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          boxShadow: "0 4px 16px rgba(0,0,0,0.25)",
          transition: "transform 0.2s ease",
          animation: pulse ? "ckui-pulse 0.6s ease" : undefined,
        }}
        onMouseEnter={(e) => { e.currentTarget.style.transform = "scale(1.08)"; }}
        onMouseLeave={(e) => { e.currentTarget.style.transform = "scale(1)"; }}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="9" cy="21" r="1" />
          <circle cx="20" cy="21" r="1" />
          <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" />
        </svg>

        {itemCount > 0 && (
          <span
            style={{
              position: "absolute",
              top: "-3px",
              right: "-3px",
              minWidth: "18px",
              height: "18px",
              borderRadius: "9px",
              background: "#ef4444",
              color: "#fff",
              fontSize: "10px",
              fontWeight: 700,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: "0 4px",
              border: "2px solid var(--aacp-bg, #08080c)",
              animation: pulse ? "ckui-badge-pop 0.4s ease" : undefined,
            }}
          >
            {itemCount}
          </span>
        )}
      </button>
    </>
  );
}
