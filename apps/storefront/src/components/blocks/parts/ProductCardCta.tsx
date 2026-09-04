"use client";

import type { ProductCardBlock as ProductCardBlockType } from "@/lib/types";

type Variant = NonNullable<ProductCardBlockType["data"]["variants"]>[number];

export function ProductCardCta({
  data,
  selectedVariant,
  selectedVariantId,
  buildCtaText,
  onQuickReply,
  addDisabled = false,
  addDisabledReason,
}: {
  data: ProductCardBlockType["data"];
  selectedVariant: Variant | null;
  selectedVariantId: string | null;
  buildCtaText: (verb: string) => string;
  onQuickReply?: (option: string) => void;
  /** Blocks add/buy until required food option groups are chosen. */
  addDisabled?: boolean;
  addDisabledReason?: string;
}) {
  const blocked = !data.inStock || addDisabled;
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
        onClick={() => { if (!blocked) onQuickReply?.(buildCtaText("Adicionar")); }}
        disabled={blocked}
        title={addDisabled ? addDisabledReason : undefined}
        style={{
          width: "100%",
          height: "44px",
          padding: "0 16px",
          borderRadius: "10px",
          border: "none",
          background: !blocked
            ? "var(--aacp-accent)"
            : "color-mix(in srgb, var(--aacp-muted) 30%, var(--aacp-surface-2))",
          color: "#fff",
          fontSize: "14px",
          fontWeight: 700,
          fontFamily: "inherit",
          letterSpacing: "0.01em",
          cursor: !blocked ? "pointer" : "not-allowed",
          opacity: !blocked ? 1 : 0.6,
          transition:
            "transform 0.15s ease, box-shadow 0.15s ease, filter 0.15s ease",
          boxShadow: !blocked
            ? "0 4px 14px color-mix(in srgb, var(--aacp-accent) 30%, transparent)"
            : "none",
        }}
        onMouseEnter={(e) => {
          if (!blocked) {
            e.currentTarget.style.transform = "translateY(-1px)";
            e.currentTarget.style.boxShadow =
              "0 8px 22px color-mix(in srgb, var(--aacp-accent) 42%, transparent)";
            e.currentTarget.style.filter = "brightness(1.05)";
          }
        }}
        onMouseLeave={(e) => {
          if (!blocked) {
            e.currentTarget.style.transform = "none";
            e.currentTarget.style.boxShadow =
              "0 4px 14px color-mix(in srgb, var(--aacp-accent) 30%, transparent)";
            e.currentTarget.style.filter = "none";
          }
        }}
      >
        {!data.inStock
          ? "Produto indisponível"
          : addDisabled
            ? (addDisabledReason ?? "Escolha as opções")
            : "Adicionar ao carrinho"}
      </button>

      <button
        type="button"
        onClick={() => { if (!blocked) onQuickReply?.(buildCtaText("Comprar")); }}
        disabled={blocked}
        style={{
          width: "100%",
          height: "44px",
          padding: "0 16px",
          borderRadius: "10px",
          border: "1.5px solid var(--aacp-accent)",
          background: "transparent",
          color: !blocked ? "var(--aacp-accent)" : "var(--aacp-muted)",
          fontSize: "14px",
          fontWeight: 700,
          fontFamily: "inherit",
          letterSpacing: "0.01em",
          cursor: !blocked ? "pointer" : "not-allowed",
          opacity: !blocked ? 1 : 0.6,
          transition: "all 0.15s ease",
        }}
        onMouseEnter={(e) => {
          if (!blocked) {
            e.currentTarget.style.background =
              "color-mix(in srgb, var(--aacp-accent) 10%, transparent)";
          }
        }}
        onMouseLeave={(e) => {
          if (!blocked) {
            e.currentTarget.style.background = "transparent";
          }
        }}
      >
        Comprar agora
      </button>
    </div>
  );
}
