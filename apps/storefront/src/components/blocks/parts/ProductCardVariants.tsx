"use client";

import type { ProductCardBlock as ProductCardBlockType } from "@/lib/types";
import { colorFromToken, isLightHex } from "@/lib/utils/color";

type Variant = NonNullable<ProductCardBlockType["data"]["variants"]>[number];

export function ProductCardVariants({
  variants,
  selectedVariantId,
  setSelectedVariantId,
  variantsAreColors,
  selectedVariant,
  detailed,
}: {
  variants: Variant[];
  selectedVariantId: string | null;
  setSelectedVariantId: (id: string) => void;
  variantsAreColors: boolean;
  selectedVariant: Variant | null;
  detailed?: boolean;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "8px",
        paddingTop: "4px",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "8px",
        }}
      >
        <span
          style={{
            fontSize: "11px",
            fontWeight: 600,
            color: "var(--aacp-muted)",
            textTransform: "uppercase",
            letterSpacing: "0.08em",
            fontFamily: "var(--aacp-font-display)",
          }}
        >
          {variants[0]?.name || "Variantes"} ({variants.length})
        </span>
        {selectedVariant && (
          <span
            style={{
              fontSize: "12px",
              fontWeight: 700,
              color: "var(--aacp-accent)",
            }}
          >
            {selectedVariant.priceFormatted ?? (selectedVariant.price ? new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(selectedVariant.price / 100) : null)}
          </span>
        )}
      </div>

      {variantsAreColors ? (
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: "8px",
            alignItems: "center",
          }}
        >
          {variants.map((v) => {
            const isSelected = v.id === selectedVariantId;
            const color = colorFromToken(v.value);
            const light = isLightHex(color);
            return (
              <button
                key={v.id}
                type="button"
                aria-pressed={isSelected}
                aria-label={v.value}
                title={`${v.name}: ${v.value}`}
                onClick={() => setSelectedVariantId(v.id)}
                style={{
                  position: "relative",
                  width: "28px",
                  height: "28px",
                  borderRadius: "50%",
                  border: isSelected
                    ? "2px solid var(--aacp-accent)"
                    : light
                    ? "1px solid var(--aacp-line)"
                    : "1px solid color-mix(in srgb, #ffffff 20%, transparent)",
                  background: color,
                  cursor: "pointer",
                  padding: 0,
                  boxShadow: isSelected
                    ? "0 0 0 3px color-mix(in srgb, var(--aacp-accent) 22%, transparent), inset 0 0 0 2px var(--aacp-surface)"
                    : "none",
                  transition: "transform 0.15s ease, box-shadow 0.15s ease",
                  transform: isSelected ? "scale(1.08)" : "scale(1)",
                }}
                onMouseEnter={(e) => {
                  if (!isSelected) {
                    e.currentTarget.style.transform = "scale(1.08)";
                  }
                }}
                onMouseLeave={(e) => {
                  if (!isSelected) {
                    e.currentTarget.style.transform = "scale(1)";
                  }
                }}
              />
            );
          })}
        </div>
      ) : (
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: "6px",
            alignItems: "center",
          }}
        >
          {variants.map((v) => {
            const isSelected = v.id === selectedVariantId;
            const outOfStock = detailed && v.stock !== undefined && v.stock <= 0;
            const stockLabel = detailed && v.stock !== undefined && v.stock < 999
              ? outOfStock ? " · esgotado" : ` · ${v.stock}`
              : "";
            return (
              <button
                key={v.id}
                type="button"
                aria-pressed={isSelected}
                disabled={outOfStock}
                onClick={() => { if (!outOfStock) setSelectedVariantId(v.id); }}
                style={{
                  minWidth: "40px",
                  height: "34px",
                  padding: "0 12px",
                  borderRadius: "9px",
                  border: isSelected
                    ? "1.5px solid var(--aacp-accent)"
                    : "1px solid var(--aacp-line)",
                  background: isSelected
                    ? "color-mix(in srgb, var(--aacp-accent) 12%, var(--aacp-surface-2))"
                    : "var(--aacp-surface-2)",
                  color: outOfStock ? "var(--aacp-muted)" : "var(--aacp-fg)",
                  fontSize: "12px",
                  fontWeight: 600,
                  fontFamily: "inherit",
                  cursor: outOfStock ? "not-allowed" : "pointer",
                  opacity: outOfStock ? 0.5 : 1,
                  textDecoration: outOfStock ? "line-through" : "none",
                  boxShadow: isSelected
                    ? "0 0 0 3px color-mix(in srgb, var(--aacp-accent) 18%, transparent)"
                    : "none",
                  transition: "all 0.15s ease",
                  transform: isSelected ? "scale(1.04)" : "scale(1)",
                }}
                onMouseEnter={(e) => {
                  if (!isSelected && !outOfStock) {
                    e.currentTarget.style.borderColor = "var(--aacp-muted)";
                  }
                }}
                onMouseLeave={(e) => {
                  if (!isSelected && !outOfStock) {
                    e.currentTarget.style.borderColor = "var(--aacp-line)";
                  }
                }}
              >
                {v.value}{stockLabel}
              </button>
            );
          })}
        </div>
      )}

      {selectedVariant && (
        <div
          style={{
            padding: "8px 12px",
            borderRadius: "8px",
            background: "color-mix(in srgb, var(--aacp-accent) 6%, var(--aacp-surface-2))",
            border: "1px solid color-mix(in srgb, var(--aacp-accent) 20%, var(--aacp-line))",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "8px",
          }}
        >
          <span style={{ fontSize: "12px", fontWeight: 600, color: "var(--aacp-fg)" }}>
            {selectedVariant.name}: <span style={{ color: "var(--aacp-accent)" }}>{selectedVariant.value}</span>
          </span>
          {selectedVariant.price !== undefined && selectedVariant.price > 0 && (
            <span style={{ fontSize: "13px", fontWeight: 700, color: "var(--aacp-accent)", fontFamily: "var(--aacp-font-display)" }}>
              {selectedVariant.priceFormatted ?? new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(selectedVariant.price / 100)}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
