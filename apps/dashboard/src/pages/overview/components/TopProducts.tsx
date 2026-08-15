import React from "react";

export type TopProduct = {
  name: string;
  image_url?: string;
  quantity: number;
  revenue: number;
};

export type TopProductsProps = {
  products: TopProduct[];
};

function formatCurrency(n: number): string {
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2 });
}

export function TopProducts({ products }: TopProductsProps) {
  const top = products.slice(0, 5);

  return (
    <div
      style={{
        background: "var(--card)",
        border: "1px solid var(--border)",
        borderRadius: 14,
        padding: 12,
      }}
    >
      {top.length === 0 ? (
        <div style={{ padding: 16, textAlign: "center", color: "var(--muted)", fontSize: 12 }}>Sem vendas no período</div>
      ) : (
        <ol style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 4 }}>
          {top.map((product, i) => (
            <li
              key={`${product.name}-${i}`}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: "8px 6px",
                borderBottom: i < top.length - 1 ? "1px solid var(--border)" : "none",
              }}
            >
              <span
                aria-hidden
                style={{
                  width: 24,
                  fontSize: 13,
                  fontFamily: "var(--mono)",
                  fontWeight: 700,
                  color: i === 0 ? "var(--accent)" : "var(--muted)",
                  textAlign: "center",
                  flexShrink: 0,
                }}
              >
                {i + 1}
              </span>
              {product.image_url ? (
                <img
                  src={product.image_url}
                  alt=""
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: 999,
                    objectFit: "cover",
                    border: "1px solid var(--border)",
                    flexShrink: 0,
                  }}
                />
              ) : (
                <span
                  aria-hidden
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: 999,
                    background: "var(--color-surface-alt)",
                    border: "1px solid var(--border)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 11,
                    color: "var(--muted)",
                    flexShrink: 0,
                  }}
                >
                  {product.name.slice(0, 1).toUpperCase()}
                </span>
              )}
              <span
                style={{
                  flex: 1,
                  fontSize: 13,
                  color: "var(--ink)",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {product.name}
              </span>
              <span
                style={{
                  fontSize: 11,
                  fontFamily: "var(--mono)",
                  color: "var(--muted)",
                  background: "var(--color-surface-alt)",
                  border: "1px solid var(--border)",
                  borderRadius: 999,
                  padding: "2px 8px",
                  flexShrink: 0,
                }}
              >
                {product.quantity}×
              </span>
              <span
                style={{
                  fontSize: 12,
                  fontFamily: "var(--mono)",
                  fontWeight: 600,
                  color: "var(--ink)",
                  minWidth: 80,
                  textAlign: "right",
                  flexShrink: 0,
                }}
              >
                {formatCurrency(product.revenue)}
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
