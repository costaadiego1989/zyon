"use client";

import type { ProductCardBlock as ProductCardBlockType } from "@/lib/types";

type Variant = NonNullable<ProductCardBlockType["data"]["variants"]>[number];

export function ProductCardCta({
  data,
  selectedVariant,
  selectedVariantId,
  buildCtaText,
  onQuickReply,
}: {
  data: ProductCardBlockType["data"];
  selectedVariant: Variant | null;
  selectedVariantId: string | null;
  buildCtaText: (verb: string) => string;
  onQuickReply?: (option: string) => void;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "8px",
        marginTop: "6px",
      }}
    >
      <button
        type="button"
        onClick={() => onQuickReply?.(buildCtaText("Adicionar"))}
        disabled={!data.inStock}
        style={{
          width: "100%",
          height: "44px",
          padding: "0 16px",
          borderRadius: "10px",
          border: "none",
          background: data.inStock
            ? "var(--aacp-accent)"
            : "color-mix(in srgb, var(--aacp-muted) 30%, var(--aacp-surface-2))",
          color: "#fff",
          fontSize: "14px",
          fontWeight: 700,
          fontFamily: "inherit",
          letterSpacing: "0.01em",
          cursor: data.inStock ? "pointer" : "not-allowed",
          opacity: data.inStock ? 1 : 0.6,
          transition:
            "transform 0.15s ease, box-shadow 0.15s ease, filter 0.15s ease",
          boxShadow: data.inStock
            ? "0 4px 14px color-mix(in srgb, var(--aacp-accent) 30%, transparent)"
            : "none",
        }}
        onMouseEnter={(e) => {
          if (data.inStock) {
            e.currentTarget.style.transform = "translateY(-1px)";
            e.currentTarget.style.boxShadow =
              "0 8px 22px color-mix(in srgb, var(--aacp-accent) 42%, transparent)";
            e.currentTarget.style.filter = "brightness(1.05)";
          }
        }}
        onMouseLeave={(e) => {
          if (data.inStock) {
            e.currentTarget.style.transform = "none";
            e.currentTarget.style.boxShadow =
              "0 4px 14px color-mix(in srgb, var(--aacp-accent) 30%, transparent)";
            e.currentTarget.style.filter = "none";
          }
        }}
      >
        {data.inStock ? "Adicionar ao carrinho" : "Produto indisponível"}
      </button>

      <button
        type="button"
        onClick={() => onQuickReply?.(buildCtaText("Comprar"))}
        disabled={!data.inStock}
        style={{
          width: "100%",
          height: "44px",
          padding: "0 16px",
          borderRadius: "10px",
          border: "1.5px solid var(--aacp-accent)",
          background: "transparent",
          color: data.inStock ? "var(--aacp-accent)" : "var(--aacp-muted)",
          fontSize: "14px",
          fontWeight: 700,
          fontFamily: "inherit",
          letterSpacing: "0.01em",
          cursor: data.inStock ? "pointer" : "not-allowed",
          opacity: data.inStock ? 1 : 0.6,
          transition: "all 0.15s ease",
        }}
        onMouseEnter={(e) => {
          if (data.inStock) {
            e.currentTarget.style.background =
              "color-mix(in srgb, var(--aacp-accent) 10%, transparent)";
          }
        }}
        onMouseLeave={(e) => {
          if (data.inStock) {
            e.currentTarget.style.background = "transparent";
          }
        }}
      >
        Comprar agora
      </button>
    </div>
  );
}
