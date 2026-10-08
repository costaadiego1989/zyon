"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { FiChevronLeft, FiChevronRight } from "react-icons/fi";
import type { ProductCarouselBlock as ProductCarouselBlockType, ProductCardBlock } from "@/lib/types";
import { productsApi } from "@/lib/api/api-client";
import CatalogProductCard from "./CatalogProductCard";
import { catalogProductStyles as styles } from "@zyon/checkout-ui/catalog-product-card";

const currency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const variantIdPattern = /^[A-Za-z0-9_-]{1,191}$/;

export default function ProductCarouselBlock({ block, onQuickReply }: {
  block: ProductCarouselBlockType;
  onQuickReply?: (option: string) => void;
}) {
  const { data } = block;
  const scrollRef = useRef<HTMLDivElement>(null);
  const observerRef = useRef<HTMLDivElement>(null);
  const trackId = useId();
  const [scrollEdges, setScrollEdges] = useState({ previous: false, next: false });
  const [products, setProducts] = useState<ProductCardBlock["data"][]>(data.products);
  const [cursor, setCursor] = useState(data.nextCursor);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const loading = useRef(false);
  const loadMore = useCallback(async () => {
    if (!cursor || loading.current || !data.merchantId) return;
    loading.current = true;
    setLoadingMore(true);
    setLoadError(false);
    try {
      const result = await productsApi.list(data.merchantId, { query: data.query, categoryId: data.categoryId, limit: 10, cursor });
      const next = result.products.map((p) => ({ ...p, priceFormatted: currency.format(p.price), variants: p.variants?.map((variant) => ({ ...variant, name: variant.value })) }));
      setProducts((previous) => [...previous, ...next.filter((p) => !previous.some((existing) => existing.id === p.id))]);
      setCursor(result.nextCursor ?? undefined);
    } catch { setLoadError(true); }
    finally { loading.current = false; setLoadingMore(false); }
  }, [cursor, data.merchantId, data.query, data.categoryId]);

  useEffect(() => {
    const track = scrollRef.current;
    if (!track) return;
    const updateEdges = () => setScrollEdges({
      previous: track.scrollLeft > 2,
      next: track.scrollLeft + track.clientWidth < track.scrollWidth - 2,
    });
    updateEdges();
    track.addEventListener("scroll", updateEdges, { passive: true });
    const observer = new ResizeObserver(updateEdges);
    observer.observe(track);
    return () => {
      track.removeEventListener("scroll", updateEdges);
      observer.disconnect();
    };
  }, [products.length, cursor, loadError]);

  useEffect(() => {
    const target = observerRef.current;
    if (!target || loadError) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting && cursor && !loadingMore) void loadMore();
    }, { root: scrollRef.current, rootMargin: "0px 120px", threshold: 0.1 });
    observer.observe(target);
    return () => observer.disconnect();
  }, [cursor, loadingMore, loadError, loadMore]);

  const scroll = (direction: number) => {
    const track = scrollRef.current;
    if (track) track.scrollBy({ left: direction * (track.firstElementChild?.getBoundingClientRect().width ?? 250) + direction * 16, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  };

  return <section className={styles.carousel} aria-label="Produtos da loja">
    {products.length > 1 ? <div className={styles.navigation}>
      <span>Explore os produtos</span>
    </div> : null}
    <div className={styles.slider}>
    <div id={trackId} ref={scrollRef} className={styles.track} tabIndex={0} aria-label="Lista de produtos; deslize para explorar">
      {products.map(product => {
        const singleVariantId = product.variants?.length === 1 && variantIdPattern.test(product.variants[0].id)
          ? product.variants[0].id : undefined;
        const addToCart = () => onQuickReply?.(singleVariantId
          ? `Adicionar ${product.name} ao carrinho [variantId:${singleVariantId}]`
          : "Adicionar " + product.name + " ao carrinho");
        return <CatalogProductCard key={product.id} product={product} onQuickReply={onQuickReply} onAdd={addToCart} />;
      })}
      {cursor ? <div ref={observerRef} className={styles.more} role="status">{loadError ? <><span>Não foi possível carregar mais produtos.</span><button data-neu="control" type="button" onClick={() => void loadMore()}>Tentar novamente</button></> : loadingMore ? "Carregando…" : "Mais produtos"}</div> : null}
    </div>
    {products.length > 1 ? <>
      <button data-neu="control" className={`${styles.arrow} ${styles.previous}`} type="button" aria-label="Produtos anteriores" aria-controls={trackId} disabled={!scrollEdges.previous} onClick={() => scroll(-1)}><FiChevronLeft aria-hidden="true" /></button>
      <button data-neu="control" className={`${styles.arrow} ${styles.next}`} type="button" aria-label="Próximos produtos" aria-controls={trackId} disabled={!scrollEdges.next} onClick={() => scroll(1)}><FiChevronRight aria-hidden="true" /></button>
    </> : null}
    </div>
  </section>;
}
