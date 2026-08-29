"use client";

import type { ProductComparisonBlock as ProductComparisonBlockType } from "@/lib/types";

function renderStars(rating?: number) {
  if (rating === undefined) return "—";
  const full = Math.floor(rating);
  const half = rating - full >= 0.5;
  const empty = 5 - full - (half ? 1 : 0);
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        fontSize: 12,
        color: "var(--aacp-warning)",
        fontFamily: "var(--aacp-font-mono)",
      }}
    >
      <span>{"★".repeat(full)}</span>
      {half && <span style={{ opacity: 0.6 }}>{"★"}</span>}
      <span style={{ opacity: 0.25 }}>{"★".repeat(empty)}</span>
      <span style={{ color: "var(--aacp-muted)", marginLeft: 4 }}>{rating.toFixed(1)}</span>
    </span>
  );
}

export default function ProductComparisonBlock({
  block,
  onQuickReply,
}: {
  block: ProductComparisonBlockType;
  onQuickReply?: (text: string) => void;
}) {
  const { products } = block.data;

  const attrKeys = Array.from(
    products.reduce((set, p) => {
      Object.keys(p.attributes).forEach((k) => set.add(k));
      return set;
    }, new Set<string>())
  );

  return (
    <div
      style={{
        borderRadius: "var(--aacp-radius-md)",
        background: "var(--aacp-surface)",
        border: "1px solid var(--aacp-line)",
        overflow: "hidden",
        boxShadow: "var(--aacp-shadow-sm)",
      }}
    >
      <div
        style={{
          overflowX: "auto",
        }}
      >
        <table
          style={{
            width: "100%",
            borderCollapse: "collapse",
            fontSize: 13,
            tableLayout: "fixed",
            minWidth: 110 + products.length * 160,
          }}
        >
          <colgroup>
            <col style={{ width: 110 }} />
            {products.map((p) => (
              <col key={p.id} style={{ width: `calc((100% - 110px) / ${products.length})` }} />
            ))}
          </colgroup>
          <thead>
            <tr>
              <th
                style={{
                  padding: "12px 14px",
                  textAlign: "left",
                  background: "var(--aacp-surface-2)",
                  borderBottom: "1px solid var(--aacp-line-strong)",
                  fontSize: 10,
                  fontWeight: 600,
                  color: "var(--aacp-muted)",
                  textTransform: "uppercase",
                  letterSpacing: 1.2,
                  fontFamily: "var(--aacp-font-mono)",
                  width: 110,
                  position: "sticky",
                  left: 0,
                  zIndex: 1,
                }}
              >
                Comparar
              </th>
              {products.map((p) => (
                <th
                  key={p.id}
                  style={{
                    padding: "12px 14px",
                    textAlign: "left",
                    background: "var(--aacp-surface-2)",
                    borderBottom: "1px solid var(--aacp-line-strong)",
                    borderLeft: "1px solid var(--aacp-line)",
                    fontWeight: 600,
                    color: "var(--aacp-fg)",
                    fontSize: 13,
                    verticalAlign: "top",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: 4,
                    }}
                  >
                    <span
                      style={{
                        fontSize: 13.5,
                        fontWeight: 700,
                        color: "var(--aacp-fg)",
                        lineHeight: 1.3,
                      }}
                    >
                      {p.name}
                    </span>
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {}
            <tr>
              <td
                style={{
                  padding: "10px 14px",
                  borderBottom: "1px solid var(--aacp-line)",
                  fontSize: 11,
                  fontWeight: 600,
                  color: "var(--aacp-muted)",
                  textTransform: "uppercase",
                  letterSpacing: 0.8,
                  fontFamily: "var(--aacp-font-mono)",
                  background: "var(--aacp-surface)",
                  position: "sticky",
                  left: 0,
                }}
              >
                Preco
              </td>
              {products.map((p) => (
                <td
                  key={p.id}
                  style={{
                    padding: "10px 14px",
                    borderBottom: "1px solid var(--aacp-line)",
                    borderLeft: "1px solid var(--aacp-line)",
                    fontWeight: 700,
                    color: "var(--aacp-accent)",
                    fontSize: 15,
                  }}
                >
                  {p.priceFormatted}
                </td>
              ))}
            </tr>

            {}
            {products.some((p) => p.rating !== undefined) && (
              <tr>
                <td
                  style={{
                    padding: "10px 14px",
                    borderBottom: "1px solid var(--aacp-line)",
                    fontSize: 11,
                    fontWeight: 600,
                    color: "var(--aacp-muted)",
                    textTransform: "uppercase",
                    letterSpacing: 0.8,
                    fontFamily: "var(--aacp-font-mono)",
                    background: "var(--aacp-surface)",
                    position: "sticky",
                    left: 0,
                  }}
                >
                  Avaliacao
                </td>
                {products.map((p) => (
                  <td
                    key={p.id}
                    style={{
                      padding: "10px 14px",
                      borderBottom: "1px solid var(--aacp-line)",
                      borderLeft: "1px solid var(--aacp-line)",
                    }}
                  >
                    {renderStars(p.rating)}
                  </td>
                ))}
              </tr>
            )}

            {}
            <tr>
              <td
                style={{
                  padding: "10px 14px",
                  borderBottom: "1px solid var(--aacp-line)",
                  fontSize: 11,
                  fontWeight: 600,
                  color: "var(--aacp-muted)",
                  textTransform: "uppercase",
                  letterSpacing: 0.8,
                  fontFamily: "var(--aacp-font-mono)",
                  background: "var(--aacp-surface)",
                  position: "sticky",
                  left: 0,
                }}
              >
                Estoque
              </td>
              {products.map((p) => (
                <td
                  key={p.id}
                  style={{
                    padding: "10px 14px",
                    borderBottom: "1px solid var(--aacp-line)",
                    borderLeft: "1px solid var(--aacp-line)",
                  }}
                >
                  <span
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 6,
                      padding: "3px 9px",
                      borderRadius: "var(--aacp-radius-pill)",
                      fontSize: 11,
                      fontWeight: 600,
                      background: p.inStock
                        ? "color-mix(in srgb, var(--aacp-success) 14%, transparent)"
                        : "color-mix(in srgb, #dc2626 14%, transparent)",
                      color: p.inStock ? "var(--aacp-success)" : "#dc2626",
                    }}
                  >
                    <span
                      style={{
                        width: 6,
                        height: 6,
                        borderRadius: "50%",
                        background: p.inStock ? "var(--aacp-success)" : "#dc2626",
                      }}
                    />
                    {p.inStock ? "Disponivel" : "Indisponivel"}
                  </span>
                </td>
              ))}
            </tr>

            {}
            {attrKeys.map((key) => (
              <tr key={key}>
                <td
                  style={{
                    padding: "10px 14px",
                    borderBottom: "1px solid var(--aacp-line)",
                    fontSize: 11,
                    fontWeight: 600,
                    color: "var(--aacp-muted)",
                    textTransform: "uppercase",
                    letterSpacing: 0.8,
                    fontFamily: "var(--aacp-font-mono)",
                    background: "var(--aacp-surface)",
                    position: "sticky",
                    left: 0,
                  }}
                >
                  {key}
                </td>
                {products.map((p) => (
                  <td
                    key={p.id}
                    style={{
                      padding: "10px 14px",
                      borderBottom: "1px solid var(--aacp-line)",
                      borderLeft: "1px solid var(--aacp-line)",
                      color: "var(--aacp-fg)",
                      fontSize: 13,
                    }}
                  >
                    {p.attributes[key] || "—"}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {}
      <div
        style={{
          display: "flex",
          gap: 8,
          padding: 12,
          borderTop: "1px solid var(--aacp-line)",
          background: "var(--aacp-surface-2)",
          overflowX: "auto",
        }}
      >
        {products.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => onQuickReply?.(`Adicionar ${p.name}`)}
            disabled={!p.inStock}
            style={{
              flex: 1,
              minWidth: 0,
              padding: "10px 14px",
              borderRadius: "10px",
              border: "none",
              background: p.inStock
                ? "var(--aacp-accent)"
                : "color-mix(in srgb, var(--aacp-muted) 30%, var(--aacp-surface-2))",
              color: p.inStock ? "#fff" : "var(--aacp-muted)",
              fontSize: 12.5,
              fontWeight: 700,
              fontFamily: "var(--aacp-font)",
              cursor: p.inStock ? "pointer" : "not-allowed",
              transition: "box-shadow 160ms ease, transform 160ms ease",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
              boxShadow: p.inStock
                ? "0 4px 14px color-mix(in srgb, var(--aacp-accent) 30%, transparent)"
                : "none",
            }}
            onMouseEnter={(e) => {
              if (!p.inStock) return;
              e.currentTarget.style.boxShadow =
                "0 8px 22px color-mix(in srgb, var(--aacp-accent) 42%, transparent)";
              e.currentTarget.style.transform = "translateY(-1px)";
            }}
            onMouseLeave={(e) => {
              if (!p.inStock) return;
              e.currentTarget.style.boxShadow =
                "0 4px 14px color-mix(in srgb, var(--aacp-accent) 30%, transparent)";
              e.currentTarget.style.transform = "translateY(0)";
            }}
          >
            Adicionar {p.name.length > 18 ? `${p.name.slice(0, 18)}…` : p.name}
          </button>
        ))}
      </div>
    </div>
  );
}
