"use client";

import { useMemo, useState } from "react";
import type { ProductCardBlock as ProductCardBlockType } from "@/lib/types";
import { isColorToken } from "@/lib/utils/color";
import { StarRating } from "./parts/StarRating";
import { ProductCardMedia } from "./parts/ProductCardMedia";
import { ProductCardVariants } from "./parts/ProductCardVariants";
import { ProductCardOptions } from "./parts/ProductCardOptions";
import { ProductCardCta } from "./parts/ProductCardCta";

type OptionGroup = NonNullable<ProductCardBlockType["data"]["optionGroups"]>[number];

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

  const optionGroups = data.optionGroups ?? [];
  const [selectedItemIds, setSelectedItemIds] = useState<Set<string>>(new Set());

  const toggleOption = (group: OptionGroup, itemId: string) => {
    setSelectedItemIds((prev) => {
      const next = new Set(prev);
      if (group.selectionType === "single") {
        // Radio semantics: clear the other items in this group, then set this one.
        for (const it of group.items) next.delete(it.id);
        next.add(itemId);
      } else if (next.has(itemId)) {
        next.delete(itemId);
      } else {
        next.add(itemId);
      }
      return next;
    });
  };

  // Required groups must each have a selection before the item can be added.
  const requiredGroupsSatisfied = optionGroups.every(
    (g) => !g.required || g.items.some((it) => selectedItemIds.has(it.id)),
  );

  // Sum of selected option modifiers (buyer-facing display only; server is source of truth).
  const optionModifierCents = optionGroups
    .flatMap((g) => g.items)
    .filter((it) => selectedItemIds.has(it.id))
    .reduce((sum, it) => sum + it.priceModifierInCents, 0);

  const hasDiscount = useMemo(() => {
    return (
      data.originalPrice !== undefined &&
      data.originalPrice > data.price &&
      data.discountPercent !== undefined &&
      data.discountPercent > 0
    );
  }, [data.originalPrice, data.price, data.discountPercent]);

  const variants = data.variants ?? [];
  const hasRealVariants = variants.length > 1 || (variants.length === 1 && variants[0].value.trim().length > 0);
  const variantsAreColors =
    hasRealVariants && variants.length > 0 && isColorToken(variants[0].value);

  const selectedVariant =
    variants.find((v) => v.id === selectedVariantId) ?? null;

  const displayedPrice = useMemo(() => {
    if (selectedVariant?.price !== undefined && selectedVariant.price > 0) {
      return selectedVariant.price;
    }
    return data.price;
  }, [selectedVariant, data.price]);

  const displayedPriceFormatted = useMemo(() => {
    const baseCents =
      selectedVariant?.price !== undefined && selectedVariant.price > 0
        ? selectedVariant.price
        : data.price;
    // Include selected food-option modifiers so the buyer sees the live unit
    // price (e.g. R$45 + Grande R$10 + Bacon R$5 = R$60).
    const withOptions = baseCents + optionModifierCents;
    if (optionModifierCents > 0) {
      return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(withOptions / 100);
    }
    if (selectedVariant?.priceFormatted) {
      return selectedVariant.priceFormatted;
    }
    if (selectedVariant?.price !== undefined && selectedVariant.price > 0) {
      return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(selectedVariant.price / 100);
    }
    return data.priceFormatted;
  }, [selectedVariant, data.priceFormatted, data.price, optionModifierCents]);

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
    // Embed the chosen option item ids as a structured tag the deterministic
    // cart handler parses by id — never relies on the LLM to infer selections,
    // so the server can re-validate and re-price them safely.
    const chosen = Array.from(selectedItemIds);
    const optionNames = optionGroups
      .flatMap((g) => g.items)
      .filter((it) => selectedItemIds.has(it.id))
      .map((it) => it.name);
    const optionSuffix = optionNames.length > 0 ? ` — ${optionNames.join(", ")}` : "";
    const optionIdTag = chosen.length > 0 ? ` [optionItemIds:${chosen.join(",")}]` : "";
    return `${verb} ao carrinho ${data.name}${variantSuffix}${optionSuffix}${variantIdTag}${optionIdTag}`;
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
        @container (max-width: 340px) {
          .aacp-pc-grid { grid-template-columns: 1fr !important; }
        }
        @media (max-width: 360px) {
          .aacp-pc-grid { grid-template-columns: 1fr !important; }
        }
      `}</style>

      <ProductCardMedia
        data={data}
        hasDiscount={hasDiscount}
        onQuickReply={onQuickReply}
      />

      <div
        style={{
          padding: "16px 18px 16px",
          display: "flex",
          flexDirection: "column",
          gap: "12px",
        }}
      >
        <div
          className="aacp-pc-grid"
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(0, 1.35fr) minmax(0, 1fr)",
            gap: "16px",
            alignItems: "start",
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: "8px", minWidth: 0 }}>
            {data.rating !== undefined && (
              <StarRating value={data.rating} count={data.reviewCount ?? 0} />
            )}

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

            {data.description && (
              <p
                style={{
                  fontSize: "12.5px",
                  lineHeight: 1.5,
                  color: "var(--aacp-muted)",
                  margin: 0,
                  ...(data.detailed
                    ? {}
                    : {
                        display: "-webkit-box",
                        WebkitLineClamp: 3,
                        WebkitBoxOrient: "vertical" as const,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }),
                }}
              >
                {data.description}
              </p>
            )}

            {data.detailed && data.sku && (
              <span style={{ fontSize: "11.5px", color: "var(--aacp-muted)", fontFamily: "var(--aacp-font-mono, monospace)" }}>
                SKU: {data.sku}
              </span>
            )}
          </div>

          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "6px",
              minWidth: 0,
              alignItems: "flex-end",
              textAlign: "right",
            }}
          >
            {hasDiscount && (
              <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap", justifyContent: "flex-end" }}>
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

            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "6px",
                fontSize: "11.5px",
                fontWeight: 600,
                color: data.inStock ? "var(--aacp-success)" : "#ef4444",
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
              {data.inStock
                ? data.detailed && data.stock && data.stock < 999
                  ? `Em estoque · ${data.stock} ${data.stock === 1 ? "un." : "un."}`
                  : "Em estoque"
                : "Esgotado"}
            </div>

            {data.inStock && (
              <div
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "6px",
                  fontSize: "11.5px",
                  color: "var(--aacp-muted)",
                  lineHeight: 1.3,
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
                <span>Frete grátis Brasil</span>
              </div>
            )}
          </div>
        </div>

        {hasRealVariants && (
          <ProductCardVariants
            variants={variants}
            selectedVariantId={selectedVariantId}
            setSelectedVariantId={setSelectedVariantId}
            variantsAreColors={variantsAreColors}
            selectedVariant={selectedVariant}
            detailed={data.detailed}
          />
        )}

        {optionGroups.length > 0 && (
          <ProductCardOptions
            groups={optionGroups}
            selectedItemIds={selectedItemIds}
            onToggle={toggleOption}
          />
        )}

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

        <ProductCardCta
          data={data}
          selectedVariant={selectedVariant}
          selectedVariantId={selectedVariantId}
          buildCtaText={buildCtaText}
          onQuickReply={onQuickReply}
          addDisabled={!requiredGroupsSatisfied}
          addDisabledReason={
            !requiredGroupsSatisfied ? "Escolha as opções obrigatórias" : undefined
          }
        />
      </div>

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
