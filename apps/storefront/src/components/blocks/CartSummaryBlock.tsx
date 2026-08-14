"use client";

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
  const { items, subtotal, discount, total } = block.data;

  return (
    <div
      style={{
        background: "var(--aacp-inset-bg)",
        borderRadius: "var(--aacp-radius-md)",
        border: "1px solid var(--aacp-line-strong)",
        padding: "14px 16px",
        display: "flex",
        flexDirection: "column",
        gap: 12,
      }}
    >
      <h4
        style={{
          fontSize: 13,
          fontWeight: 700,
          margin: 0,
          color: "var(--aacp-fg)",
          fontFamily: "var(--aacp-font-display)",
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
              color: "var(--aacp-fg)",
            }}
          >
            <span>
              {item.productName} × {item.quantity}
            </span>
            <span style={{ fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>
              {formatPrice(item.subtotal)}
            </span>
          </div>
        ))}
      </div>

      {/* Totals section */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr auto",
          rowGap: "10px",
          columnGap: "16px",
          padding: "14px 16px",
          background: "var(--aacp-inset-bg)",
          border: "1px solid var(--aacp-line-strong)",
          borderRadius: "var(--aacp-radius-md)",
          fontSize: 13,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        <dt style={{ color: "var(--aacp-muted)", fontWeight: 500 }}>Subtotal</dt>
        <dd
          style={{
            margin: 0,
            fontWeight: 600,
            textAlign: "right",
            color: "var(--aacp-fg)",
            fontFamily: "var(--aacp-font-display)",
          }}
        >
          {formatPrice(subtotal)}
        </dd>

        {discount !== undefined && discount > 0 && (
          <>
            <dt style={{ color: "var(--aacp-success)", fontWeight: 500 }}>
              Desconto
            </dt>
            <dd
              style={{
                margin: 0,
                fontWeight: 700,
                textAlign: "right",
                color: "var(--aacp-success)",
                fontFamily: "var(--aacp-font-display)",
              }}
            >
              -{formatPrice(discount)}
            </dd>
          </>
        )}

        <div
          style={{
            gridColumn: "1 / -1",
            borderTop: "1px solid var(--aacp-line-strong)",
            paddingTop: "12px",
            marginTop: "2px",
            display: "grid",
            gridTemplateColumns: "1fr auto",
            columnGap: "16px",
          }}
        >
          <dt
            style={{
              fontFamily: "var(--aacp-font-display)",
              fontSize: "18px",
              fontWeight: 700,
              color: "var(--aacp-fg)",
            }}
          >
            Total
          </dt>
          <dd
            style={{
              margin: 0,
              fontFamily: "var(--aacp-font-display)",
              fontSize: "18px",
              fontWeight: 700,
              textAlign: "right",
              color: "var(--aacp-accent)",
            }}
          >
            {formatPrice(total)}
          </dd>
        </div>
      </div>

      <button
        type="button"
        style={{
          width: "100%",
          padding: "13px 16px",
          borderRadius: "var(--aacp-radius-md)",
          border: "none",
          background: "var(--aacp-grad-primary)",
          color: "#fff",
          fontSize: 13,
          fontWeight: 800,
          letterSpacing: "0.01em",
          cursor: "pointer",
          fontFamily: "inherit",
          transition: "transform 0.15s ease, box-shadow 0.15s ease",
          boxShadow: "0 12px 28px var(--aacp-accent-shadow), inset 0 1px 0 rgba(255, 255, 255, 0.18)",
        }}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLButtonElement).style.transform = "translateY(-1px)";
          (e.currentTarget as HTMLButtonElement).style.boxShadow =
            "0 16px 32px var(--aacp-accent-shadow-strong)";
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLButtonElement).style.transform = "none";
          (e.currentTarget as HTMLButtonElement).style.boxShadow =
            "0 12px 28px var(--aacp-accent-shadow), inset 0 1px 0 rgba(255, 255, 255, 0.18)";
        }}
      >
        Finalizar
      </button>
    </div>
  );
}
