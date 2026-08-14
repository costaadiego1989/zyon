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
        border: "1px solid var(--aacp-line-strong)",
        borderRadius: "var(--aacp-radius-md)",
        overflow: "hidden",
        boxShadow: "var(--aacp-shadow-sm)",
        display: "flex",
        flexDirection: "column",
        transition: "border-color 0.18s ease, box-shadow 0.18s ease",
      }}
    >
      {/* Product image */}
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

      {/* Card body */}
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
            fontWeight: 700,
            margin: 0,
            color: "var(--aacp-fg)",
            fontFamily: "var(--aacp-font-display)",
            letterSpacing: "-0.02em",
            lineHeight: 1.25,
          }}
        >
          {data.name}
        </h3>

        {data.variants && data.variants.length > 0 && (
          <div style={{ fontSize: 11, color: "var(--aacp-muted)" }}>
            {data.variants.map((v, idx) => (
              <div key={idx} style={{ marginBottom: 2 }}>
                {v.name}: {v.value}
              </div>
            ))}
          </div>
        )}

        {data.rating !== undefined && (
          <div style={{ fontSize: 12, color: "var(--aacp-muted)" }}>
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
              fontSize: 13,
              fontWeight: 800,
              color: "var(--aacp-accent)",
              fontFamily: "var(--aacp-font-display)",
            }}
          >
            {data.priceFormatted}
          </span>
          <button
            type="button"
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "6px",
              minWidth: "104px",
              padding: "10px 14px",
              borderRadius: "var(--aacp-radius-md)",
              border: "none",
              background: data.inStock
                ? "var(--aacp-accent)"
                : "var(--aacp-muted)",
              color: "#fff",
              fontSize: 12,
              fontWeight: 800,
              cursor: data.inStock ? "pointer" : "not-allowed",
              opacity: data.inStock ? 1 : 0.55,
              fontFamily: "inherit",
              transition: "transform 0.15s ease, box-shadow 0.15s ease",
            }}
            onMouseEnter={(e) => {
              if (data.inStock) {
                (e.currentTarget as HTMLButtonElement).style.transform =
                  "translateY(-1px)";
                (e.currentTarget as HTMLButtonElement).style.boxShadow =
                  "0 6px 16px var(--aacp-accent-shadow-strong)";
              }
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.transform = "none";
              (e.currentTarget as HTMLButtonElement).style.boxShadow = "none";
            }}
          >
            {data.inStock ? "Adicionar" : "Fora de estoque"}
          </button>
        </div>
      </div>
    </article>
  );
}
