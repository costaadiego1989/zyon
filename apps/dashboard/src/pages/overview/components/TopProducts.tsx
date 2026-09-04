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

function formatCurrency(n: number | null | undefined): string {
  return (n ?? 0).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 2,
  });
}

export function TopProducts({ products }: TopProductsProps) {
  if (!products || products.length === 0) return null;
  const top = products.slice(0, 5);
  const maxRevenue = Math.max(...top.map((p) => p.revenue), 1);

  return (
    <div
      style={{
        background: "var(--surface-2)",
        border: "1px solid var(--color-border)",
        borderRadius: 14,
        padding: 20,
        display: "flex",
        flexDirection: "column",
        gap: 16,
      }}
    >
      <h3
        style={{
          fontSize: 14,
          fontWeight: 700,
          color: "var(--color-brand)",
          margin: 0,
          fontFamily: "var(--font-sans)",
          letterSpacing: -0.3,
        }}
      >
        Top Produtos
      </h3>

      {top.length === 0 ? (
        <div
          style={{
            padding: 24,
            textAlign: "center",
            color: "var(--color-text-muted)",
            fontSize: 12,
          }}
        >
          Sem vendas no período
        </div>
      ) : (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 12,
          }}
        >
          {top.map((product, i) => {
            const progressWidth = (product.revenue / maxRevenue) * 100;
            const rankColors = ["var(--color-brand)", "var(--color-success)", "var(--color-warning)", "var(--color-text-muted)", "var(--color-text-muted)"];

            return (
              <div
                key={`${product.name}-${i}`}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  padding: "10px 0",
                  borderBottom:
                    i < top.length - 1 ? "1px solid var(--color-border)" : "none",
                }}
              >
                {/* Rank badge */}
                <span
                  style={{
                    width: 26,
                    height: 26,
                    borderRadius: 8,
                    background: rankColors[i] + "1a",
                    border: `1px solid ${rankColors[i]}33`,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 12,
                    fontFamily: "var(--font-mono)",
                    fontWeight: 800,
                    color: rankColors[i],
                    flexShrink: 0,
                  }}
                >
                  {i + 1}
                </span>

                {/* Product image or initial */}
                {product.image_url ? (
                  <img
                    src={product.image_url}
                    alt=""
                    style={{
                      width: 36,
                      height: 36,
                      borderRadius: 10,
                      objectFit: "cover",
                      border: "1px solid var(--color-border)",
                      flexShrink: 0,
                    }}
                  />
                ) : (
                  <span
                    aria-hidden
                    style={{
                      width: 36,
                      height: 36,
                      borderRadius: 10,
                      background: "oklch(16% 0.003 145)",
                      border: "1px solid var(--color-border)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 13,
                      color: "var(--color-text-muted)",
                      fontWeight: 700,
                      flexShrink: 0,
                    }}
                  >
                    {(product.name || "?").slice(0, 1).toUpperCase()}
                  </span>
                )}

                {/* Name and progress */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: 13,
                      color: "var(--color-text)",
                      fontWeight: 500,
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      marginBottom: 6,
                    }}
                  >
                    {product.name}
                  </div>
                  {/* Revenue progress bar */}
                  <div
                    style={{
                      width: "100%",
                      height: 4,
                      background: "oklch(22% 0.006 145)",
                      borderRadius: 999,
                      overflow: "hidden",
                    }}
                  >
                    <div
                      style={{
                        width: `${progressWidth}%`,
                        height: "100%",
                        background: rankColors[i],
                        borderRadius: 999,
                        transition: "width 500ms cubic-bezier(0.16,1,0.3,1)",
                        opacity: 0.7,
                      }}
                    />
                  </div>
                </div>

                {/* Quantity */}
                <span
                  style={{
                    fontSize: 11,
                    fontFamily: "var(--font-mono)",
                    color: "var(--color-text-muted)",
                    background: "oklch(16% 0.003 145)",
                    border: "1px solid var(--color-border)",
                    borderRadius: 6,
                    padding: "3px 8px",
                    flexShrink: 0,
                    fontWeight: 600,
                  }}
                >
                  {product.quantity}x
                </span>

                {/* Revenue */}
                <span
                  style={{
                    fontSize: 12,
                    fontFamily: "var(--font-mono)",
                    fontWeight: 700,
                    color: "var(--color-text)",
                    minWidth: 85,
                    textAlign: "right",
                    flexShrink: 0,
                  }}
                >
                  {formatCurrency(product.revenue)}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
