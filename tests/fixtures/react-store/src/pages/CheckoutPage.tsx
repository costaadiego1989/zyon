import { useEffect, useRef, useState } from "react";
import type { CartState } from "../hooks/useCart";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://127.0.0.1:3009";
const MERCHANT_ID = import.meta.env.VITE_MERCHANT_ID ?? "";
const EMBED_TOKEN = import.meta.env.VITE_EMBED_SESSION_TOKEN ?? "";

export function CheckoutPage({ cart }: { cart: CartState }) {
  const widgetRef = useRef<HTMLDivElement>(null);
  const [token, setToken] = useState(EMBED_TOKEN);
  const [merchant, setMerchant] = useState(MERCHANT_ID);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (token && merchant) return;
    fetch(`${API_BASE_URL}/__test__/seed`, { method: "POST" })
      .then((r) => r.json())
      .then((seed) => { setToken(seed.embedToken); setMerchant(seed.merchantId); })
      .catch((e) => setError(`API indisponível: ${e.message}. Rode com VITE_EMBED_SESSION_TOKEN ou E2E_SEED_ENABLED=true.`));
  }, [token, merchant]);

  useEffect(() => {
    if (!widgetRef.current || !token || !merchant) return;
    widgetRef.current.innerHTML = "";
    const el = document.createElement("zyon-checkout-agent");
    el.setAttribute("merchant-id", merchant);
    el.setAttribute("embed-session-token", token);
    el.setAttribute("api-base-url", API_BASE_URL);
    el.setAttribute("ui-presentation", "inline");
    el.setAttribute("cart-json", JSON.stringify({
      currency: "BRL",
      source: "storefront",
      total: cart.items.reduce((s, i) => s + i.price * i.quantity, 0),
      items: cart.items.map((i) => ({
        sku: i.sku,
        name: i.name,
        price: i.price,
        quantity: i.quantity,
        category: "geral",
        variant: "default",
      })),
    }));
    widgetRef.current.appendChild(el);
    return () => { el.remove(); };
  }, [cart.items, token, merchant]);

  if (error) return <div><h2>Checkout</h2><p style={{ color: "red" }}>{error}</p></div>;

  return (
    <div>
      <h2>Checkout</h2>
      {!token ? <p>Conectando...</p> : (
        <>
          <p style={{ color: "#666", marginBottom: 16 }}>
            Merchant: {merchant?.slice(0, 20)}… | {cart.items.length} item(s)
          </p>
          <div ref={widgetRef} data-testid="zyon-widget-container" style={{ minHeight: 600, borderRadius: 8 }} />
        </>
      )}
    </div>
  );
}
