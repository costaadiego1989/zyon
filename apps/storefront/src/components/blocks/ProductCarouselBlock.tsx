"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { FiChevronLeft, FiChevronRight, FiHeart, FiPackage, FiStar } from "react-icons/fi";
import type { ProductCarouselBlock as ProductCarouselBlockType, ProductCardBlock } from "@/lib/types";
import { productsApi } from "@/lib/api/api-client";
import RuleNotices from "./RuleNotices";
import ImageSlideshow from "../ImageSlideshow";
import styles from "./ProductCarouselBlock.module.css";

const currency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

export default function ProductCarouselBlock({ block, onQuickReply }: {
  block: ProductCarouselBlockType;
  onQuickReply?: (option: string) => void;
}) {
  const { data } = block;
  const scrollRef = useRef<HTMLDivElement>(null);
  const observerRef = useRef<HTMLDivElement>(null);
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
      <div><button type="button" aria-label="Produtos anteriores" onClick={() => scroll(-1)}><FiChevronLeft /></button><button type="button" aria-label="Próximos produtos" onClick={() => scroll(1)}><FiChevronRight /></button></div>
    </div> : null}
    <div ref={scrollRef} className={styles.track} tabIndex={0} aria-label="Lista de produtos; deslize para explorar">
      {products.map((product) => {
        const images = product.images?.length ? product.images : product.image ? [product.image] : [];
        const details = () => onQuickReply?.("Detalhes " + product.name);
        const customizable = (product.variants?.length ?? 0) > 1 || (product.optionGroups?.length ?? 0) > 0;
        return <article key={product.id} className={styles.card} data-aacp-carousel-product={product.id}>
          <div className={styles.media} onClick={details}>
            {images.length ? <ImageSlideshow images={images} alt={product.name} objectFit="cover" /> : <div className={styles.noImage}><FiPackage aria-hidden="true" /><span>Imagem indisponível</span></div>}
            <span className={styles.stock} data-available={product.inStock}>{product.inStock ? "Pronta entrega" : "Indisponível"}</span>
            {(product.discountPercent ?? 0) > 0 ? <span className={styles.discount}>−{product.discountPercent}%</span> : null}
            <button type="button" className={styles.wishlist} aria-label={"Adicionar " + product.name + " à lista de desejos"} onClick={(event) => { event.stopPropagation(); onQuickReply?.("Adicionar " + product.name + " à lista de desejos"); }}><FiHeart aria-hidden="true" /></button>
          </div>
          <div className={styles.body}>
            <h4><button type="button" onClick={details}>{product.name}</button></h4>
            {product.description ? <p className={styles.description}>{product.description}</p> : null}
            <div className={styles.rating}>
              {product.rating != null && (product.reviewCount ?? 0) > 0 ? <><FiStar aria-hidden="true" /><strong>{product.rating.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}</strong><span>({product.reviewCount} avaliações)</span></> : <span>Ainda sem avaliações</span>}
            </div>
            {product.variants && product.variants.length > 1 ? <div className={styles.variants}>{product.variants.slice(0, 3).map((variant) => <span key={variant.id}>{variant.value}</span>)}{product.variants.length > 3 ? <span>+{product.variants.length - 3}</span> : null}</div> : null}
            <div className={styles.price}>{product.originalPriceFormatted ? <del>{product.originalPriceFormatted}</del> : null}<strong>{product.priceFormatted}</strong></div>
            {product.source === "marketplace" && product.sellerName ? <p className={styles.seller}>Vendido por {product.sellerName}</p> : null}
            <RuleNotices notices={product.ruleNotices} />
            <div className={styles.ctas}>
              <button type="button" onClick={details}>Saber mais</button>
              <button type="button" className={styles.buy} disabled={!product.inStock} onClick={() => customizable ? details() : onQuickReply?.("Adicionar " + product.name + " ao carrinho")}>{customizable ? "Escolher opções" : "Adicionar ao carrinho"}</button>
            </div>
          </div>
        </article>;
      })}
      {cursor ? <div ref={observerRef} className={styles.more} role="status">{loadError ? <><span>Não foi possível carregar mais produtos.</span><button type="button" onClick={() => void loadMore()}>Tentar novamente</button></> : loadingMore ? "Carregando…" : "Mais produtos"}</div> : null}
    </div>
  </section>;
}
