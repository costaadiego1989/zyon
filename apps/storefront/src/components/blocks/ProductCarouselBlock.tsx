"use client";

import { useRef } from "react";
import type { ProductCarouselBlock as ProductCarouselBlockType } from "@/lib/types";

function formatPrice(value: number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(value);
}

export default function ProductCarouselBlock({
  block,
  onQuickReply,
}: {
  block: ProductCarouselBlockType;
  onQuickReply?: (option: string) => void;
}) {
  const { data } = block;
  const scrollRef = useRef<HTMLDivElement | null>(null);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "6px",
        position: "relative",
      }}
    >
      {/* Hidden scrollbar styles via inline style tag */}
      <style>{`
        .aacp-carousel-scroll::-webkit-scrollbar { display: none; }
        .aacp-carousel-scroll { -ms-overflow-style: none; scrollbar-width: none; }
      `}</style>

      {/* Scrollable row */}
      <div
        ref={scrollRef}
        className="aacp-carousel-scroll"
        style={{
          display: "flex",
          gap: "12px",
          overflowX: "auto",
          paddingBottom: "4px",
          scrollSnapType: "x mandatory",
          WebkitOverflowScrolling: "touch",
          scrollBehavior: "smooth",
        }}
      >
        {data.products.map((product) => (
          <div
            key={product.id}
            style={{
              minWidth: "180px",
              maxWidth: "200px",
              flex: "0 0 180px",
              scrollSnapAlign: "start",
            }}
          >
            {/* Premium Card */}
            <article
              style={{
                background: "var(--aacp-surface)",
                border: "1px solid var(--aacp-line)",
                borderRadius: "10px",
                overflow: "hidden",
                boxShadow: "0 2px 8px rgba(0, 0, 0, 0.06)",
                display: "flex",
                flexDirection: "column",
                height: "100%",
                transition: "border-color 0.18s ease, box-shadow 0.18s ease",
              }}
            >
              {/* Product image — 120px height */}
              <div
                aria-hidden
                style={{
                  width: "100%",
                  height: "120px",
                  borderRadius: "10px 10px 0 0",
                  background: product.image
                    ? `url(${product.image}) center / cover`
                    : "linear-gradient(135deg, rgba(15, 118, 110, 0.12), rgba(15, 118, 110, 0.04))",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "var(--aacp-muted)",
                  fontSize: "32px",
                }}
              >
                {!product.image && "🛍️"}
              </div>

              {/* Card body */}
              <div
                style={{
                  padding: "10px 10px 12px",
                  display: "flex",
                  flexDirection: "column",
                  gap: "6px",
                  flex: 1,
                }}
              >
                {/* Product name — 2 lines max */}
                <h4
                  style={{
                    fontSize: "13px",
                    fontWeight: 700,
                    margin: 0,
                    color: "var(--aacp-fg)",
                    lineHeight: 1.3,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    display: "-webkit-box",
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: "vertical",
                  }}
                >
                  {product.name}
                </h4>

                {/* Price */}
                <span
                  style={{
                    fontSize: "14px",
                    fontWeight: 800,
                    color: "var(--aacp-accent)",
                  }}
                >
                  {product.priceFormatted}
                </span>

                {/* Stock badge */}
                <span
                  style={{
                    fontSize: "9px",
                    fontWeight: 600,
                    padding: "3px 6px",
                    borderRadius: "4px",
                    background: product.inStock
                      ? "color-mix(in srgb, var(--aacp-success) 15%, transparent)"
                      : "color-mix(in srgb, #ef4444 15%, transparent)",
                    color: product.inStock ? "var(--aacp-success)" : "#ef4444",
                    border: `1px solid ${product.inStock ? "color-mix(in srgb, var(--aacp-success) 30%, transparent)" : "color-mix(in srgb, #ef4444 30%, transparent)"}`,
                    textTransform: "uppercase",
                    letterSpacing: "0.3px",
                    alignSelf: "flex-start",
                  }}
                >
                  {product.inStock ? "Em estoque" : "Esgotado"}
                </span>

                {/* Spacer */}
                <div style={{ flex: 1 }} />

                {/* Two buttons row */}
                <div
                  style={{
                    display: "flex",
                    gap: "6px",
                    marginTop: "8px",
                  }}
                >
                  <button
                    type="button"
                    onClick={() => onQuickReply?.(`Detalhes ${product.name}`)}
                    style={{
                      flex: 1,
                      padding: "7px 6px",
                      borderRadius: "7px",
                      border: "1px solid var(--aacp-accent)",
                      background: "transparent",
                      color: "var(--aacp-accent)",
                      fontSize: "10.5px",
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
                    onClick={() =>
                      onQuickReply?.(`Adicionar ${product.name} ao carrinho`)
                    }
                    disabled={!product.inStock}
                    style={{
                      flex: 1,
                      padding: "7px 6px",
                      borderRadius: "7px",
                      border: "none",
                      background: product.inStock
                        ? "var(--aacp-accent)"
                        : "var(--aacp-muted)",
                      color: "#fff",
                      fontSize: "10.5px",
                      fontWeight: 600,
                      cursor: product.inStock ? "pointer" : "not-allowed",
                      opacity: product.inStock ? 1 : 0.5,
                      fontFamily: "inherit",
                      transition: "all 0.15s ease",
                    }}
                    onMouseEnter={(e) => {
                      if (product.inStock) {
                        (e.currentTarget as HTMLButtonElement).style.transform =
                          "translateY(-1px)";
                      }
                    }}
                    onMouseLeave={(e) => {
                      (e.currentTarget as HTMLButtonElement).style.transform =
                        "none";
                    }}
                  >
                    🛒 Adicionar
                  </button>
                </div>
              </div>
            </article>
          </div>
        ))}
      </div>
    </div>
  );
}
