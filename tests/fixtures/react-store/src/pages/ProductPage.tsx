interface Product {
  sku: string;
  name: string;
  price: number;
  image: string;
}

const PRODUCTS: Product[] = [
  { sku: "SHIRT-001", name: "Camiseta Premium", price: 149.9, image: "https://placehold.co/200x200/eee/333?text=Camiseta" },
  { sku: "PANTS-001", name: "Calça Jeans Slim", price: 299.9, image: "https://placehold.co/200x200/eee/333?text=Calca" },
  { sku: "SHOE-001", name: "Tênis Casual", price: 399.9, image: "https://placehold.co/200x200/eee/333?text=Tenis" },
  { sku: "BAG-001", name: "Mochila Executiva", price: 199.9, image: "https://placehold.co/200x200/eee/333?text=Mochila" },
];

export function ProductPage({ onAddToCart }: { onAddToCart: (product: Product) => void }) {
  return (
    <div>
      <h2>Produtos</h2>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 24 }}>
        {PRODUCTS.map((p) => (
          <div key={p.sku} style={{ border: "1px solid #ddd", borderRadius: 8, padding: 16, textAlign: "center" }}>
            <img src={p.image} alt={p.name} style={{ width: "100%", borderRadius: 4 }} />
            <h3 style={{ fontSize: 16, margin: "8px 0 4px" }}>{p.name}</h3>
            <p style={{ fontWeight: 700, color: "#16a34a" }}>R$ {p.price.toFixed(2)}</p>
            <button
              onClick={() => onAddToCart(p)}
              style={{ background: "#2563eb", color: "#fff", border: "none", borderRadius: 6, padding: "8px 16px", cursor: "pointer" }}
              data-testid={`add-${p.sku}`}
            >
              Adicionar
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
