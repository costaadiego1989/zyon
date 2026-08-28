"use client";

import type { CrossSellInterstitialData } from "@/lib/viewmodels/useConversationViewModel";

interface CrossSellInterstitialProps {
  data: CrossSellInterstitialData | null;
  onClose: () => void;
  onViewCart: () => void;
  onAddItem: (productId: string, productName: string) => void;
}

function getInitial(name: string): string {
  const trimmed = name.trim();
  return trimmed ? trimmed.charAt(0).toUpperCase() : "★";
}

export default function CrossSellInterstitial({
  data,
  onClose,
  onViewCart,
  onAddItem,
}: CrossSellInterstitialProps) {
  if (!data || data.products.length === 0) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        role="presentation"
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(0, 0, 0, 0.45)",
          zIndex: 9998,
          animation: "crossSellFadeIn 0.2s ease",
        }}
      />

      {/* Bottom sheet */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Sugestões para completar seu pedido"
        style={{
          position: "fixed",
          left: 0,
          right: 0,
          bottom: 0,
          zIndex: 9999,
          maxWidth: "560px",
          margin: "0 auto",
          maxHeight: "78vh",
          display: "flex",
          flexDirection: "column",
          background: "var(--aacp-panel-bg, var(--aacp-bg))",
          borderTopLeftRadius: "20px",
          borderTopRightRadius: "20px",
          borderTop: "1px solid var(--aacp-line)",
          boxShadow: "0 -12px 48px rgba(0, 0, 0, 0.28)",
          animation: "crossSellSlideUp 0.32s cubic-bezier(0.22, 1, 0.36, 1)",
          overflow: "hidden",
        }}
      >
        <style>{`
          @keyframes crossSellSlideUp {
            from { transform: translateY(100%); }
            to { transform: translateY(0); }
          }
          @keyframes crossSellFadeIn {
            from { opacity: 0; }
            to { opacity: 1; }
          }
          @media (prefers-reduced-motion: reduce) {
            @keyframes crossSellSlideUp { from { opacity: 0; } to { opacity: 1; } }
          }
          .cross-sell-scroll::-webkit-scrollbar { display: none; }
        `}</style>

        {/* Grabber */}
        <div style={{ display: "flex", justifyContent: "center", paddingTop: "10px" }}>
          <div style={{ width: "36px", height: "4px", borderRadius: "2px", background: "var(--aacp-line)" }} />
        </div>

        {/* Header — accent-led, strong */}
        <div
          style={{
            padding: "12px 20px 14px",
            display: "flex",
            alignItems: "center",
            gap: "11px",
            background:
              "linear-gradient(180deg, color-mix(in srgb, var(--aacp-accent) 12%, transparent) 0%, transparent 100%)",
          }}
        >
          <span
            aria-hidden
            style={{
              flexShrink: 0,
              width: "34px",
              height: "34px",
              borderRadius: "10px",
              background: "var(--aacp-accent)",
              color: "#fff",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="9" cy="21" r="1" />
              <circle cx="20" cy="21" r="1" />
              <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" />
            </svg>
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ margin: 0, fontSize: "15px", fontWeight: 800, color: "var(--aacp-fg)", lineHeight: 1.25 }}>
              Complete seu pedido
            </p>
            <p style={{ margin: "2px 0 0", fontSize: "12.5px", fontWeight: 500, color: "var(--aacp-muted)", lineHeight: 1.35 }}>
              {data.trigger}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            style={{
              flexShrink: 0,
              width: "30px",
              height: "30px",
              borderRadius: "50%",
              border: "none",
              background: "var(--aacp-surface-2, rgba(255,255,255,0.05))",
              color: "var(--aacp-muted)",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </button>
        </div>

        {/* Product cards — consistent with ProductCarousel layout */}
        <div
          className="cross-sell-scroll"
          style={{
            display: "flex",
            gap: "12px",
            padding: "4px 20px 20px",
            overflowX: "auto",
            overflowY: "hidden",
            scrollSnapType: "x mandatory",
            scrollbarWidth: "none",
          }}
        >
          {data.products.map((product) => (
            <div
              key={product.id}
              style={{
                minWidth: "160px",
                maxWidth: "160px",
                flexShrink: 0,
                scrollSnapAlign: "start",
                background: "var(--aacp-surface, var(--aacp-surface-2))",
                border: "1px solid var(--aacp-line)",
                borderRadius: "14px",
                overflow: "hidden",
                display: "flex",
                flexDirection: "column",
              }}
            >
              {/* Image / monogram */}
              <div
                style={{
                  position: "relative",
                  width: "100%",
                  aspectRatio: "1 / 1",
                  background:
                    "linear-gradient(135deg, var(--aacp-surface-2) 0%, var(--aacp-surface-3, var(--aacp-surface-2)) 100%)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  overflow: "hidden",
                }}
              >
                {/* Stock badge */}
                <span
                  style={{
                    position: "absolute",
                    top: "8px",
                    left: "8px",
                    padding: "3px 8px",
                    borderRadius: "6px",
                    background: product.inStock
                      ? "color-mix(in srgb, var(--aacp-success) 15%, var(--aacp-surface))"
                      : "color-mix(in srgb, #ef4444 12%, var(--aacp-surface))",
                    border: product.inStock
                      ? "1px solid color-mix(in srgb, var(--aacp-success) 30%, transparent)"
                      : "1px solid color-mix(in srgb, #ef4444 30%, transparent)",
                    fontSize: "9.5px",
                    fontWeight: 600,
                    color: product.inStock ? "var(--aacp-success)" : "#ef4444",
                  }}
                >
                  {product.inStock ? "Pronta entrega" : "Indisponível"}
                </span>
                {product.discountPercent && product.discountPercent > 0 ? (
                  <span
                    style={{
                      position: "absolute",
                      top: "8px",
                      right: "8px",
                      padding: "3px 8px",
                      borderRadius: "6px",
                      background: "#e11d48",
                      color: "#fff",
                      fontSize: "10px",
                      fontWeight: 800,
                      boxShadow: "0 2px 6px rgba(225,29,72,0.4)",
                    }}
                  >
                    -{Math.round(product.discountPercent)}%
                  </span>
                ) : null}
                {product.image ? (
                  <img src={product.image} alt={product.name} loading="lazy" style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }} />
                ) : (
                  <span
                    style={{
                      fontSize: "40px",
                      fontWeight: 800,
                      color: "color-mix(in srgb, var(--aacp-accent) 30%, transparent)",
                      fontFamily: "var(--aacp-font-display)",
                      userSelect: "none",
                    }}
                  >
                    {getInitial(product.name)}
                  </span>
                )}
              </div>

              {/* Content */}
              <div style={{ padding: "11px 11px 13px", display: "flex", flexDirection: "column", gap: "7px", flex: 1 }}>
                <span
                  style={{
                    fontSize: "12.5px",
                    fontWeight: 600,
                    color: "var(--aacp-fg)",
                    lineHeight: 1.3,
                    display: "-webkit-box",
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: "vertical",
                    overflow: "hidden",
                  }}
                >
                  {product.name}
                </span>
                <span
                  style={{
                    fontSize: "15px",
                    fontWeight: 800,
                    color: "var(--aacp-accent)",
                    fontFamily: "var(--aacp-font-display)",
                    letterSpacing: "-0.02em",
                  }}
                >
                  {product.priceFormatted}
                </span>
                <button
                  type="button"
                  onClick={() => onAddItem(product.id, product.name)}
                  disabled={!product.inStock}
                  style={{
                    marginTop: "auto",
                    width: "100%",
                    padding: "9px 8px",
                    borderRadius: "9px",
                    border: "none",
                    background: product.inStock
                      ? "var(--aacp-accent)"
                      : "color-mix(in srgb, var(--aacp-muted) 30%, var(--aacp-surface-2))",
                    color: "#fff",
                    fontSize: "12.5px",
                    fontWeight: 800,
                    fontFamily: "inherit",
                    cursor: product.inStock ? "pointer" : "not-allowed",
                    opacity: product.inStock ? 1 : 0.5,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: "5px",
                    boxShadow: product.inStock ? "0 3px 10px color-mix(in srgb, var(--aacp-accent) 40%, transparent)" : "none",
                  }}
                >
                  {product.inStock ? (
                    <>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                        <line x1="12" y1="5" x2="12" y2="19" />
                        <line x1="5" y1="12" x2="19" y2="12" />
                      </svg>
                      Adicionar
                    </>
                  ) : (
                    "Esgotado"
                  )}
                </button>
              </div>
            </div>
          ))}
        </div>

        {/* Footer actions — strong navigation CTA */}
        <div
          style={{
            display: "flex",
            gap: "10px",
            padding: "14px 20px calc(16px + env(safe-area-inset-bottom, 0px))",
            borderTop: "1px solid var(--aacp-line)",
            background: "var(--aacp-panel-bg, var(--aacp-bg))",
          }}
        >
          <button
            type="button"
            onClick={onClose}
            style={{
              flex: "1 1 0",
              padding: "13px 12px",
              borderRadius: "12px",
              border: "1px solid var(--aacp-line)",
              background: "transparent",
              color: "var(--aacp-fg)",
              fontSize: "13.5px",
              fontWeight: 600,
              fontFamily: "inherit",
              cursor: "pointer",
            }}
          >
            Continuar comprando
          </button>
          <button
            type="button"
            onClick={onViewCart}
            style={{
              flex: "1 1 0",
              padding: "13px 12px",
              borderRadius: "12px",
              border: "none",
              background: "var(--aacp-accent)",
              color: "#fff",
              fontSize: "13.5px",
              fontWeight: 800,
              fontFamily: "inherit",
              cursor: "pointer",
              boxShadow: "0 4px 14px color-mix(in srgb, var(--aacp-accent) 40%, transparent)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "6px",
            }}
          >
            Ver carrinho
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <line x1="5" y1="12" x2="19" y2="12" />
              <polyline points="12 5 19 12 12 19" />
            </svg>
          </button>
        </div>
      </div>
    </>
  );
}
