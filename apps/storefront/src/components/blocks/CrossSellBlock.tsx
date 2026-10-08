"use client";
import type { CrossSellInterstitialData } from "@/lib/viewmodels/useConversationViewModel";
import CatalogProductCard from "./CatalogProductCard";
import { catalogProductStyles as styles } from "@zyon/checkout-ui/catalog-product-card";

export default function CrossSellBlock({ block, onQuickReply }: {
  block: { type: "cross_sell"; data: CrossSellInterstitialData & { displayMode?: string } };
  onQuickReply?: (text: string) => void;
}) {
  const { data } = block;
  if (!data.products.length) return null;
  return <section data-aacp-cross-sell-mode={data.displayMode ?? "inline"} className={styles.carousel}
    style={{ minWidth: 0, border: "1px solid var(--aacp-line)", borderRadius: 14, background: "var(--aacp-surface)", padding: 16 }}>
    <p style={{ margin: "0 0 14px", fontSize: 14, fontWeight: 700 }}>{data.trigger || "Você também pode gostar"}</p>
    <div className={styles.track} tabIndex={0} aria-label="Produtos complementares; deslize para explorar">
      {data.products.map(product => <CatalogProductCard key={product.id} product={product} onQuickReply={onQuickReply}
        onAdd={() => {
          const tags = `[variantId:${product.id}]${product.promoId ? `[crossSellPromoId:${product.promoId}]` : ""}`;
          onQuickReply?.(`Adicionar ${product.name} ao carrinho ${tags}`);
          if (product.couponCode) setTimeout(() => onQuickReply?.(`Aplicar cupom ${product.couponCode}`), 400);
        }} />)}
    </div>
  </section>;
}
