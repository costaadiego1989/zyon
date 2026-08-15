"use client";

import { useMemo, useState } from "react";
import type { ProductCardBlock as ProductCardBlockType } from "@/lib/types";

function formatPrice(value: number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(value);
}

function StarRating({ value, count }: { value: number; count: number }) {
  const full = Math.floor(value);
  const half = value - full >= 0.5;
  const total = 5;
  const stars: Array<"full" | "half" | "empty"> = [];
  for (let i = 0; i < total; i++) {
    if (i < full) stars.push("full");
    else if (i === full && half) stars.push("half");
    else stars.push("empty");
  }
  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "6px",
        fontSize: "12px",
        color: "var(--aacp-muted)",
      }}
      aria-label={`Avaliação ${value} de 5`}
    >
      <span
        style={{
          display: "inline-flex",
          gap: "1px",
          color: "#F5B301",
          fontSize: "13px",
          lineHeight: 1,
          letterSpacing: "0.5px",
        }}
      >
        {stars.map((s, i) => (
          <span key={i} aria-hidden style={{ position: "relative" }}>
            <span style={{ color: "rgba(245, 179, 1, 0.22)" }}>★</span>
            {s !== "empty" && (
              <span
                style={{
                  position: "absolute",
                  inset: 0,
                  width: s === "half" ? "50%" : "100%",
                  overflow: "hidden",
                  color: "#F5B301",
                  whiteSpace: "nowrap",
                }}
              >
                ★
              </span>
            )}
          </span>
        ))}
      </span>
      <span style={{ fontWeight: 600, color: "var(--aacp-fg)" }}>
        {value.toFixed(1)}
      </span>
      <span style={{ color: "var(--aacp-muted)" }}>
        ({count} {count === 1 ? "avaliação" : "avaliações"})
      </span>
    </div>
  );
}

function getInitial(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "★";
  return trimmed.charAt(0).toUpperCase();
}

