"use client";

import type { CrossSellInterstitialData } from "@/lib/viewmodels/useConversationViewModel";

interface CrossSellInterstitialProps {
  data: CrossSellInterstitialData | null;
  onClose: () => void;
  onViewCart: () => void;
  onAddItem: (productId: string, productName: string) => void;
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
      {}
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

      {}
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
          maxHeight: "82vh",
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

        {}
        <div style={{ display: "flex", justifyContent: "center", paddingTop: "10px" }}>
          <div style={{ width: "36px", height: "4px", borderRadius: "2px", background: "var(--aacp-line)" }} />
        </div>

        {}
        <div
          style={{
            padding: "14px 20px 12px",
            display: "flex",
            alignItems: "center",
            gap: "11px",
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

        {}
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
                minWidth: "180px",
                maxWidth: "180px",
                flexShrink: 0,
                scrollSnapAlign: "start",
                background: "var(--aacp-surface-2, rgba(255,255,255,0.04))",
                border: "1px solid var(--aacp-line)",
                borderRadius: "14px",
                overflow: "hidden",
                display: "flex",
                flexDirection: "column",
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
              {}
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
                  <img src={product.image} alt={product.name} loading="lazy" style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }} />
                ) : (
                  <div style={{ fontSize: "48px", fontWeight: 800, color: "var(--aacp-accent)", opacity: 0.25, fontFamily: "var(--aacp-font-display, var(--aacp-font))", letterSpacing: "-2px" }}>
                    {product.name.charAt(0).toUpperCase()}
                  </div>
                )}
                {}
                <div style={{
                  position: "absolute",
                  top: "8px",
                  left: "8px",
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
                {}
                {product.discountPercent && product.discountPercent > 0 ? (
                  <div style={{ position: "absolute", top: "32px", left: "8px", padding: "3px 8px", borderRadius: "6px", background: "var(--aacp-accent)", color: "#fff", fontSize: "10px", fontWeight: 700, letterSpacing: "0.02em" }}>
                    -{Math.round(product.discountPercent)}%
                  </div>
                ) : null}
              </div>

              {}
              <div style={{ padding: "16px 16px 18px", display: "flex", flexDirection: "column", gap: "4px", flex: 1, textAlign: "center" }}>
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

                {}
                <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "4px", marginTop: "6px" }}>
                  <span style={{ display: "inline-flex", gap: "1px", fontSize: "12px", lineHeight: 1, color: "#F5B301" }} aria-label="Sem avaliações">
                    {Array.from({ length: 5 }).map((_, i) => (
                      <span key={i} style={{ color: "rgba(245, 179, 1, 0.22)" }}>★</span>
                    ))}
                  </span>
                  <span style={{ fontSize: "10px", color: "var(--aacp-muted)", fontStyle: "italic" }}>Sem avaliações</span>
                </div>

                <div style={{ flex: 1, minHeight: "10px" }} />

                {}
                <div style={{ marginTop: "8px", display: "flex", flexDirection: "column", alignItems: "center", gap: "2px" }}>
                  <span style={{ fontSize: "20px", fontWeight: 800, color: "var(--aacp-accent)", letterSpacing: "-0.02em" }}>
                    {product.priceFormatted}
                  </span>
                </div>

                {}
                <button
                  type="button"
                  onClick={() => onAddItem(product.id, product.name)}
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
                  {product.inStock ? "Adicionar ao carrinho" : "Indisponível"}
                </button>
              </div>
            </div>
          ))}
        </div>

        {}
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
