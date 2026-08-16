"use client";

import { useEffect, useState } from "react";
import type { CartSummaryBlock as CartSummaryBlockType } from "@/lib/types";

function formatPrice(value: number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(value);
}

export default function CartSummaryBlock({
  block,
}: {
  block: CartSummaryBlockType;
}) {
  const { items, total } = block.data;
  const [pulse, setPulse] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => setPulse(false), 2000);
    return () => clearTimeout(timer);
  }, []);

  const itemCount = items.reduce((sum, i) => sum + i.quantity, 0);
  const lastItem = items[items.length - 1];

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
        animation: pulse ? "cartPulse 0.5s ease" : undefined,
      }}
    >
      <style>{`
        @keyframes cartPulse {
          0% { transform: scale(0.95); opacity: 0.7; }
          50% { transform: scale(1.02); }
          100% { transform: scale(1); opacity: 1; }
        }
      `}</style>

      {/* Cart icon */}
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
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="var(--aacp-accent)"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="9" cy="21" r="1" />
          <circle cx="20" cy="21" r="1" />
          <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" />
        </svg>
      </div>

      {/* Info */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <p
          style={{
            margin: 0,
            fontSize: "13px",
            fontWeight: 600,
            color: "var(--aacp-fg)",
            lineHeight: 1.3,
          }}
        >
          {lastItem ? `${lastItem.productName} adicionado` : "Carrinho atualizado"}
        </p>
        <p
          style={{
            margin: "2px 0 0",
            fontSize: "11px",
            color: "var(--aacp-muted)",
          }}
        >
          {itemCount} {itemCount === 1 ? "item" : "itens"} · {formatPrice(total)}
        </p>
      </div>

      {/* Checkmark */}
      <div
        style={{
          width: "24px",
          height: "24px",
          borderRadius: "50%",
          background: "var(--aacp-accent)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
        }}
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="#fff"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polyline points="20 6 9 17 4 12" />
        </svg>
      </div>
    </div>
  );
}
