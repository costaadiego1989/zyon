"use client";

interface MarketplaceProductCardProps {
  id: string;
  name: string;
  price: number;
  priceFormatted: string;
  sellerName: string;
  sellerId: string;
  image?: string;
  inStock: boolean;
  onAddToCart: (product: MarketplaceProductCardProps) => void;
}

function getInitial(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "★";
  return trimmed.charAt(0).toUpperCase();
}

export default function MarketplaceProductCard({
  id,
  name,
  price,
  priceFormatted,
  sellerName,
  sellerId,
  image,
  inStock,
  onAddToCart,
}: MarketplaceProductCardProps) {
  const props = {
    id,
    name,
    price,
    priceFormatted,
    sellerName,
    sellerId,
    image,
    inStock,
    onAddToCart,
  };

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
        maxWidth: "100%",
        fontFamily: "var(--aacp-font)",
        color: "var(--aacp-fg)",
        animation: "fadeSlideIn 0.45s cubic-bezier(0.22, 1, 0.36, 1) both",
        boxSizing: "border-box",
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
        aria-hidden
        style={{
          position: "relative",
          width: "100%",
          height: "200px",
          background: image
            ? "linear-gradient(180deg, var(--aacp-surface-2) 0%, var(--aacp-surface-3) 100%)"
            : "linear-gradient(135deg, var(--aacp-surface-2) 0%, var(--aacp-surface-3) 100%)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          overflow: "hidden",
          flexShrink: 0,
        }}
      >
        {image ? (
          <img
            src={image}
            alt={name}
            style={{
              maxWidth: "100%",
              maxHeight: "100%",
              width: "auto",
              height: "auto",
              objectFit: "contain",
              display: "block",
            }}
            loading="lazy"
          />
        ) : (
          <span
            style={{
              fontFamily: "var(--aacp-font-display)",
              fontSize: "72px",
              fontWeight: 800,
              lineHeight: 1,
              color: "color-mix(in srgb, var(--aacp-accent) 30%, transparent)",
              letterSpacing: "-0.04em",
              userSelect: "none",
            }}
          >
            {getInitial(name)}
          </span>
        )}
      </div>

      {}
      <div
        style={{
          padding: "16px 18px 16px",
          display: "flex",
          flexDirection: "column",
          gap: "12px",
        }}
      >
        {}
        <h3
          style={{
            fontFamily: "var(--aacp-font-display)",
            fontSize: "18px",
            fontWeight: 700,
            margin: 0,
            color: "var(--aacp-fg)",
            lineHeight: 1.3,
            letterSpacing: "-0.01em",
          }}
        >
          {name}
        </h3>

        {}
        <p
          style={{
            fontSize: "12px",
            color: "var(--aacp-muted)",
            margin: 0,
            fontWeight: 500,
          }}
        >
          Vendido por {sellerName}
        </p>

        {}
        <div
          style={{
            display: "flex",
            alignItems: "flex-end",
            justifyContent: "space-between",
            gap: "12px",
            marginTop: "6px",
            paddingTop: "12px",
            borderTop: "1px solid var(--aacp-line)",
          }}
        >
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "3px",
              minWidth: 0,
            }}
          >
            <span
              style={{
                fontSize: "24px",
                fontWeight: 800,
                color: "var(--aacp-accent)",
                fontFamily: "var(--aacp-font-display)",
                letterSpacing: "-0.02em",
                lineHeight: 1.1,
              }}
            >
              {priceFormatted}
            </span>
          </div>

          {}
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "6px",
              fontSize: "11.5px",
              fontWeight: 600,
              color: inStock ? "var(--aacp-success)" : "#ef4444",
              paddingBottom: "4px",
              whiteSpace: "nowrap",
            }}
            aria-live="polite"
          >
            <span
              style={{
                width: "8px",
                height: "8px",
                borderRadius: "50%",
                background: inStock ? "var(--aacp-success)" : "#ef4444",
                boxShadow: inStock
                  ? "0 0 0 3px color-mix(in srgb, var(--aacp-success) 22%, transparent)"
                  : "0 0 0 3px color-mix(in srgb, #ef4444 22%, transparent)",
              }}
              aria-hidden
            />
            {inStock ? "Em estoque" : "Esgotado"}
          </div>
        </div>

        {}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "8px",
            marginTop: "6px",
          }}
        >
          <button
            type="button"
            onClick={() => onAddToCart(props)}
            disabled={!inStock}
            style={{
              width: "100%",
              height: "44px",
              padding: "0 16px",
              borderRadius: "10px",
              border: "none",
              background: inStock
                ? "var(--aacp-accent)"
                : "color-mix(in srgb, var(--aacp-muted) 30%, var(--aacp-surface-2))",
              color: "#fff",
              fontSize: "14px",
              fontWeight: 700,
              fontFamily: "inherit",
              letterSpacing: "0.01em",
              cursor: inStock ? "pointer" : "not-allowed",
              opacity: inStock ? 1 : 0.6,
              transition:
                "transform 0.15s ease, box-shadow 0.15s ease, filter 0.15s ease",
              boxShadow: inStock
                ? "0 4px 14px color-mix(in srgb, var(--aacp-accent) 30%, transparent)"
                : "none",
            }}
            onMouseEnter={(e) => {
              if (inStock) {
                e.currentTarget.style.transform = "translateY(-1px)";
                e.currentTarget.style.boxShadow =
                  "0 8px 22px color-mix(in srgb, var(--aacp-accent) 42%, transparent)";
                e.currentTarget.style.filter = "brightness(1.05)";
              }
            }}
            onMouseLeave={(e) => {
              if (inStock) {
                e.currentTarget.style.transform = "none";
                e.currentTarget.style.boxShadow =
                  "0 4px 14px color-mix(in srgb, var(--aacp-accent) 30%, transparent)";
                e.currentTarget.style.filter = "none";
              }
            }}
          >
            {inStock ? "Adicionar ao carrinho" : "Produto indisponível"}
          </button>
        </div>
      </div>
    </article>
  );
}
