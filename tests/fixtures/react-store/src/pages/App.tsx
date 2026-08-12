import { useState } from "react";
import { ProductPage } from "./ProductPage";
import { CartPage } from "./CartPage";
import { CheckoutPage } from "./CheckoutPage";
import { useCart } from "../hooks/useCart";

type Page = "products" | "cart" | "checkout";

export function App() {
  const [page, setPage] = useState<Page>("products");
  const cart = useCart();

  return (
    <div style={{ fontFamily: "system-ui, sans-serif", maxWidth: 960, margin: "0 auto", padding: 24 }}>
      <header style={{ display: "flex", gap: 16, marginBottom: 32, borderBottom: "1px solid #eee", paddingBottom: 16 }}>
        <button onClick={() => setPage("products")} style={{ fontWeight: page === "products" ? 700 : 400 }}>
          Produtos
        </button>
        <button onClick={() => setPage("cart")} style={{ fontWeight: page === "cart" ? 700 : 400 }}>
          Carrinho ({cart.items.length})
        </button>
        <button onClick={() => setPage("checkout")} disabled={cart.items.length === 0} style={{ fontWeight: page === "checkout" ? 700 : 400 }}>
          Checkout
        </button>
      </header>

      {page === "products" && <ProductPage onAddToCart={cart.addItem} />}
      {page === "cart" && <CartPage items={cart.items} onRemove={cart.removeItem} onCheckout={() => setPage("checkout")} />}
      {page === "checkout" && <CheckoutPage cart={cart} />}
    </div>
  );
}
