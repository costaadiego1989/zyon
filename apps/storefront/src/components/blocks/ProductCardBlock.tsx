"use client";

import type { ProductCardBlock as ProductCardBlockType } from "@/lib/types";

function formatPrice(value: number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(value);
}

export default function ProductCardBlock({
  block,
}: {
  block: ProductCardBlockType;
}) {
  const { data } = block;

  return (
    <article
      style={{
        background: "var(--aacp-surface)",
        border: "1px solid var(--aacp-line)",
        borderRadius: "var(--aacp-radius-md)",
        overflow: "hidden",
        boxShadow: "var(--aacp-shadow-sm)",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div
        aria-hidden
        style={{
          width: "100%",
          aspectRatio: "4 / 3",
          background: data.image
            ? `url(${data.image}) center/cover`
            : "var(--aacp-grad-soft)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "var(--aacp-muted)",
          fontSize: 36,
        }}
      >
        {!data.image && "🛍️"}
      </div>
      <div
        style={{
          padding: "12px",
          display: "flex",
          flexDirection: "column",
          gap: 8,
          flex: 1,
        }}
      >
        <h3
          style={{
            fontSize: 14,
            fontWeight: 600,
            margin: 0,
            color: "var(--aacp-fg)",
            fontFamily: "var(--aacp-font-display)",
          }}
        >
          {data.name}
        </h3>

        {data.variants && data.variants.length > 0 && (
          <div style={{ fontSize: 12, color: "var(--aacp-muted)" }}>
            {data.variants.map((v, idx) => (
              <div key={idx} style={{ marginBottom: 4 }}>
                {v.name}: {v.value}
              </div>
            ))}
          </div>
        )}

        {data.rating !== undefined && (
          <div
            style={{
              fontSize: 12,
              color: "var(--aacp-muted)",
            }}
          >
            ⭐ {data.rating} ({data.reviewCount ?? 0} avaliações)
          </div>
        )}

        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginTop: "auto",
          }}
        >
          <span
            style={{
              fontSize: 14,
              fontWeight: 600,
              background: "var(--aacp-grad-bubble-buyer)",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
              backgroundClip: "text",
            }}
          >
            {data.priceFormatted}
          </span>
          <button
            type="button"
            style={{
              padding: "6px 10px",
              borderRadius: "var(--aacp-radius-sm)",
              border: "none",
              background: data.inStock
                ? "var(--aacp-grad-primary)"
                : "var(--aacp-muted)",
              color: "#fff",
              fontSize: 12,
              fontWeight: 600,
              cursor: data.inStock ? "pointer" : "not-allowed",
              opacity: data.inStock ? 1 : 0.6,
              fontFamily: "inherit",
              transition: "transform 160ms ease",
            }}
            onMouseEnter={(e) => {
              if (data.inStock) {
                (e.currentTarget as HTMLButtonElement).style.transform =
                  "translateY(-1px)";
              }
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.transform =
                "translateY(0)";
            }}
          >
            {data.inStock ? "Adicionar" : "Fora de estoque"}
          </button>
        </div>
      </div>
    </article>
  );
}
