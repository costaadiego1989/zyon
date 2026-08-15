"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ProductCarouselBlock as ProductCarouselBlockType, ProductCardBlock } from "@/lib/types";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3009";

function formatPrice(cents: number): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);
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
  const [products, setProducts] = useState<ProductCardBlock["data"][]>(data.products);
  const [cursor, setCursor] = useState<string | undefined>(data.nextCursor);
  const [loadingMore, setLoadingMore] = useState(false);
  const observerRef = useRef<HTMLDivElement | null>(null);

  const loadMore = useCallback(async () => {
    if (!cursor || loadingMore || !data.merchantId) return;
    setLoadingMore(true);
    try {
      const params = new URLSearchParams();
      if (data.query) params.set("query", data.query);
      if (data.categoryId) params.set("categoryId", data.categoryId);
      params.set("limit", "10");
      params.set("cursor", cursor);
      const res = await fetch(`${API_BASE}/merchants/${data.merchantId}/products?${params}`, { credentials: "include" });
      if (!res.ok) return;
      const result = await res.json();
      const newProducts: ProductCardBlock["data"][] = (result.products ?? []).map((p: any) => ({
        id: p.id,
        name: p.name,
        price: p.variants?.[0]?.basePriceInCents ?? 0,
        priceFormatted: formatPrice(p.variants?.[0]?.basePriceInCents ?? 0),
        image: p.variants?.[0]?.media?.[0]?.url,
        inStock: p.variants?.some((v: any) => (v.stockQuantity ?? 0) - (v.stockReserved ?? 0) > 0) ?? false,
      }));
      setProducts((prev) => [...prev, ...newProducts]);
      setCursor(result.nextCursor ?? undefined);
    } catch { /* non-critical */ } finally {
      setLoadingMore(false);
    }
  }, [cursor, loadingMore, data.merchantId, data.query, data.categoryId]);

  useEffect(() => {
    if (!observerRef.current) return;
    const observer = new IntersectionObserver(
      (entries) => { if (entries[0]?.isIntersecting && cursor && !loadingMore) void loadMore(); },
      { root: scrollRef.current, threshold: 0.1 }
    );
    observer.observe(observerRef.current);
    return () => observer.disconnect();
  }, [cursor, loadingMore, loadMore]);

  return (
    <div style={{ position: "relative", margin: "0 -18px", padding: "0 18px" }}>
      <style>{`
        .aacp-carousel-scroll::-webkit-scrollbar { display: none; }
        .aacp-carousel-scroll { -ms-overflow-style: none; scrollbar-width: none; }
      `}</style>

      <div
        ref={scrollRef}
        className="aacp-carousel-scroll"
        style={{
          display: "flex",
          gap: "14px",
          overflowX: "auto",
          paddingBottom: "6px",
          scrollSnapType: "x mandatory",
          WebkitOverflowScrolling: "touch",
          scrollBehavior: "smooth",
        }}
      >
        {products.map((product) => (
          <div
            key={product.id}
            onClick={() => onQuickReply?.(`Detalhes ${product.name}`)}
            style={{
              minWidth: "220px",
              maxWidth: "240px",
              flex: "0 0 220px",
              scrollSnapAlign: "start",
              cursor: "pointer",
            }}
          >
            {/* Premium Card — dark surface, large image, clean typography */}
            <div
              style={{
                background: "var(--aacp-surface-2, rgba(255,255,255,0.04))",
                border: "1px solid var(--aacp-line)",
                borderRadius: "14px",
                overflow: "hidden",
                display: "flex",
                flexDirection: "column",
                height: "100%",
                transition: "border-color 0.2s ease, transform 0.2s ease, box-shadow 0.2s ease",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = "var(--aacp-accent)";
                e.currentTarget.style.transform = "translateY(-3px)";
                e.currentTarget.style.boxShadow = "0 8px 24px rgba(0,0,0,0.2)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = "var(--aacp-line)";
                e.currentTarget.style.transform = "none";
                e.currentTarget.style.boxShadow = "none";
              }}
            >
              {/* Product image — tall, centered, dark bg */}
              <div
                style={{
                  width: "100%",
                  height: "160px",
                  background: product.image
                    ? "var(--aacp-surface-3, rgba(255,255,255,0.06))"
                    : "linear-gradient(135deg, var(--aacp-surface-2, rgba(255,255,255,0.04)), var(--aacp-surface-3, rgba(255,255,255,0.08)))",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  padding: "16px",
                  position: "relative",
                }}
              >
                {product.image ? (
                  <img
                    src={product.image}
                    alt={product.name}
                    style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }}
                  />
                ) : (
                  <div style={{ fontSize: "48px", fontWeight: 800, color: "var(--aacp-accent)", opacity: 0.25, fontFamily: "var(--aacp-font-display, var(--aacp-font))", letterSpacing: "-2px" }}>
                    {product.name.charAt(0).toUpperCase()}
                  </div>
                )}
                {/* Discount badge */}
                {(product as any).discountPercent > 0 && (
                  <div style={{ position: "absolute", top: "8px", left: "8px", padding: "3px 8px", borderRadius: "6px", background: "var(--aacp-accent)", color: "#fff", fontSize: "10px", fontWeight: 700, letterSpacing: "0.02em" }}>
                    -{(product as any).discountPercent}%
                  </div>
                )}
              </div>

              {/* Card body */}
              <div style={{ padding: "16px 16px 18px", display: "flex", flexDirection: "column", gap: "4px", flex: 1, textAlign: "center" }}>
                {/* Product name */}
                <h4 style={{
                  fontSize: "13.5px",
                  fontWeight: 600,
                  margin: 0,
                  color: "var(--aacp-fg)",
                  lineHeight: 1.35,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  display: "-webkit-box",
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: "vertical",
                }}>
                  {product.name}
                </h4>

                {/* Short description / stock hint */}
                <span style={{ fontSize: "11px", color: "var(--aacp-muted)", marginTop: "2px" }}>
                  {product.inStock ? "Pronta entrega" : "Indisponível"}
                </span>

                {/* Variant pills (if available) */}
                {product.variants && product.variants.length > 1 && (
                  <div style={{ display: "flex", gap: "4px", justifyContent: "center", marginTop: "6px", flexWrap: "wrap" }}>
                    {product.variants.slice(0, 4).map((v) => (
                      <span key={v.id} style={{ fontSize: "9px", padding: "2px 6px", borderRadius: "4px", border: "1px solid var(--aacp-line)", color: "var(--aacp-muted)", fontWeight: 500 }}>
                        {v.value}
                      </span>
                    ))}
                    {product.variants.length > 4 && (
                      <span style={{ fontSize: "9px", padding: "2px 6px", color: "var(--aacp-muted)" }}>+{product.variants.length - 4}</span>
                    )}
                  </div>
                )}

                {/* Spacer */}
                <div style={{ flex: 1, minHeight: "10px" }} />

                {/* Price — large, accent, bold + old price strikethrough */}
                <div style={{ marginTop: "8px", display: "flex", flexDirection: "column", alignItems: "center", gap: "2px" }}>
                  <span style={{
                    fontSize: "20px",
                    fontWeight: 800,
                    color: "var(--aacp-accent)",
                    letterSpacing: "-0.02em",
                  }}>
                    {product.priceFormatted}
                  </span>
                  {(product as any).originalPriceFormatted && (
                    <span style={{ fontSize: "11px", color: "var(--aacp-muted)", textDecoration: "line-through" }}>
                      {(product as any).originalPriceFormatted}
                    </span>
                  )}
                </div>

                {/* Promo badge (if has old price) */}
                {product.inStock && (
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "6px", marginTop: "6px" }}>
                    <span style={{
                      fontSize: "9.5px",
                      fontWeight: 600,
                      padding: "3px 8px",
                      borderRadius: "4px",
                      background: "color-mix(in srgb, var(--aacp-success) 15%, transparent)",
                      color: "var(--aacp-success)",
                      letterSpacing: "0.02em",
                    }}>
                      Em estoque
                    </span>
                  </div>
                )}

                {/* Add to cart button */}
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); onQuickReply?.(`Adicionar ${product.name} ao carrinho`); }}
                  disabled={!product.inStock}
                  style={{
                    width: "100%",
                    padding: "9px 12px",
                    borderRadius: "8px",
                    border: "none",
                    background: product.inStock ? "var(--aacp-accent)" : "var(--aacp-surface-3, rgba(255,255,255,0.08))",
                    color: product.inStock ? "#fff" : "var(--aacp-muted)",
                    fontSize: "11.5px",
                    fontWeight: 600,
                    cursor: product.inStock ? "pointer" : "not-allowed",
                    opacity: product.inStock ? 1 : 0.5,
                    fontFamily: "inherit",
                    transition: "all 0.15s ease",
                    marginTop: "12px",
                    letterSpacing: "0.01em",
                  }}
                >
                  Adicionar ao carrinho
                </button>
              </div>
            </div>
          </div>
        ))}

        {/* Sentinel for infinite scroll */}
        {cursor && (
          <div ref={observerRef} style={{ minWidth: "60px", flex: "0 0 60px", display: "flex", alignItems: "center", justifyContent: "center" }}>
            {loadingMore ? (
              <div style={{ display: "flex", gap: "4px" }}>
                {[0, 1, 2].map((i) => <span key={i} style={{ width: "5px", height: "5px", borderRadius: "50%", background: "var(--aacp-muted)", animation: "dot-pulse 1.2s infinite", animationDelay: `${i * 0.2}s` }} />)}
              </div>
            ) : (
              <span style={{ fontSize: "18px", color: "var(--aacp-muted)", opacity: 0.4 }}>›</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
