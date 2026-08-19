"use client";

import MarketplaceProductCard from "./MarketplaceProductCard";

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

export default function MarketplaceProductsBlock({
  block,
  onQuickReply,
}: MarketplaceProductsBlockProps) {
  const { data } = block;

  if (!data.products.length) return null;

  return (
    <section
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "16px",
        width: "100%",
        fontFamily: "var(--aacp-font)",
      }}
    >
      {/* Section header */}
      <div
        style={{
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
          🏪 Marketplace
        </span>
        <h2
          style={{
            margin: 0,
            fontSize: "16px",
            fontWeight: 700,
            color: "var(--aacp-fg)",
            fontFamily: "var(--aacp-font-display)",
            lineHeight: 1.4,
          }}
        >
          Produtos de lojas parceiras
        </h2>
      </div>

      {/* Grid of product cards */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))",
          gap: "16px",
          width: "100%",
        }}
      >
        {data.products.map((product) => (
          <MarketplaceProductCard
            key={product.id}
            id={product.id}
            name={product.name}
            price={product.price}
            priceFormatted={product.priceFormatted}
            sellerName={product.sellerName}
            sellerId={product.sellerId}
            image={product.image}
            inStock={product.inStock}
            onAddToCart={(p) =>
              onQuickReply?.(
                `Adicionar ${p.name} de ${p.sellerName} ao carrinho`,
              )
            }
          />
        ))}
      </div>
    </section>
  );
}
