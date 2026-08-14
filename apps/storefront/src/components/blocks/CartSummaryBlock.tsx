"use client";

import type { CartSummaryBlock as CartSummaryBlockType } from "@/lib/types.js";

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
  const { items, subtotal, discount, total } = block.data;

  return (
    <div
      style={{
        background: "#fff",
        borderRadius: "var(--radius-md)",
        border: "1px solid var(--color-border)",
        padding: 16,
        display: "flex",
        flexDirection: "column",
        gap: 12,
      }}
    >
      <h4
        style={{
          fontSize: 14,
          fontWeight: 600,
          margin: 0,
          color: "var(--color-fg)",
        }}
      >
        Seu carrinho
      </h4>

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {items.map((item) => (
          <div
            key={item.variantId}
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              fontSize: 13,
              color: "var(--color-fg)",
            }}
          >
            <span>
              {item.productName} × {item.quantity}
            </span>
            <span style={{ fontWeight: 500 }}>
              {formatPrice(item.subtotal)}
            </span>
          </div>
        ))}
      </div>

      <div
        style={{
          borderTop: "1px solid var(--color-border)",
          paddingTop: 12,
          display: "flex",
          flexDirection: "column",
          gap: 6,
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            fontSize: 13,
            color: "var(--color-fg-soft)",
          }}
        >
          <span>Subtotal</span>
          <span>{formatPrice(subtotal)}</span>
        </div>
        {discount !== undefined && discount > 0 && (
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              fontSize: 13,
              color: "#16a34a",
            }}
          >
            <span>Desconto</span>
            <span>-{formatPrice(discount)}</span>
          </div>
        )}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            fontSize: 15,
            fontWeight: 600,
            color: "var(--color-fg)",
          }}
        >
          <span>Total</span>
          <span>{formatPrice(total)}</span>
        </div>
      </div>

      <button
        type="button"
        style={{
          width: "100%",
          padding: "10px",
          borderRadius: "var(--radius-sm)",
          border: "none",
          background: "var(--color-primary)",
          color: "#fff",
          fontSize: 14,
          fontWeight: 600,
          cursor: "pointer",
        }}
      >
        Finalizar
      </button>
    </div>
  );
}
