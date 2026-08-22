"use client";

import { useMemo, useState } from "react";
import type { ProductCardBlock as ProductCardBlockType } from "@/lib/types";

const COLOR_KEYWORDS = [
  "preto",
  "azul",
  "verde",
  "branco",
  "vermelho",
  "cinza",
  "bege",
  "marinho",
  "amarelo",
  "rosa",
  "lilas",
  "laranja",
  "marrom",
  "vinho",
];

const COLOR_HEX: Record<string, string> = {
  preto: "#111111",
  azul: "#2563eb",
  verde: "#16a34a",
  branco: "#f5f5f5",
  vermelho: "#dc2626",
  cinza: "#6b7280",
  bege: "#d6c5a3",
  marinho: "#1e3a8a",
  amarelo: "#facc15",
  rosa: "#ec4899",
  lilas: "#a855f7",
  laranja: "#f97316",
  marrom: "#92400e",
  vinho: "#7f1d1d",
};

function getInitial(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "★";
  return trimmed.charAt(0).toUpperCase();
}

function isColorToken(value: string): boolean {
  const v = value.trim().toLowerCase();
  if (/^(#([0-9a-f]{3,8})|rgb\(|hsl\()/i.test(value.trim())) return true;
  return COLOR_KEYWORDS.some((k) => v.includes(k));
}

function colorFromToken(value: string): string {
  const v = value.trim().toLowerCase();
  if (/^#([0-9a-f]{3,8})$/i.test(v)) return v;
  for (const key of COLOR_KEYWORDS) {
    if (v.includes(key)) return COLOR_HEX[key];
  }
  return "#9ca3af";
}

function isLightHex(hex: string): boolean {
  const m = hex.replace("#", "");
  if (m.length !== 6 && m.length !== 3) return false;
  const full =
    m.length === 3
      ? m
          .split("")
          .map((c) => c + c)
          .join("")
      : m;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.65;
}

function StarRating({ value, count }: { value: number; count: number }) {
  const full = Math.floor(value);
  const partial = Math.max(0, Math.min(1, value - full));
  const total = 5;
  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "6px",
        fontSize: "12px",
        color: "var(--aacp-muted)",
      }}
      aria-label={`Avaliação ${value.toFixed(1)} de 5`}
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
        aria-hidden
      >
        {Array.from({ length: total }).map((_, i) => {
          let fillRatio = 0;
          if (i < full) fillRatio = 1;
          else if (i === full) fillRatio = partial;
          const empty = fillRatio === 0;
          return (
            <span
              key={i}
              style={{ position: "relative", display: "inline-block" }}
            >
              <span style={{ color: "rgba(245, 179, 1, 0.22)" }}>★</span>
              {!empty && (
                <span
                  style={{
                    position: "absolute",
                    inset: 0,
                    width: `${fillRatio * 100}%`,
                    overflow: "hidden",
                    color: "#F5B301",
                    whiteSpace: "nowrap",
                  }}
                >
                  ★
                </span>
              )}
            </span>
          );
        })}
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

  const variants = data.variants ?? [];
  const variantsAreColors =
    variants.length > 0 && isColorToken(variants[0].value);

  const selectedVariant =
    variants.find((v) => v.id === selectedVariantId) ?? null;

  // Derive displayed price from selected variant (falls back to card-level price)
  const displayedPrice = useMemo(() => {
    if (selectedVariant?.price !== undefined && selectedVariant.price > 0) {
      return selectedVariant.price;
    }
    return data.price;
  }, [selectedVariant, data.price]);

  const displayedPriceFormatted = useMemo(() => {
    if (selectedVariant?.priceFormatted) {
      return selectedVariant.priceFormatted;
    }
    if (selectedVariant?.price !== undefined && selectedVariant.price > 0) {
      return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(selectedVariant.price / 100);
    }
    return data.priceFormatted;
  }, [selectedVariant, data.priceFormatted, data.price]);

  const quickReplies = [
    `Calcular frete para ${data.name}`,
    `Ver variações de ${data.name}`,
    `Comparar ${data.name} com similar`,
    `Ver avaliações de ${data.name}`,
    `Tirar dúvida sobre ${data.name}`,
  ];

  const buildCtaText = (verb: string) => {
    const variantSuffix = selectedVariant ? ` (${selectedVariant.name}: ${selectedVariant.value})` : "";
    const variantIdTag = selectedVariantId ? ` [variantId:${selectedVariantId}]` : "";
    return `${verb} ao carrinho ${data.name}${variantSuffix}${variantIdTag}`;
  };

  return (
    <article
      style={{
        background: "var(--aacp-surface)",
        border: "1px solid var(--aacp-line)",
        borderRadius: "14px",
        overflow: "hidden",
        boxShadow:
          "0 1px 2px rgba(0,0,0,0.04), 0 12px 32px rgba(0,0,0,0.10)",
        display: "flex",
        flexDirection: "column",
        width: "100%",
        maxWidth: "100%",
        fontFamily: "var(--aacp-font)",
        color: "var(--aacp-fg)",
        animation: "fadeSlideIn 0.45s cubic-bezier(0.22, 1, 0.36, 1) both",
        boxSizing: "border-box",
      }}
    >
      <style>{`
        @keyframes fadeSlideIn {
          from { opacity: 0; transform: translateY(12px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>

      {/* Hero image — 200px height, full width */}
      <div
        aria-hidden
        style={{
          position: "relative",
          width: "100%",
          height: "200px",
          background: data.image
            ? "linear-gradient(180deg, var(--aacp-surface-2) 0%, var(--aacp-surface-3) 100%)"
            : "linear-gradient(135deg, var(--aacp-surface-2) 0%, var(--aacp-surface-3) 100%)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          overflow: "hidden",
          flexShrink: 0,
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
              fontSize: "72px",
              fontWeight: 800,
              lineHeight: 1,
              color: "color-mix(in srgb, var(--aacp-accent) 30%, transparent)",
              letterSpacing: "-0.04em",
              userSelect: "none",
            }}
          >
            {getInitial(data.name)}
          </span>
        )}

        {/* Top-left badges */}
        <div
          style={{
            position: "absolute",
            top: "12px",
            left: "12px",
            display: "flex",
            flexDirection: "column",
            gap: "6px",
            alignItems: "flex-start",
          }}
        >
          {hasDiscount && (
            <span
              style={{
                background: "var(--aacp-accent)",
                color: "#fff",
                fontSize: "11px",
                fontWeight: 700,
                padding: "5px 9px",
                borderRadius: "999px",
                letterSpacing: "0.05em",
                boxShadow:
                  "0 4px 12px color-mix(in srgb, var(--aacp-accent) 35%, transparent)",
              }}
            >
              -{data.discountPercent}%
            </span>
          )}
        </div>

        {/* Wishlist heart (top-right) */}
        <button
          type="button"
          aria-label="Adicionar à lista de desejos"
          onClick={() => onQuickReply?.(`Adicionar ${data.name} à lista de desejos`)}
          style={{
            position: "absolute",
            top: "12px",
            right: "12px",
            width: "34px",
            height: "34px",
            borderRadius: "50%",
            background: "color-mix(in srgb, var(--aacp-surface) 80%, transparent)",
            border: "1px solid var(--aacp-line)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer",
            color: "var(--aacp-muted)",
            backdropFilter: "blur(6px)",
            transition: "all 0.15s ease",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.color = "#ef4444";
            e.currentTarget.style.borderColor = "#ef4444";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.color = "var(--aacp-muted)";
            e.currentTarget.style.borderColor = "var(--aacp-line)";
          }}
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
          </svg>
        </button>
      </div>

      {/* Body */}
      <div
        style={{
          padding: "16px 18px 16px",
          display: "flex",
          flexDirection: "column",
          gap: "12px",
        }}
      >
        {/* Rating row */}
        {data.rating !== undefined && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: "10px",
              flexWrap: "wrap",
            }}
          >
            <StarRating value={data.rating} count={data.reviewCount ?? 0} />
          </div>
        )}

        {/* Product name */}
        <h3
          style={{
            fontFamily: "var(--aacp-font-display)",
            fontSize: "18px",
            fontWeight: 700,
            margin: 0,
            color: "var(--aacp-fg)",
            lineHeight: 1.3,
            letterSpacing: "-0.01em",
          }}
        >
          {data.name}
        </h3>

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

        {/* Variants */}
        {variants.length > 0 && (
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
                Variantes
              </span>
              {selectedVariant && (
                <span
                  style={{
                    fontSize: "11px",
                    fontWeight: 600,
                    color: "var(--aacp-fg)",
                  }}
                >
                  {selectedVariant.name}: {selectedVariant.value}
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
                  return (
                    <button
                      key={v.id}
                      type="button"
                      aria-pressed={isSelected}
                      onClick={() => setSelectedVariantId(v.id)}
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
                        color: "var(--aacp-fg)",
                        fontSize: "12px",
                        fontWeight: 600,
                        fontFamily: "inherit",
                        cursor: "pointer",
                        boxShadow: isSelected
                          ? "0 0 0 3px color-mix(in srgb, var(--aacp-accent) 18%, transparent)"
                          : "none",
                        transition: "all 0.15s ease",
                        transform: isSelected ? "scale(1.04)" : "scale(1)",
                      }}
                      onMouseEnter={(e) => {
                        if (!isSelected) {
                          e.currentTarget.style.borderColor = "var(--aacp-muted)";
                        }
                      }}
                      onMouseLeave={(e) => {
                        if (!isSelected) {
                          e.currentTarget.style.borderColor = "var(--aacp-line)";
                        }
                      }}
                    >
                      {v.value}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Price block */}
        <div
          style={{
            display: "flex",
            alignItems: "flex-end",
            justifyContent: "space-between",
            gap: "12px",
            marginTop: "6px",
            paddingTop: "12px",
            borderTop: "1px solid var(--aacp-line)",
          }}
        >
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "3px",
              minWidth: 0,
            }}
          >
            {hasDiscount && (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                }}
              >
                <span
                  style={{
                    fontSize: "13px",
                    color: "var(--aacp-muted)",
                    textDecoration: "line-through",
                    fontWeight: 500,
                  }}
                >
                  {data.originalPriceFormatted ??
                    (data.originalPrice !== undefined
                      ? new Intl.NumberFormat("pt-BR", {
                          style: "currency",
                          currency: "BRL",
                        }).format(data.originalPrice / 100)
                      : "")}
                </span>
                <span
                  style={{
                    fontSize: "10px",
                    fontWeight: 700,
                    color: "#fff",
                    background: "var(--aacp-accent)",
                    padding: "2px 6px",
                    borderRadius: "4px",
                    letterSpacing: "0.05em",
                  }}
                >
                  -{data.discountPercent}%
                </span>
              </div>
            )}
            <span
              style={{
                fontSize: "24px",
                fontWeight: 800,
                color: "var(--aacp-accent)",
                fontFamily: "var(--aacp-font-display)",
                letterSpacing: "-0.02em",
                lineHeight: 1.1,
              }}
            >
              {displayedPriceFormatted}
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
              whiteSpace: "nowrap",
            }}
            aria-live="polite"
          >
            <span
              style={{
                width: "8px",
                height: "8px",
                borderRadius: "50%",
                background: data.inStock ? "var(--aacp-success)" : "#ef4444",
                boxShadow: data.inStock
                  ? "0 0 0 3px color-mix(in srgb, var(--aacp-success) 22%, transparent)"
                  : "0 0 0 3px color-mix(in srgb, #ef4444 22%, transparent)",
              }}
              aria-hidden
            />
            {data.inStock ? "Em estoque" : "Esgotado"}
          </div>
        </div>

        {/* Stock + shipping note */}
        {data.inStock && (
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "6px",
              fontSize: "11.5px",
              color: "var(--aacp-muted)",
              marginTop: "-2px",
            }}
          >
            <svg
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="var(--aacp-success)"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <path d="M3 7h13l5 5v7h-2" />
              <path d="M3 17V7" />
              <circle cx="7.5" cy="17.5" r="2.5" />
              <circle cx="17.5" cy="17.5" r="2.5" />
            </svg>
            <span>
              Frete grátis para todo o Brasil
            </span>
          </div>
        )}

        {/* Marketplace seller badge */}
        {data.source === "marketplace" && data.sellerName && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "6px",
              padding: "8px 12px",
              borderRadius: "8px",
              background: "color-mix(in srgb, var(--aacp-accent) 8%, var(--aacp-surface-2))",
              border: "1px solid color-mix(in srgb, var(--aacp-accent) 20%, var(--aacp-line))",
              marginTop: "2px",
            }}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="var(--aacp-accent)"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
              <polyline points="9 22 9 12 15 12 15 22" />
            </svg>
            <span
              style={{
                fontSize: "11.5px",
                fontWeight: 600,
                color: "var(--aacp-fg)",
                lineHeight: 1.3,
              }}
            >
              Vendido e entregue por{" "}
              <span style={{ color: "var(--aacp-accent)" }}>{data.sellerName}</span>
            </span>
          </div>
        )}

        {/* Action buttons */}
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
      </div>

      {/* Quick replies */}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "6px",
          padding: "12px 18px 14px",
          borderTop: "1px solid var(--aacp-line)",
          background: "var(--aacp-surface-2)",
        }}
      >
        <span
          style={{
            width: "100%",
            fontSize: "10.5px",
            fontWeight: 600,
            color: "var(--aacp-muted)",
            textTransform: "uppercase",
            letterSpacing: "0.08em",
            marginBottom: "2px",
            fontFamily: "var(--aacp-font-display)",
          }}
        >
          Respostas rápidas
        </span>
        {quickReplies.map((reply) => (
          <button
            key={reply}
            type="button"
            onClick={() => onQuickReply?.(reply)}
            style={{
              padding: "6px 12px",
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
              e.currentTarget.style.background =
                "color-mix(in srgb, var(--aacp-accent) 6%, var(--aacp-surface))";
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
