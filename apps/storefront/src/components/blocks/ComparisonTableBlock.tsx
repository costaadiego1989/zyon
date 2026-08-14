"use client";

import type { ComparisonTableBlock as ComparisonTableBlockType } from "@/lib/types.js";

function formatPrice(value: number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(value);
}

export default function ComparisonTableBlock({
  block,
}: {
  block: ComparisonTableBlockType;
}) {
  const { products, attributes } = block.data;
  const hasRatings = products.some((p) => p.rating !== undefined);

  return (
    <div
      style={{
        overflowX: "auto",
        borderRadius: "var(--radius-md)",
        border: "1px solid var(--color-border)",
        background: "#fff",
      }}
    >
      <table
        style={{
          width: "100%",
          borderCollapse: "collapse",
          fontSize: 13,
        }}
      >
        <thead>
          <tr style={{ background: "var(--color-bg-soft)" }}>
            <th
              style={{
                padding: "10px 12px",
                textAlign: "left",
                borderBottom: "1px solid var(--color-border)",
                fontWeight: 600,
                color: "var(--color-fg-soft)",
              }}
            >
              Atributo
            </th>
            {products.map((p) => (
              <th
                key={p.id}
                style={{
                  padding: "10px 12px",
                  textAlign: "center",
                  borderBottom: "1px solid var(--color-border)",
                  fontWeight: 600,
                  color: "var(--color-fg)",
                  minWidth: 100,
                }}
              >
                {p.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr>
            <td
              style={{
                padding: "8px 12px",
                borderBottom: "1px solid var(--color-border)",
                fontWeight: 500,
                color: "var(--color-fg-soft)",
              }}
            >
              Preço
            </td>
            {products.map((p) => (
              <td
                key={p.id}
                style={{
                  padding: "8px 12px",
                  borderBottom: "1px solid var(--color-border)",
                  textAlign: "center",
                  fontWeight: 600,
                  color: "var(--color-primary)",
                }}
              >
                {formatPrice(p.price)}
              </td>
            ))}
          </tr>
          <tr>
            <td
              style={{
                padding: "8px 12px",
                borderBottom: "1px solid var(--color-border)",
                fontWeight: 500,
                color: "var(--color-fg-soft)",
              }}
            >
              Estoque
            </td>
            {products.map((p) => (
              <td
                key={p.id}
                style={{
                  padding: "8px 12px",
                  borderBottom: "1px solid var(--color-border)",
                  textAlign: "center",
                  color: p.stock > 0 ? "#16a34a" : "#dc2626",
                }}
              >
                {p.stock > 0 ? `${p.stock} un` : "Indisponível"}
              </td>
            ))}
          </tr>
          {hasRatings && (
            <tr>
              <td
                style={{
                  padding: "8px 12px",
                  borderBottom: "1px solid var(--color-border)",
                  fontWeight: 500,
                  color: "var(--color-fg-soft)",
                }}
              >
                Avaliação
              </td>
              {products.map((p) => (
                <td
                  key={p.id}
                  style={{
                    padding: "8px 12px",
                    borderBottom: "1px solid var(--color-border)",
                    textAlign: "center",
                  }}
                >
                  {p.rating ? `⭐ ${p.rating}` : "—"}
                </td>
              ))}
            </tr>
          )}
          {attributes.map((attr) => (
            <tr key={attr}>
              <td
                style={{
                  padding: "8px 12px",
                  borderBottom: "1px solid var(--color-border)",
                  fontWeight: 500,
                  color: "var(--color-fg-soft)",
                }}
              >
                {attr}
              </td>
              {products.map((p) => (
                <td
                  key={p.id}
                  style={{
                    padding: "8px 12px",
                    borderBottom: "1px solid var(--color-border)",
                    textAlign: "center",
                    color: "var(--color-fg)",
                  }}
                >
                  {p.attributes[attr] || "—"}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
