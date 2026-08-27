import { useCheckoutStore } from "@/store/checkout-store";
import { PulseAgentOrb } from "./PulseAgentOrb";

function translateShippingLabel(label: string): string {
  const translations: Record<string, string> = {
    own_delivery_flat: "Entrega própria",
    own_delivery: "Entrega própria",
    correios_pac: "PAC",
    correios_sedex: "Sedex",
    jadlog_package: "Jadlog",
    free_shipping: "Frete grátis",
  };
  if (label.includes("_")) {
    return translations[label] ?? label.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  }
  return label;
}

export function OrderConfirmation() {
  const cart = useCheckoutStore((s) => s.cart);
  const brand = useCheckoutStore((s) => s.brand);

  const storeName = brand.name || "Loja";

  const formatPrice = (value: number) =>
    new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);

  const handleBackToStore = () => {
    // Navigate to merchant storefront; fallback to closing tab
    const storeUrl =
      (window as unknown as Record<string, string>).__AACP_STORE_URL__ || document.referrer || "/";
    window.location.href = storeUrl;
  };

  return (
    <div className="order-confirmation">
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "12px", padding: "16px 0" }}>
        <div style={{ animation: "bounce 0.6s ease infinite alternate" }}>
          <PulseAgentOrb placement="orderComplete" active />
        </div>
        <p style={{ fontSize: "14px", fontWeight: 600, color: "var(--tx)", margin: 0, textAlign: "center" }}>
          Pagamento confirmado! 🎉
        </p>
      </div>
      <div className="order-confirmation__icon" aria-hidden="true">✓</div>
      <h2 className="order-confirmation__title">Pedido confirmado!</h2>
      <p className="order-confirmation__subtitle">
        Obrigado por comprar na {storeName}. Você receberá os detalhes por e-mail.
      </p>

      <div className="order-confirmation__details">
        {cart.items.map((item) => (
          <div key={item.sku} className="order-confirmation__item">
            <span>{item.name} × {item.quantity}</span>
            <span>{formatPrice(item.price * item.quantity)}</span>
          </div>
        ))}
        {cart.shipping && (
          <div className="order-confirmation__line">
            <span>Frete · {translateShippingLabel(cart.shipping.label)}</span>
            <span>{cart.shipping.cost === 0 ? "Grátis" : formatPrice(cart.shipping.cost / 100)}</span>
          </div>
        )}
        <div className="order-confirmation__total">
          <span>Total pago</span>
          <span>{formatPrice(cart.total + (cart.shipping?.cost ?? 0) / 100 - cart.discount)}</span>
        </div>
      </div>

      <button className="order-confirmation__back-btn" onClick={handleBackToStore}>
        Voltar para a loja
      </button>
      <style>{`@keyframes bounce { from { transform: translateY(0); } to { transform: translateY(-8px); } }`}</style>
    </div>
  );
}
