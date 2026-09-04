type Product = {
  id: string;
  name: string;
  price: number;
  image?: string;
};

function formatPrice(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(value);
}

export default function ProductCard({ product }: { product: Product }) {
  return (
    <article
      style={{
        display: "flex",
        flexDirection: "column",
        background: "var(--color-bg)",
        border: "1px solid var(--color-border)",
        borderRadius: "var(--radius-md)",
        overflow: "hidden",
        boxShadow: "var(--shadow-sm)",
      }}
    >
      <div
        aria-hidden
        style={{
          width: "100%",
          aspectRatio: "4 / 3",
          background:
            product.image
              ? `url(${product.image}) center/cover`
              : "linear-gradient(135deg, var(--color-bg-soft), var(--color-border))",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "var(--color-muted)",
          fontSize: 36,
        }}
      >
        {!product.image && "🛒"}
      </div>
      <div
        style={{
          padding: 16,
          display: "flex",
          flexDirection: "column",
          gap: 8,
        }}
      >
        <h3
          style={{
            fontSize: 16,
            fontWeight: 600,
            margin: 0,
            color: "var(--color-fg)",
          }}
        >
          {product.name}
        </h3>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginTop: 4,
          }}
        >
          <span
            style={{
              fontSize: 15,
              fontWeight: 600,
              color: "var(--color-fg)",
            }}
          >
            {formatPrice(product.price)}
          </span>
          <button
            type="button"
            disabled
            style={{
              padding: "8px 14px",
              borderRadius: "var(--radius-sm)",
              border: "none",
              background: "var(--color-primary)",
              color: "#fff",
              fontSize: 13,
              fontWeight: 600,
              opacity: 0.6,
              cursor: "not-allowed",
            }}
          >
            Adicionar
          </button>
        </div>
      </div>
    </article>
  );
}