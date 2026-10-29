"use client";
import type { ReactNode } from "react";
import styles from "./CatalogProductCard.module.css";
export const catalogProductStyles = styles;

export interface CatalogProductData {
  id: string; name: string; price: number; priceFormatted: string; inStock: boolean;
  image?: string; images?: string[]; description?: string;
  rating?: number; reviewCount?: number; originalPriceFormatted?: string; discountPercent?: number;
  variants?: Array<{ id: string; value: string }>;
  optionGroups?: unknown[]; source?: "local" | "marketplace"; sellerName?: string;
  ruleNotices?: Array<{ ruleId?: string; message: string }>;
}
export default function CatalogProductCard({ product, onQuickReply, onDetails, onAdd, busy = false, added = false, disabled = false, hideWishlist = false, addLabel, addAriaLabel, busyLabel, addTestId, renderImages, renderRuleNotices }: {
  product: CatalogProductData; onQuickReply?: (message: string) => void; onAdd?: () => void;
  onDetails?: () => void; busy?: boolean; added?: boolean; disabled?: boolean; hideWishlist?: boolean;
  addLabel?: string; addAriaLabel?: string; busyLabel?: string; addTestId?: string;
  renderImages?: (images: string[], alt: string) => ReactNode;
  renderRuleNotices?: (notices: CatalogProductData["ruleNotices"]) => ReactNode;
}) {
  const images = product.images?.length ? product.images : product.image ? [product.image] : [];
  const details = () => { if (!busy && !disabled) { if (onDetails) onDetails(); else onQuickReply?.("Detalhes " + product.name); } };
  const customizable = (product.variants?.length ?? 0) > 1 || (product.optionGroups?.length ?? 0) > 0;
  const add = () => {
    if (busy || added || disabled) return;
    if (customizable) details();
    else if (onAdd) onAdd();
    else onQuickReply?.("Adicionar " + product.name + " ao carrinho");
  };
  return <article className={styles.card} data-aacp-carousel-product={product.id} aria-busy={busy || undefined}>
    <div className={styles.media} onClick={details}>
      {images.length ? (renderImages ? renderImages(images, product.name) : <img src={images[0]} alt={product.name} loading="lazy" style={{ width: "100%", height: "100%", objectFit: "cover" }} />) : <div className={styles.noImage}><Icon kind="package" /><span>Imagem indisponível</span></div>}
      <span className={styles.stock} data-available={product.inStock}>{product.inStock ? "Pronta entrega" : "Indisponível"}</span>
      {(product.discountPercent ?? 0) > 0 ? <span className={styles.discount}>−{product.discountPercent}%</span> : null}
      {!hideWishlist && <button data-neu="control" type="button" className={styles.wishlist} disabled={busy || disabled || !onQuickReply}
        aria-label={"Adicionar " + product.name + " à lista de desejos"}
        onClick={event => { event.stopPropagation(); onQuickReply?.("Adicionar " + product.name + " à lista de desejos"); }}><Icon kind="heart" /></button>}
    </div>
    <div className={styles.body}>
      <h4><button data-neu="text" type="button" onClick={details} disabled={busy || disabled || (!onQuickReply && !onDetails)}>{product.name}</button></h4>
      {product.description ? <p className={styles.description}>{product.description}</p> : null}
      <div className={styles.rating}>
        {product.rating != null && (product.reviewCount ?? 0) > 0 ? <><Icon kind="star" /><strong>{product.rating.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}</strong><span>({product.reviewCount} avaliações)</span></> : <span>Ainda sem avaliações</span>}
      </div>
      {product.variants && product.variants.length > 1 ? <div className={styles.variants}>{product.variants.slice(0, 3).map(variant => <span key={variant.id}>{variant.value}</span>)}{product.variants.length > 3 ? <span>+{product.variants.length - 3}</span> : null}</div> : null}
      <div className={styles.price}>{product.originalPriceFormatted ? <del>{product.originalPriceFormatted}</del> : null}<strong>{product.priceFormatted}</strong></div>
      {product.source === "marketplace" && product.sellerName ? <p className={styles.seller}>Vendido por {product.sellerName}</p> : null}
      {renderRuleNotices?.(product.ruleNotices)}
      <div className={styles.ctas}>
        <button data-neu="control" type="button" onClick={details} disabled={busy || disabled || (!onQuickReply && !onDetails)}>Saber mais</button>
        <button data-neu="primary" type="button" className={styles.buy} data-testid={addTestId} aria-label={addAriaLabel} disabled={!product.inStock || busy || added || disabled} onClick={add}>
          {added ? "Adicionado" : busy ? (busyLabel ?? "Adicionando…") : customizable ? "Escolher opções" : (addLabel ?? "Adicionar ao carrinho")}
        </button>
      </div>
    </div>
  </article>;
}
function Icon({ kind }: { kind: "heart" | "package" | "star" }) {
  return <svg aria-hidden="true" viewBox="0 0 24 24" fill={kind === "star" ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    {kind === "heart" ? <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78Z" /> : kind === "star" ? <polygon points="12 2 15.1 8.3 22 9.3 17 14.2 18.2 21.2 12 18 5.8 21.2 7 14.2 2 9.3 8.9 8.3" /> : <><path d="m16.5 9.4-9-5.2M21 8l-9 5-9-5M12 22V12" /><path d="M3 7.3a2 2 0 0 1 1-1.7l7-4a2 2 0 0 1 2 0l7 4a2 2 0 0 1 1 1.7v9.4a2 2 0 0 1-1 1.7l-7 4a2 2 0 0 1-2 0l-7-4a2 2 0 0 1-1-1.7Z" /></>}
  </svg>;
}
