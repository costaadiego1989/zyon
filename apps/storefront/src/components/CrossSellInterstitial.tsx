"use client";

import { useRef } from "react";
import { useModalFocus } from "@zyon/checkout-ui";
import type { CrossSellInterstitialData } from "@/lib/viewmodels/useConversationViewModel";
import CatalogProductCard from "./blocks/CatalogProductCard";
import { catalogProductStyles as catalogStyles } from "@zyon/checkout-ui/catalog-product-card";
import { THEME_TOKENS, type Theme } from "./conversation/theme-tokens";

interface CrossSellInterstitialProps {
  data: CrossSellInterstitialData | null;
  onClose: () => void;
  onViewCart: () => void;
  onAddItem: (productId: string, productName: string, promoId?: string, couponCode?: string) => void;
  onQuickReply?: (message: string) => void;
  theme?: Theme;
  primaryLabel?: string;
  busy?: boolean;
  addedIds?: string[];
  error?: string | null;
}

export default function CrossSellInterstitial({ data, onClose, onViewCart, onAddItem, onQuickReply,
  theme = "dark", primaryLabel = "Ver carrinho", busy = false, addedIds = [], error }: CrossSellInterstitialProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const scopeRef = useRef<HTMLDivElement>(null);
  useModalFocus(Boolean(data?.products.length), dialogRef, () => { if (!busy) onClose(); }, scopeRef);
  if (!data?.products.length) return null;

  return <div ref={scopeRef}>
    <div role="presentation" onClick={() => { if (!busy) onClose(); }} style={{ position: "fixed", inset: 0,
      background: "rgba(0,0,0,0.45)", zIndex: 9998, animation: "crossSellFadeIn .2s ease" }} />
    <div ref={dialogRef} tabIndex={-1} data-testid="cross-sell-dialog" role="dialog" aria-modal="true"
      aria-label="Sugestões para completar seu pedido" style={{ position: "fixed", left: 0, right: 0, bottom: 0,
        zIndex: 9999, maxWidth: 560, margin: "0 auto", maxHeight: "82dvh", display: "flex", flexDirection: "column",
        background: THEME_TOKENS[theme]["--aacp-panel-bg"], isolation: "isolate", color: "var(--aacp-fg)",
        borderRadius: "20px 20px 0 0", borderTop: "1px solid var(--aacp-line)", boxShadow: "0 -12px 48px rgba(0,0,0,.28)",
        animation: "crossSellSlideUp .32s cubic-bezier(.22,1,.36,1)", overflow: "hidden" }}>
      <style>{`
        @keyframes crossSellSlideUp { from { transform: translateY(100%); } to { transform: translateY(0); } }
        @keyframes crossSellFadeIn { from { opacity: 0; } to { opacity: 1; } }
        @media (prefers-reduced-motion: reduce) {
          @keyframes crossSellSlideUp { from { opacity: 1; } to { opacity: 1; } }
          @keyframes crossSellFadeIn { from { opacity: 1; } to { opacity: 1; } }
        }
      `}</style>
      <header style={{ flexShrink: 0, padding: "18px 20px 14px", display: "flex", alignItems: "center", gap: 12 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>Complete seu pedido</h2>
          <p style={{ margin: "4px 0 0", color: "var(--aacp-muted)", fontSize: 13, lineHeight: 1.4 }}>{data.trigger}</p>
        </div>
        <button data-neu="icon" type="button" onClick={onClose} disabled={busy} aria-label="Fechar"
          style={{ width: 40, height: 40, flexShrink: 0, display: "grid", placeItems: "center", borderRadius: "50%",
            border: "1px solid var(--aacp-line)", background: "var(--aacp-surface)", color: "inherit", cursor: "pointer" }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="m6 6 12 12M6 18 18 6" /></svg>
        </button>
      </header>
      <div className={catalogStyles.carousel} style={{ minHeight: 0, overflowY: "auto", padding: "0 18px", boxSizing: "border-box" }}>
        <div className={catalogStyles.track} tabIndex={0} aria-label="Produtos complementares; deslize para explorar">
          {data.products.map(product => <CatalogProductCard key={product.id} product={product} onQuickReply={onQuickReply}
            busy={busy} added={addedIds.includes(product.id)} onAdd={() => onAddItem(product.id, product.name, product.promoId, product.couponCode)} />)}
        </div>
      </div>
      {error ? <p role="alert" style={{ flexShrink: 0, margin: "0 20px 12px", color: "var(--aacp-error, #f87171)", fontSize: 13 }}>{error}</p> : null}
      <footer style={{ flexShrink: 0, display: "flex", gap: 10, padding: "14px 20px max(16px, env(safe-area-inset-bottom))",
        borderTop: "1px solid var(--aacp-line)" }}>
        <button data-neu="control" type="button" onClick={onClose} disabled={busy} style={{ flex: 1, minHeight: 44,
          padding: "12px 10px", borderRadius: 8, border: "1px solid var(--aacp-line)", background: "transparent",
          color: "inherit", font: "inherit", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>Continuar comprando</button>
        <button data-neu="primary" type="button" onClick={onViewCart} disabled={busy} style={{ flex: 1, minHeight: 44,
          padding: "12px 10px", borderRadius: 8, border: "1px solid var(--aacp-accent)", background: "var(--aacp-accent)",
          color: "var(--aacp-on-accent, #fff)", font: "inherit", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
          {busy ? "Adicionando…" : primaryLabel}
        </button>
      </footer>
    </div>
  </div>;
}
