"use client";

import type { OrderConfirmationBlock as OrderConfirmationBlockType } from "@/lib/types.js";

function formatPrice(value: number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(value);
}

export default function OrderConfirmationBlock({
  block,
}: {
  block: OrderConfirmationBlockType;
}) {
  const { orderId, total, items, estimatedDelivery } = block.data;

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
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
        }}
      >
        <span style={{ fontSize: 24 }}>✅</span>
        <div>
          <h4
            style={{
              fontSize: 14,
              fontWeight: 600,
              margin: 0,
              color: "var(--color-fg)",
            }}
          >
            Pedido confirmado!
          </h4>
          <span style={{ fontSize: 12, color: "var(--color-fg-soft)" }}>
            #{orderId}
          </span>
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {items.map((item, idx) => (
          <div
            key={idx}
            style={{
              display: "flex",
              justifyContent: "space-between",
              fontSize: 13,
              color: "var(--color-fg)",
            }}
          >
            <span>
              {item.productName} × {item.quantity}
            </span>
            <span>{formatPrice(item.price * item.quantity)}</span>
          </div>
        ))}
      </div>

      <div
        style={{
          borderTop: "1px solid var(--color-border)",
          paddingTop: 10,
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

      {estimatedDelivery && (
        <div style={{ fontSize: 12, color: "var(--color-fg-soft)" }}>
          Entrega estimada: {estimatedDelivery}
        </div>
      )}
    </div>
  );
}