function isColorToken(value: string): boolean {
  return /^(#([0-9a-f]{3,8})|rgb\(|hsl\()/i.test(value.trim());
}

export default function ProductCardBlock({
  block,
  onQuickReply,
}: {
  block: ProductCardBlockType;
  onQuickReply?: (option: string) => void;
}) {
  const { data } = block;
  const [selectedVariantId, setSelectedVariantId] = useState<string | null>(
    data.variants && data.variants.length > 0 ? data.variants[0].id : null,
  );

  const hasDiscount = useMemo(() => {
    return (
      data.originalPrice !== undefined &&
      data.originalPrice > data.price &&
      data.discountPercent !== undefined &&
      data.discountPercent > 0
    );
  }, [data.originalPrice, data.price, data.discountPercent]);

  const quickReplies = [
    "Calcular frete",
    "Tem em outra cor?",
    "Comparar com similar",
    "Ver avaliações",
  ];

  const selectedVariant =
    data.variants?.find((v) => v.id === selectedVariantId) ?? null;

  return (
    <article
      style={{
        background: "var(--aacp-surface)",
        border: "1px solid var(--aacp-line)",
        borderRadius: "14px",
        overflow: "hidden",
        boxShadow: "0 1px 2px rgba(0,0,0,0.04), 0 8px 24px rgba(0,0,0,0.06)",
        display: "flex",
        flexDirection: "column",
        maxWidth: "420px",
        width: "100%",
        fontFamily: "var(--aacp-font)",
        color: "var(--aacp-fg)",
        transition: "transform 0.2s ease, box-shadow 0.2s ease, border-color 0.2s ease",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.transform = "translateY(-2px)";
        e.currentTarget.style.boxShadow =
          "0 2px 4px rgba(0,0,0,0.05), 0 16px 36px rgba(0,0,0,0.10)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = "translateY(0)";
        e.currentTarget.style.boxShadow =
          "0 1px 2px rgba(0,0,0,0.04), 0 8px 24px rgba(0,0,0,0.06)";
      }}
    >
      {/* Hero image — 45% of card (~200px) */}
      <div
        aria-hidden
        style={{
          position: "relative",
          width: "100%",
          height: "200px",
          background: data.image
            ? "linear-gradient(180deg, var(--aacp-surface-2) 0%, var(--aacp-surface-3) 100%)"
            : `linear-gradient(135deg, color-mix(in srgb, var(--aacp-accent) 12%, var(--aacp-surface-2)) 0%, var(--aacp-surface-3) 100%)`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          borderTopLeftRadius: "14px",
          borderTopRightRadius: "14px",
          overflow: "hidden",
        }}
      >
        {data.image ? (
          <img
            src={data.image}
            alt={data.name}
            style={{
              maxWidth: "100%",
              maxHeight: "100%",
              width: "auto",
              height: "auto",
              objectFit: "contain",
              display: "block",
            }}
            loading="lazy"
          />
        ) : (
          <span
            style={{
              fontFamily: "var(--aacp-font-display)",
              fontSize: "96px",
              fontWeight: 800,
              lineHeight: 1,
              color: "color-mix(in srgb, var(--aacp-accent) 35%, transparent)",
              letterSpacing: "-0.04em",
              userSelect: "none",
            }}
          >
            {getInitial(data.name)}
          </span>
        )}

        {/* Discount badge overlay */}
        {hasDiscount && (
          <span
            style={{
              position: "absolute",
              top: "12px",
              left: "12px",
              background: "var(--aacp-accent)",
              color: "#fff",
              fontSize: "11px",
              fontWeight: 700,
              padding: "5px 9px",
              borderRadius: "999px",
              letterSpacing: "0.05em",
              boxShadow: "0 4px 12px color-mix(in srgb, var(--aacp-accent) 35%, transparent)",
            }}
          >
            {data.discountPercent}% OFF
          </span>
        )}

        {/* Free shipping badge overlay */}
        <span
          style={{
            position: "absolute",
            top: "12px",
            right: "12px",
            background: "color-mix(in srgb, var(--aacp-success) 18%, var(--aacp-surface))",
            color: "var(--aacp-success)",
            fontSize: "10.5px",
            fontWeight: 700,
            padding: "5px 9px",
            borderRadius: "999px",
            letterSpacing: "0.04em",
            border: "1px solid color-mix(in srgb, var(--aacp-success) 35%, transparent)",
            backdropFilter: "blur(6px)",
          }}
        >
          FRETE GRÁTIS
        </span>
      </div>

      {/* Body */}
      <div
        style={{
          padding: "16px 16px 14px",
          display: "flex",
          flexDirection: "column",
          gap: "10px",
          flex: 1,
        }}
      >
        {/* Product name */}
        <h3
          style={{
            fontFamily: "var(--aacp-font-display)",
            fontSize: "17px",
            fontWeight: 700,
            margin: 0,
            color: "var(--aacp-fg)",
            lineHeight: 1.25,
            letterSpacing: "-0.01em",
          }}
        >
          {data.name}
        </h3>

        {/* Rating */}
        {data.rating !== undefined && (
          <StarRating value={data.rating} count={data.reviewCount ?? 0} />
        )}

        {/* Description */}
        {data.description && (
          <p
            style={{
              fontSize: "12.5px",
              lineHeight: 1.5,
              color: "var(--aacp-muted)",
              margin: 0,
              display: "-webkit-box",
              WebkitLineClamp: 3,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {data.description}
          </p>
        )}

        {/* Variants — selectable pills */}
        {data.variants && data.variants.length > 0 && (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "6px",
              marginTop: "2px",
            }}
          >
            <span
              style={{
                fontSize: "11px",
                fontWeight: 600,
                color: "var(--aacp-muted)",
                textTransform: "uppercase",
                letterSpacing: "0.06em",
              }}
            >
              {data.variants[0].name}
              {selectedVariant && selectedVariant.name === data.variants[0].name
                ? `: ${selectedVariant.value}`
                : ""}
            </span>
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: "6px",
              }}
            >
              {data.variants.map((v) => {
                const isSelected = v.id === selectedVariantId;
                const isColor = isColorToken(v.value);
                return (
                  <button
                    key={v.id}
                    type="button"
                    aria-pressed={isSelected}
                    onClick={() => setSelectedVariantId(v.id)}
                    title={v.value}
                    style={{
                      minWidth: isColor ? "28px" : "36px",
                      height: "30px",
                      padding: isColor ? "0" : "0 10px",
                      borderRadius: isColor ? "50%" : "8px",
                      border: isSelected
                        ? `1.5px solid var(--aacp-accent)`
                        : "1px solid var(--aacp-line)",
                      background: isColor ? v.value : "var(--aacp-surface-2)",
                      color: "var(--aacp-fg)",
                      fontSize: "12px",
                      fontWeight: 600,
                      fontFamily: "inherit",
                      cursor: "pointer",
                      boxShadow: isSelected
                        ? "0 0 0 3px color-mix(in srgb, var(--aacp-accent) 18%, transparent)"
                        : "none",
                      transition: "all 0.15s ease",
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    {!isColor && v.value}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Price section */}
        <div
          style={{
            display: "flex",
            alignItems: "flex-end",
            justifyContent: "space-between",
            gap: "10px",
            marginTop: "8px",
            paddingTop: "12px",
            borderTop: "1px solid var(--aacp-line)",
          }}
        >
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "2px",
              minWidth: 0,
            }}
          >
            {hasDiscount && (
              <span
                style={{
                  fontSize: "12px",
                  color: "var(--aacp-muted)",
                  textDecoration: "line-through",
                  fontWeight: 500,
                }}
              >
                {formatPrice(data.originalPrice!)}
              </span>
            )}
            <span
              style={{
                fontSize: "22px",
                fontWeight: 800,
                color: "var(--aacp-accent)",
                fontFamily: "var(--aacp-font-display)",
                letterSpacing: "-0.02em",
                lineHeight: 1.1,
              }}
            >
              {data.priceFormatted}
            </span>
          </div>

          {/* Stock indicator */}
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "6px",
              fontSize: "11.5px",
              fontWeight: 600,
              color: data.inStock ? "var(--aacp-success)" : "#ef4444",
              paddingBottom: "4px",
            }}
            aria-live="polite"
          >
            <span
              style={{
                width: "7px",
                height: "7px",
                borderRadius: "50%",
                background: data.inStock ? "var(--aacp-success)" : "#ef4444",
                boxShadow: data.inStock
                  ? "0 0 0 3px color-mix(in srgb, var(--aacp-success) 20%, transparent)"
                  : "0 0 0 3px color-mix(in srgb, #ef4444 20%, transparent)",
              }}
              aria-hidden
            />
            {data.inStock ? "Em estoque" : "Esgotado"}
          </div>
        </div>

        {/* Add to cart — full width primary */}
        <button
          type="button"
          onClick={() =>
            onQuickReply?.(
              `Adicionar ${data.name}${
                selectedVariant ? ` (${selectedVariant.name}: ${selectedVariant.value})` : ""
              } ao carrinho`,
            )
          }
          disabled={!data.inStock}
          style={{
            marginTop: "4px",
            padding: "12px 14px",
            borderRadius: "12px",
            border: "none",
            background: data.inStock
              ? "var(--aacp-accent)"
              : "color-mix(in srgb, var(--aacp-muted) 30%, var(--aacp-surface-2))",
            color: "#fff",
            fontSize: "13.5px",
            fontWeight: 700,
            fontFamily: "inherit",
            letterSpacing: "0.01em",
            cursor: data.inStock ? "pointer" : "not-allowed",
            opacity: data.inStock ? 1 : 0.6,
            transition: "transform 0.15s ease, box-shadow 0.15s ease, filter 0.15s ease",
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
            e.currentTarget.style.transform = "none";
            e.currentTarget.style.boxShadow =
              "0 4px 14px color-mix(in srgb, var(--aacp-accent) 30%, transparent)";
            e.currentTarget.style.filter = "none";
          }}
        >
          {data.inStock ? "Adicionar ao carrinho" : "Produto indisponível"}
        </button>

        {/* Secondary link */}
        <button
          type="button"
          onClick={() => onQuickReply?.(`Ver mais opções de ${data.name}`)}
          style={{
            padding: "4px 0",
            border: "none",
            background: "transparent",
            color: "var(--aacp-muted)",
            fontSize: "12px",
            fontWeight: 500,
            fontFamily: "inherit",
            cursor: "pointer",
            textAlign: "center",
            transition: "color 0.15s ease",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.color = "var(--aacp-accent)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.color = "var(--aacp-muted)";
          }}
        >
          Ver mais opções
        </button>
      </div>

      {/* Quick replies */}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "6px",
          padding: "10px 16px 14px",
          borderTop: "1px solid var(--aacp-line)",
          background: "var(--aacp-surface-2)",
        }}
      >
        {quickReplies.map((reply) => (
          <button
            key={reply}
            type="button"
            onClick={() => onQuickReply?.(reply)}
            style={{
              padding: "6px 10px",
              borderRadius: "999px",
              border: "1px solid var(--aacp-line)",
              background: "var(--aacp-surface)",
              color: "var(--aacp-muted)",
              fontSize: "11.5px",
              fontWeight: 500,
              fontFamily: "inherit",
              cursor: "pointer",
              transition: "all 0.15s ease",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = "var(--aacp-accent)";
              e.currentTarget.style.borderColor = "var(--aacp-accent)";
              e.currentTarget.style.background = "color-mix(in srgb, var(--aacp-accent) 6%, var(--aacp-surface))";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = "var(--aacp-muted)";
              e.currentTarget.style.borderColor = "var(--aacp-line)";
              e.currentTarget.style.background = "var(--aacp-surface)";
            }}
          >
            {reply}
          </button>
        ))}
      </div>
    </article>
  );
}
