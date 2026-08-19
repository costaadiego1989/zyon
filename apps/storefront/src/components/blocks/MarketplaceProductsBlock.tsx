"use client";

interface MarketplaceProduct {
  id: string;
  name: string;
  price: number;
  priceFormatted: string;
  image?: string;
  sellerName: string;
  sellerId: string;
  inStock: boolean;
}

interface MarketplaceProductsBlockProps {
  block: {
    type: "marketplace_products";
    data: {
      query: string;
      products: MarketplaceProduct[];
    };
  };
  onQuickReply?: (text: string) => void;
}

function getInitial(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "★";
  return trimmed.charAt(0).toUpperCase();
}

export default function MarketplaceProductsBlock({
  block,
  onQuickReply,
}: MarketplaceProductsBlockProps) {
  const { data } = block;

  if (!data.products.length) return null;

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

      {/* Header with marketplace badge */}
      <div
        style={{
          padding: "14px 18px 10px",
          display: "flex",
          alignItems: "center",
          gap: "8px",
        }}
      >
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "4px",
            padding: "3px 8px",
            borderRadius: "6px",
            background: "color-mix(in srgb, var(--aacp-accent) 12%, transparent)",
            fontSize: "11px",
            fontWeight: 700,
            color: "var(--aacp-accent)",
            letterSpacing: "0.01em",
          }}
        >
          🏪 Lojas parceiras
        </span>
        <p
          style={{
            margin: 0,
            fontSize: "13px",
            fontWeight: 600,
            color: "var(--aacp-muted)",
            lineHeight: 1.4,
          }}
        >
          Produtos encontrados na rede
        </p>
      </div>

      {/* Horizontal scroll cards */}
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
              minWidth: "155px",
              maxWidth: "155px",
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
            onClick={() =>
              onQuickReply?.(`Detalhes ${product.name} de ${product.sellerName}`)
            }
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
                gap: "4px",
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

              {/* Seller badge */}
              <span
                style={{
                  fontSize: "10px",
                  fontWeight: 500,
                  color: "var(--aacp-muted)",
                  lineHeight: 1.2,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                Vendido por: {product.sellerName}
              </span>

              {/* Price */}
              <span
                style={{
                  fontSize: "14px",
                  fontWeight: 800,
                  color: "var(--aacp-accent)",
                  fontFamily: "var(--aacp-font-display)",
                  letterSpacing: "-0.02em",
                  marginTop: "2px",
                }}
              >
                {product.priceFormatted}
              </span>

              {/* Adicionar button */}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onQuickReply?.(
                    `Adicionar ${product.name} de ${product.sellerName} ao carrinho`
                  );
                }}
                disabled={!product.inStock}
                style={{
                  marginTop: "auto",
                  width: "100%",
                  padding: "6px 8px",
                  borderRadius: "6px",
                  border: "none",
                  background: product.inStock
                    ? "var(--aacp-accent)"
                    : "color-mix(in srgb, var(--aacp-muted) 30%, var(--aacp-surface-2))",
                  color: "#fff",
                  fontSize: "11px",
                  fontWeight: 700,
                  fontFamily: "inherit",
                  cursor: product.inStock ? "pointer" : "not-allowed",
                  opacity: product.inStock ? 1 : 0.5,
                  transition: "filter 0.12s ease",
                }}
                onMouseEnter={(e) => {
                  if (product.inStock) {
                    e.currentTarget.style.filter = "brightness(1.08)";
                  }
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.filter = "none";
                }}
              >
                {product.inStock ? "Adicionar" : "Esgotado"}
              </button>
            </div>
          </div>
        ))}
      </div>
    </article>
  );
}
