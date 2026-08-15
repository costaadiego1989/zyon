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
  onQuickReply,
}: {
  block: ProductCardBlockType;
  onQuickReply?: (option: string) => void;
}) {
  const { data } = block;
  const stockStatus = data.inStock ? "Em estoque" : "Esgotado";

  return (
    <article
      style={{
        background: "var(--aacp-surface)",
        border: "1px solid var(--aacp-line)",
        borderRadius: "10px",
        overflow: "hidden",
        boxShadow: "0 2px 8px rgba(0, 0, 0, 0.08)",
        display: "flex",
        flexDirection: "column",
        transition: "border-color 0.18s ease, box-shadow 0.18s ease",
      }}
    >
      {/* Product image — full width, 160px height */}
      <div
        aria-hidden
        style={{
          width: "100%",
          height: "160px",
          background: data.image
            ? `url(${data.image}) center / cover`
            : "linear-gradient(135deg, rgba(15, 118, 110, 0.15), rgba(15, 118, 110, 0.05))",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "var(--aacp-muted)",
          fontSize: "48px",
          position: "relative",
        }}
      >
        {!data.image && "🛍️"}
      </div>

      {/* Card body */}
      <div
        style={{
          padding: "14px 14px 16px",
          display: "flex",
          flexDirection: "column",
          gap: "10px",
          flex: 1,
        }}
      >
        {/* Name */}
        <h3
          style={{
            fontSize: "16px",
            fontWeight: 700,
            margin: 0,
            color: "var(--aacp-fg)",
            lineHeight: 1.35,
            overflow: "hidden",
            textOverflow: "ellipsis",
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
          }}
        >
          {data.name}
        </h3>

        {/* Description (if available) */}
        {/* Variants shown as tags */}
        {data.variants && data.variants.length > 0 && (
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: "6px",
            }}
          >
            {data.variants.slice(0, 2).map((v, idx) => (
              <span
                key={idx}
                style={{
                  fontSize: "10.5px",
                  color: "var(--aacp-muted)",
                  background: "var(--aacp-card)",
                  padding: "4px 8px",
                  borderRadius: "6px",
                  border: "1px solid var(--aacp-line)",
                }}
              >
                {v.name}: {v.value}
              </span>
            ))}
          </div>
        )}

        {/* Rating */}
        {data.rating !== undefined && (
          <div style={{ fontSize: "12px", color: "var(--aacp-muted)" }}>
            ⭐ {data.rating} ({data.reviewCount ?? 0} avaliações)
          </div>
        )}

        {/* Price & Stock */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginTop: "6px",
            paddingTop: "8px",
            borderTop: "1px solid var(--aacp-line)",
          }}
        >
          <span
            style={{
              fontSize: "18px",
              fontWeight: 800,
              color: "var(--aacp-accent)",
            }}
          >
            {data.priceFormatted}
          </span>
          <span
            style={{
              fontSize: "10px",
              fontWeight: 600,
              padding: "4px 8px",
              borderRadius: "4px",
              background: data.inStock
                ? "color-mix(in srgb, var(--aacp-success) 15%, transparent)"
                : "color-mix(in srgb, #ef4444 15%, transparent)",
              color: data.inStock ? "var(--aacp-success)" : "#ef4444",
              border: `1px solid ${data.inStock ? "color-mix(in srgb, var(--aacp-success) 30%, transparent)" : "color-mix(in srgb, #ef4444 30%, transparent)"}`,
              textTransform: "uppercase",
              letterSpacing: "0.3px",
            }}
          >
            {stockStatus}
          </span>
        </div>

        {/* Action buttons */}
        <div
          style={{
            display: "flex",
            gap: "8px",
            marginTop: "10px",
          }}
        >
          <button
            type="button"
            onClick={() => onQuickReply?.(`Detalhes ${data.name}`)}
            style={{
              flex: 1,
              padding: "9px 12px",
              borderRadius: "8px",
              border: "1px solid var(--aacp-accent)",
              background: "transparent",
              color: "var(--aacp-accent)",
              fontSize: "12px",
              fontWeight: 600,
              cursor: "pointer",
              fontFamily: "inherit",
              transition: "all 0.15s ease",
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLButtonElement).style.background =
                "color-mix(in srgb, var(--aacp-accent) 8%, transparent)";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.background =
                "transparent";
            }}
          >
            Detalhes
          </button>
          <button
            type="button"
            onClick={() => onQuickReply?.(`Adicionar ${data.name} ao carrinho`)}
            disabled={!data.inStock}
            style={{
              flex: 1,
              padding: "9px 12px",
              borderRadius: "8px",
              border: "none",
              background: data.inStock
                ? "var(--aacp-accent)"
                : "var(--aacp-muted)",
              color: "#fff",
              fontSize: "12px",
              fontWeight: 600,
              cursor: data.inStock ? "pointer" : "not-allowed",
              opacity: data.inStock ? 1 : 0.5,
              fontFamily: "inherit",
              transition: "all 0.15s ease",
            }}
            onMouseEnter={(e) => {
              if (data.inStock) {
                (e.currentTarget as HTMLButtonElement).style.transform =
                  "translateY(-1px)";
                (e.currentTarget as HTMLButtonElement).style.boxShadow =
                  "0 4px 12px color-mix(in srgb, var(--aacp-accent) 40%, transparent)";
              }
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.transform = "none";
              (e.currentTarget as HTMLButtonElement).style.boxShadow = "none";
            }}
          >
            🛒 Adicionar
          </button>
        </div>

        {/* Secondary button: "Ver mais opções" (secondary) */}
        <button
          type="button"
          onClick={() => onQuickReply?.(`Ver mais opções ${data.name}`)}
          style={{
            padding: "8px 12px",
            borderRadius: "8px",
            border: "1px solid var(--aacp-line)",
            background: "transparent",
            color: "var(--aacp-muted)",
            fontSize: "11.5px",
            fontWeight: 500,
            cursor: "pointer",
            fontFamily: "inherit",
            transition: "all 0.15s ease",
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLButtonElement).style.color =
              "var(--aacp-fg)";
            (e.currentTarget as HTMLButtonElement).style.borderColor =
              "var(--aacp-accent)";
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLButtonElement).style.color =
              "var(--aacp-muted)";
            (e.currentTarget as HTMLButtonElement).style.borderColor =
              "var(--aacp-line)";
          }}
        >
          Ver mais opções
        </button>
      </div>
    </article>
  );
}
