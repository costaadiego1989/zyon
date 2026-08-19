"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ProductCarouselBlock as ProductCarouselBlockType, ProductCardBlock } from "@/lib/types";
import { productsApi } from "@/lib/api/api-client";
import ImageSlideshow from "../ImageSlideshow";

function formatPrice(cents: number): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);
}

/** Mini image slider for product cards with multiple images */
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
      const result = await productsApi.list(data.merchantId, {
        query: data.query,
        categoryId: data.categoryId,
        limit: 10,
        cursor,
      });
      const newProducts: ProductCardBlock["data"][] = result.products.map((p: any) => ({
        id: p.id,
        name: p.name,
        description: p.description,
        price: p.variants?.[0]?.basePriceInCents ?? 0,
        priceFormatted: formatPrice(p.variants?.[0]?.basePriceInCents ?? 0),
        image: p.variants?.[0]?.media?.[0]?.url,
        images: p.variants?.[0]?.media?.map((m: any) => m.url) ?? [],
        inStock: p.type === "digital" || p.type === "service" || (p.variants?.some((v: any) => (v.stockQuantity ?? 0) - (v.stockReserved ?? 0) > 0) ?? false),
        rating: p.averageRating,
        reviewCount: p.reviewCount,
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

  const scrollLeft = () => {
    scrollRef.current?.scrollBy({ left: -240, behavior: "smooth" });
  };
  const scrollRight = () => {
    scrollRef.current?.scrollBy({ left: 240, behavior: "smooth" });
  };

  return (
    <div style={{ position: "relative", margin: "0 -18px", padding: "0 18px" }}>
      <style>{`
        .aacp-carousel-scroll::-webkit-scrollbar { display: none; }
        .aacp-carousel-scroll { -ms-overflow-style: none; scrollbar-width: none; }
      `}</style>

      {/* Left arrow */}
      {products.length > 2 && (
        <button
          type="button"
          onClick={scrollLeft}
          aria-label="Anterior"
          style={{
            position: "absolute",
            left: "4px",
            top: "50%",
            transform: "translateY(-50%)",
            zIndex: 2,
            width: "32px",
            height: "32px",
            borderRadius: "50%",
            border: "1px solid var(--aacp-line)",
            background: "var(--aacp-surface)",
            color: "var(--aacp-muted)",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            boxShadow: "0 2px 8px rgba(0,0,0,0.1)",
            transition: "all 0.15s ease",
          }}
          onMouseEnter={(e) => { e.currentTarget.style.borderColor = "var(--aacp-accent)"; e.currentTarget.style.color = "var(--aacp-accent)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--aacp-line)"; e.currentTarget.style.color = "var(--aacp-muted)"; }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6"/></svg>
        </button>
      )}

      {/* Right arrow */}
      {products.length > 2 && (
        <button
          type="button"
          onClick={scrollRight}
          aria-label="Próximo"
          style={{
            position: "absolute",
            right: "4px",
            top: "50%",
            transform: "translateY(-50%)",
            zIndex: 2,
            width: "32px",
            height: "32px",
            borderRadius: "50%",
            border: "1px solid var(--aacp-line)",
            background: "var(--aacp-surface)",
            color: "var(--aacp-muted)",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            boxShadow: "0 2px 8px rgba(0,0,0,0.1)",
            transition: "all 0.15s ease",
          }}
          onMouseEnter={(e) => { e.currentTarget.style.borderColor = "var(--aacp-accent)"; e.currentTarget.style.color = "var(--aacp-accent)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--aacp-line)"; e.currentTarget.style.color = "var(--aacp-muted)"; }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18l6-6-6-6"/></svg>
        </button>
      )}

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
              {/* Product image — tall, centered, with slide if multiple */}
              <div
                style={{
                  width: "100%",
                  height: "160px",
                  background: (product as any).images?.length > 0 || product.image
                    ? "var(--aacp-surface-3, rgba(255,255,255,0.06))"
                    : "linear-gradient(135deg, var(--aacp-surface-2, rgba(255,255,255,0.04)), var(--aacp-surface-3, rgba(255,255,255,0.08)))",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  padding: "16px",
                  position: "relative",
                }}
              >
                {(() => {
                  const images: string[] = (product as any).images?.length > 0
                    ? (product as any).images
                    : product.image ? [product.image] : [];
                  if (images.length > 0) {
                    return <ImageSlideshow images={images} alt={product.name} objectFit="contain" showDots={images.length > 1} showArrows={images.length > 1} />;
                  }
                  return (
                    <div style={{ fontSize: "48px", fontWeight: 800, color: "var(--aacp-accent)", opacity: 0.25, fontFamily: "var(--aacp-font-display, var(--aacp-font))", letterSpacing: "-2px" }}>
                      {product.name.charAt(0).toUpperCase()}
                    </div>
                  );
                })()}
                {/* Stock badge — top right */}
                <div style={{
                  position: "absolute",
                  top: "8px",
                  right: "8px",
                  padding: "3px 8px",
                  borderRadius: "6px",
                  background: product.inStock ? "color-mix(in srgb, var(--aacp-success) 15%, var(--aacp-surface))" : "color-mix(in srgb, #ef4444 12%, var(--aacp-surface))",
                  border: product.inStock ? "1px solid color-mix(in srgb, var(--aacp-success) 30%, transparent)" : "1px solid color-mix(in srgb, #ef4444 30%, transparent)",
                  fontSize: "9.5px",
                  fontWeight: 600,
                  color: product.inStock ? "var(--aacp-success)" : "#ef4444",
                  letterSpacing: "0.02em",
                }}>
                  {product.inStock ? "Pronta entrega" : "Indisponível"}
                </div>
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

                {/* Brief description (max 150 chars) */}
                {(product as any).description && (
                  <p style={{
                    fontSize: "11px",
                    color: "var(--aacp-muted)",
                    margin: "4px 0 0",
                    lineHeight: 1.4,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    display: "-webkit-box",
                    WebkitLineClamp: 3,
                    WebkitBoxOrient: "vertical",
                    textAlign: "left",
                  }}>
                    {(product as any).description.length > 150
                      ? (product as any).description.slice(0, 150) + "…"
                      : (product as any).description}
                  </p>
                )}

                {/* Star rating — always show, placeholder if no rating */}
                <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "4px", marginTop: "6px" }}>
                  <span style={{ display: "inline-flex", gap: "1px", fontSize: "12px", lineHeight: 1, color: "#F5B301" }} aria-label={(product as any).rating != null ? `${((product as any).rating as number).toFixed(1)} de 5` : "Sem avaliações"}>
                    {Array.from({ length: 5 }).map((_, i) => {
                      const rating = ((product as any).rating as number) ?? 0;
                      const filled = i < Math.floor(rating);
                      const partial = !filled && i === Math.floor(rating) && rating % 1 >= 0.3;
                      return (
                        <span key={i} style={{ position: "relative", display: "inline-block" }}>
                          <span style={{ color: "rgba(245, 179, 1, 0.22)" }}>★</span>
                          {(filled || partial) && (
                            <span style={{ position: "absolute", inset: 0, width: filled ? "100%" : `${(rating % 1) * 100}%`, overflow: "hidden", color: "#F5B301" }}>★</span>
                          )}
                        </span>
                      );
                    })}
                  </span>
                  {(product as any).rating != null ? (
                    <>
                      <span style={{ fontSize: "10px", fontWeight: 600, color: "var(--aacp-fg)" }}>{((product as any).rating as number).toFixed(1)}</span>
                      <span style={{ fontSize: "10px", color: "var(--aacp-muted)" }}>({(product as any).reviewCount ?? 0})</span>
                    </>
                  ) : (
                    <span style={{ fontSize: "10px", color: "var(--aacp-muted)", fontStyle: "italic" }}>Sem avaliações</span>
                  )}
                </div>

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

                {/* "Saber mais" outline button */}
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); onQuickReply?.(`Detalhes ${product.name}`); }}
                  style={{
                    width: "100%",
                    padding: "9px 12px",
                    borderRadius: "8px",
                    border: "1.5px solid var(--aacp-accent)",
                    background: "transparent",
                    color: "var(--aacp-accent)",
                    fontSize: "11.5px",
                    fontWeight: 600,
                    cursor: "pointer",
                    fontFamily: "inherit",
                    transition: "all 0.15s ease",
                    marginTop: "12px",
                    letterSpacing: "0.01em",
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = "color-mix(in srgb, var(--aacp-accent) 10%, transparent)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                >
                  Saber mais
                </button>

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
                    marginTop: "6px",
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
