"use client";

interface CrossSellProduct {
  id: string;
  name: string;
  price: number;
  priceFormatted: string;
  image?: string;
  inStock: boolean;
  discountPercent?: number;
}

interface CrossSellBlockProps {
  block: {
    type: "cross_sell";
    data: {
      trigger: string;
      products: CrossSellProduct[];
    };
  };
  onQuickReply?: (text: string) => void;
}

function getInitial(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "★";
  return trimmed.charAt(0).toUpperCase();
}

export default function CrossSellBlock({
  block,
  onQuickReply,
}: CrossSellBlockProps) {
  const { data } = block;

  return (
    <article
      style={{
        background: "var(--aacp-surface)",
        border: "1px solid var(--aacp-line)",
        borderRadius: "14px",
        overflow: "hidden",
        boxShadow: "0 1px 2px rgba(0,0,0,0.04), 0 12px 32px rgba(0,0,0,0.10)",
        display: "flex",
        flexDirection: "column",
        width: "100%",
        fontFamily: "var(--aacp-font)",
        color: "var(--aacp-fg)",
        animation: "fadeSlideIn 0.45s cubic-bezier(0.22, 1, 0.36, 1) both",
      }}
    >
      <style>{`
        @keyframes fadeSlideIn {
          from { opacity: 0; transform: translateY(12px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>

      {}
      <div
        style={{
          padding: "14px 18px 12px",
          display: "flex",
          alignItems: "center",
          gap: "9px",
          background:
            "linear-gradient(180deg, color-mix(in srgb, var(--aacp-accent) 10%, transparent) 0%, transparent 100%)",
        }}
      >
        <span
          aria-hidden
          style={{
            flexShrink: 0,
            width: "28px",
            height: "28px",
            borderRadius: "8px",
            background: "var(--aacp-accent)",
            color: "#fff",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="9" cy="21" r="1" />
            <circle cx="20" cy="21" r="1" />
            <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" />
          </svg>
        </span>
        <p
          style={{
            margin: 0,
            fontSize: "13.5px",
            fontWeight: 700,
            color: "var(--aacp-fg)",
            lineHeight: 1.35,
          }}
        >
          {data.trigger}
        </p>
      </div>

      {}
      <div
        style={{
          padding: "0 18px 16px",
          overflowX: "auto",
          overflowY: "hidden",
          display: "flex",
          gap: "10px",
          scrollSnapType: "x mandatory",
          WebkitOverflowScrolling: "touch",
          scrollbarWidth: "none",
        }}
      >
        {data.products.map((product) => (
          <div
            key={product.id}
            style={{
              minWidth: "140px",
              maxWidth: "140px",
              flexShrink: 0,
              scrollSnapAlign: "start",
              background: "var(--aacp-surface-2)",
              border: "1px solid var(--aacp-line)",
              borderRadius: "10px",
              overflow: "hidden",
              display: "flex",
              flexDirection: "column",
              cursor: "pointer",
              transition: "transform 0.15s ease, box-shadow 0.15s ease",
            }}
            onClick={() => onQuickReply?.(`Detalhes ${product.name}`)}
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = "translateY(-2px)";
              e.currentTarget.style.boxShadow =
                "0 6px 16px rgba(0,0,0,0.12)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = "none";
              e.currentTarget.style.boxShadow = "none";
            }}
          >
            {/* Image / monogram */}
            <div
              style={{
                position: "relative",
                width: "100%",
                height: "80px",
                background:
                  "linear-gradient(135deg, var(--aacp-surface-2) 0%, var(--aacp-surface-3, var(--aacp-surface-2)) 100%)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                overflow: "hidden",
              }}
            >
              {product.discountPercent && product.discountPercent > 0 ? (
                <span
                  style={{
                    position: "absolute",
                    top: "6px",
                    left: "6px",
                    padding: "2px 7px",
                    borderRadius: "6px",
                    background: "#e11d48",
                    color: "#fff",
                    fontSize: "10px",
                    fontWeight: 800,
                    letterSpacing: "0.02em",
                    boxShadow: "0 2px 6px rgba(225,29,72,0.4)",
                  }}
                >
                  -{Math.round(product.discountPercent)}%
                </span>
              ) : null}
              {product.image ? (
                <img
                  src={product.image}
                  alt={product.name}
                  style={{
                    maxWidth: "100%",
                    maxHeight: "100%",
                    objectFit: "contain",
                  }}
                  loading="lazy"
                />
              ) : (
                <span
                  style={{
                    fontSize: "28px",
                    fontWeight: 800,
                    color:
                      "color-mix(in srgb, var(--aacp-accent) 30%, transparent)",
                    fontFamily: "var(--aacp-font-display)",
                    userSelect: "none",
                  }}
                >
                  {getInitial(product.name)}
                </span>
              )}
            </div>

            {/* Content */}
            <div
              style={{
                padding: "10px 10px 12px",
                display: "flex",
                flexDirection: "column",
                gap: "6px",
                flex: 1,
              }}
            >
              {/* Name */}
              <span
                style={{
                  fontSize: "12px",
                  fontWeight: 600,
                  color: "var(--aacp-fg)",
                  lineHeight: 1.3,
                  display: "-webkit-box",
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: "vertical",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {product.name}
              </span>

              {/* Price */}
              <span
                style={{
                  fontSize: "14px",
                  fontWeight: 800,
                  color: "var(--aacp-accent)",
                  fontFamily: "var(--aacp-font-display)",
                  letterSpacing: "-0.02em",
                }}
              >
                {product.priceFormatted}
              </span>

              {/* Adicionar button */}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onQuickReply?.(`Adicionar ${product.name} ao carrinho`);
                }}
                disabled={!product.inStock}
                style={{
                  marginTop: "auto",
                  width: "100%",
                  padding: "9px 8px",
                  borderRadius: "8px",
                  border: "none",
                  background: product.inStock
                    ? "var(--aacp-accent)"
                    : "color-mix(in srgb, var(--aacp-muted) 30%, var(--aacp-surface-2))",
                  color: "#fff",
                  fontSize: "12px",
                  fontWeight: 800,
                  fontFamily: "inherit",
                  cursor: product.inStock ? "pointer" : "not-allowed",
                  opacity: product.inStock ? 1 : 0.5,
                  transition: "filter 0.12s ease, transform 0.12s ease",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "5px",
                  boxShadow: product.inStock ? "0 3px 10px color-mix(in srgb, var(--aacp-accent) 40%, transparent)" : "none",
                }}
                onMouseEnter={(e) => {
                  if (product.inStock) {
                    e.currentTarget.style.filter = "brightness(1.08)";
                    e.currentTarget.style.transform = "translateY(-1px)";
                  }
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.filter = "none";
                  e.currentTarget.style.transform = "none";
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
    </article>
  );
}
