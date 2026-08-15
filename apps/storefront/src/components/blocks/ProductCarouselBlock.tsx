"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ProductCarouselBlock as ProductCarouselBlockType, ProductCardBlock } from "@/lib/types";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3009";

function formatPrice(value: number): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);
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

  // Fetch next page
  const loadMore = useCallback(async () => {
    if (!cursor || loadingMore) return;
    if (!data.merchantId) return;
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
        priceFormatted: formatPrice((p.variants?.[0]?.basePriceInCents ?? 0) / 100),
        image: p.variants?.[0]?.media?.[0]?.url,
        inStock: p.variants?.some((v: any) => (v.stockQuantity ?? 0) - (v.stockReserved ?? 0) > 0) ?? false,
        variants: p.variants?.map((v: any) => ({ id: v.id, name: v.sku, value: v.sku })),
      }));
      setProducts((prev) => [...prev, ...newProducts]);
      setCursor(result.nextCursor ?? undefined);
    } catch {
      // Non-critical
    } finally {
      setLoadingMore(false);
    }
  }, [cursor, loadingMore, data.merchantId, data.query, data.categoryId]);

  // Intersection observer on sentinel element
  useEffect(() => {
    if (!observerRef.current) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && cursor && !loadingMore) {
          void loadMore();
        }
      },
      { root: scrollRef.current, threshold: 0.1 }
    );
    observer.observe(observerRef.current);
    return () => observer.disconnect();
  }, [cursor, loadingMore, loadMore]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "6px", position: "relative", margin: "0 -18px", padding: "0 18px" }}>
      <style>{`
        .aacp-carousel-scroll::-webkit-scrollbar { display: none; }
        .aacp-carousel-scroll { -ms-overflow-style: none; scrollbar-width: none; }
      `}</style>

      <div
        ref={scrollRef}
        className="aacp-carousel-scroll"
        style={{
          display: "flex",
          gap: "10px",
          overflowX: "auto",
          paddingBottom: "4px",
          scrollSnapType: "x mandatory",
          WebkitOverflowScrolling: "touch",
          scrollBehavior: "smooth",
        }}
      >
        {products.map((product) => (
          <div key={product.id} style={{ minWidth: "160px", maxWidth: "180px", flex: "0 0 160px", scrollSnapAlign: "start" }}>
            <article
              onClick={() => onQuickReply?.(`Detalhes ${product.name}`)}
              style={{ background: "var(--aacp-surface)", border: "1px solid var(--aacp-line)", borderRadius: "10px", overflow: "hidden", boxShadow: "0 2px 8px rgba(0,0,0,0.06)", display: "flex", flexDirection: "column", height: "100%", cursor: "pointer", transition: "border-color 0.18s ease, transform 0.15s ease" }}
              onMouseEnter={(e) => { e.currentTarget.style.borderColor = "var(--aacp-accent)"; e.currentTarget.style.transform = "translateY(-2px)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--aacp-line)"; e.currentTarget.style.transform = "none"; }}
            >
              {/* Image */}
              <div aria-hidden style={{ width: "100%", height: "120px", borderRadius: "10px 10px 0 0", background: product.image ? `url(${product.image}) center / cover` : "linear-gradient(135deg, color-mix(in srgb, var(--aacp-accent) 12%, transparent), color-mix(in srgb, var(--aacp-accent) 4%, transparent))", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--aacp-muted)", fontSize: "32px" }}>
                {!product.image && "🛍️"}
              </div>

              {/* Body */}
              <div style={{ padding: "10px 10px 12px", display: "flex", flexDirection: "column", gap: "6px", flex: 1 }}>
                <h4 style={{ fontSize: "13px", fontWeight: 700, margin: 0, color: "var(--aacp-fg)", lineHeight: 1.3, overflow: "hidden", textOverflow: "ellipsis", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>{product.name}</h4>
                <span style={{ fontSize: "14px", fontWeight: 800, color: "var(--aacp-accent)" }}>{product.priceFormatted}</span>
                <span style={{ fontSize: "9px", fontWeight: 600, padding: "3px 6px", borderRadius: "4px", background: product.inStock ? "color-mix(in srgb, var(--aacp-success) 15%, transparent)" : "color-mix(in srgb, #ef4444 15%, transparent)", color: product.inStock ? "var(--aacp-success)" : "#ef4444", border: `1px solid ${product.inStock ? "color-mix(in srgb, var(--aacp-success) 30%, transparent)" : "color-mix(in srgb, #ef4444 30%, transparent)"}`, textTransform: "uppercase", letterSpacing: "0.3px", alignSelf: "flex-start" }}>
                  {product.inStock ? "Em estoque" : "Esgotado"}
                </span>
                <div style={{ flex: 1 }} />
                {/* Single add button */}
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); onQuickReply?.(`Adicionar ${product.name} ao carrinho`); }}
                  disabled={!product.inStock}
                  style={{ width: "100%", padding: "7px 8px", borderRadius: "7px", border: "none", background: product.inStock ? "var(--aacp-accent)" : "var(--aacp-muted)", color: "#fff", fontSize: "10.5px", fontWeight: 600, cursor: product.inStock ? "pointer" : "not-allowed", opacity: product.inStock ? 1 : 0.5, fontFamily: "inherit", transition: "all 0.15s ease", marginTop: "8px" }}
                >
                  Adicionar ao carrinho
                </button>
              </div>
            </article>
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
              <span style={{ fontSize: "10px", color: "var(--aacp-muted)" }}>→</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
