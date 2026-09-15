import { useCheckoutStore } from "@/store/checkout-store";
import type { CartItem } from "@/api/checkout-session";
import { buyerServiceFeeCopy, checkoutLocale, checkoutTotalWithServiceFee } from "@/lib/checkout-totals";

type CartHandlers = {
  controlsDisabled: boolean;
  onQuantityChange: (item: CartItem, quantity: number) => void;
  onRemove: (item: CartItem) => void;
};

function translateShippingLabel(label: string): string {
  const translations: Record<string, string> = {
    own_delivery_flat: "Entrega própria",
    own_delivery: "Entrega própria",
    correios_pac: "PAC",
    correios_sedex: "Sedex",
    jadlog_package: "Jadlog",
    free_shipping: "Frete grátis",
  };
  if (!label.includes("_")) return label;
  return translations[label] ?? label.replace(/_/g, " ").replace(/\b\w/g, (character) => character.toUpperCase());
}

function CartIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M6 6h15l-1.5 9h-12z" />
      <path d="M6 6L5 3H2" />
      <circle cx="9" cy="20" r="1.4" />
      <circle cx="18" cy="20" r="1.4" />
    </svg>
  );
}

function QuantityStepper({ item, controlsDisabled, onQuantityChange, onRemove }: CartHandlers & { item: CartItem }) {
  const reduceQuantity = () => {
    if (item.quantity <= 1) {
      onRemove(item);
      return;
    }
    onQuantityChange(item, item.quantity - 1);
  };

  return (
    <div className="checkout-cart__quantity" aria-label={`Quantidade de ${item.name}`}>
      <button data-neu="control" className="checkout-cart__quantity-button" type="button" disabled={controlsDisabled} aria-label={`Diminuir quantidade de ${item.name}`} onClick={reduceQuantity}>
        −
      </button>
      <span aria-live="polite" className="checkout-cart__quantity-value">{item.quantity}</span>
      <button data-neu="control" className="checkout-cart__quantity-button" type="button" disabled={controlsDisabled || item.quantity >= 99} aria-label={`Aumentar quantidade de ${item.name}`} onClick={() => onQuantityChange(item, item.quantity + 1)}>
        +
      </button>
    </div>
  );
}

function CartProduct({ item, controlsDisabled, onQuantityChange, onRemove, formatPrice }: CartHandlers & { item: CartItem; formatPrice: (value: number) => string }) {
  const unitPrice = item.price_cents != null ? item.price_cents / 100 : item.price;
  const variantLabel = item.variantLabel ?? (item.variant?.trim().startsWith("[") ? undefined : item.variant);
  const imageStyle = item.imageUrl
    ? { background: `url(${item.imageUrl}) center / cover no-repeat` }
    : { background: "repeating-linear-gradient(135deg,var(--tile1),var(--tile1) 6px,var(--tile2) 6px,var(--tile2) 12px)" };

  return (
    <article data-neu="surface" className="checkout-cart__product">
      <div className="checkout-cart__product-image" style={imageStyle} role="img" aria-label={item.name} />
      <div className="checkout-cart__product-copy">
        <strong className="checkout-cart__product-name">{item.name}</strong>
        {variantLabel?.trim() && <span className="checkout-cart__product-variant">{variantLabel}</span>}
        <span className="checkout-cart__product-price">{formatPrice(unitPrice)} por unidade</span>
      </div>
      <div className="checkout-cart__product-actions">
        <button data-neu="text" className="checkout-cart__remove" type="button" disabled={controlsDisabled} aria-label={`Remover ${item.name}`} onClick={() => onRemove(item)}>
          Remover
        </button>
        <QuantityStepper item={item} controlsDisabled={controlsDisabled} onQuantityChange={onQuantityChange} onRemove={onRemove} />
      </div>
    </article>
  );
}

function SummaryLine({ label, value, emphasis = "default" }: { label: string; value: string; emphasis?: "default" | "discount" }) {
  return (
    <div className="checkout-cart__summary-line">
      <span>{label}</span>
      <strong className={emphasis === "discount" ? "checkout-cart__discount" : undefined}>{value}</strong>
    </div>
  );
}

export function SmartCart() {
  const cart = useCheckoutStore((state) => state.cart);
  const cartUpdating = useCheckoutStore((state) => state.cartUpdating);
  const cartError = useCheckoutStore((state) => state.cartError);
  const completed = useCheckoutStore((state) => state.status === "completed");
  const agent = useCheckoutStore((state) => state.agent);
  const showBranding = useCheckoutStore((state) => state.showBranding);
  const updateQty = useCheckoutStore((state) => state.updateQty);
  const removeCartItem = useCheckoutStore((state) => state.removeCartItem);
  const sendMessage = useCheckoutStore((state) => state.sendMessage);

  const controlsDisabled = cartUpdating || completed;
  const agentName = showBranding ? (agent.name || "Assistente") : "Assistente da loja";
  const locale = checkoutLocale(agent.language);
  const serviceFeeCopy = buyerServiceFeeCopy(agent.language);
  const itemCount = cart.items.reduce((total, item) => total + item.quantity, 0);
  const finalTotal = cart.totalToPay ?? checkoutTotalWithServiceFee({
    subtotal: cart.total,
    shipping: cart.shipping?.cost,
    discount: cart.discount,
    serviceFee: cart.serviceFee,
  });
  const displayedTotal = cart.shipping
    ? checkoutTotalWithServiceFee({
        subtotal: cart.total,
        shipping: cart.shipping.cost,
        discount: cart.discount,
        serviceFee: cart.serviceFee,
      })
    : finalTotal;
  const statusLabels: Record<string, string> = {
    awaiting: "Em andamento",
    shipping_calculated: "Frete definido",
    ready_to_pay: "Pronto para pagar",
    paid: "Pago",
  };
  const formatPrice = (value: number) => new Intl.NumberFormat(locale, { style: "currency", currency: "BRL" }).format(value);
  const handlers: CartHandlers = {
    controlsDisabled,
    onQuantityChange: (item, quantity) => void updateQty(item.sku, quantity, item.variant),
    onRemove: (item) => void removeCartItem(item.sku, item.variant),
  };

  return (
    <section className="checkout-cart" aria-label="Carrinho do checkout" aria-busy={cartUpdating}>
      <header className="checkout-cart__header">
        <span className="checkout-cart__icon" aria-hidden="true">
          <CartIcon />
          {itemCount > 0 && <span className="checkout-cart__badge">{itemCount}</span>}
        </span>
        <div className="checkout-cart__heading">
          <div className="checkout-cart__heading-row">
            <h2>Seu pedido</h2>
            <span className="checkout-cart__status">{statusLabels[cart.status] ?? "Atualizando"}</span>
          </div>
          <p>{itemCount === 1 ? "1 item" : `${itemCount} itens`} · atualizado por {agentName}</p>
        </div>
      </header>

      {cartUpdating && <p className="checkout-cart__notice" role="status">Atualizando carrinho…</p>}
      {cartError && <p className="checkout-cart__error" role="alert">{cartError}</p>}

      <div className="checkout-cart__items">
        {cart.items.length === 0 ? (
          <div className="checkout-cart__empty">
            <strong>Carrinho vazio</strong>
            <p>Escolha um produto para continuar.</p>
            <form onSubmit={(event) => {
              event.preventDefault();
              const input = event.currentTarget.elements[0] as HTMLInputElement;
              const query = input.value.trim();
              if (!query) return;
              void sendMessage(`buscar ${query}`);
              input.value = "";
            }}>
              <input data-neu="field" type="text" placeholder="Buscar produto" aria-label="Buscar produto" />
            </form>
          </div>
        ) : (
          cart.items.map((item) => <CartProduct key={JSON.stringify([item.sku, item.variant])} item={item} {...handlers} formatPrice={formatPrice} />)
        )}
      </div>

      {cart.items.length > 0 && (
        <footer className="checkout-cart__summary">
          <SummaryLine label="Produtos" value={formatPrice(cart.total)} />
          {cart.shipping && (
            <div data-testid="checkout-shipping-summary" className="checkout-cart__shipping">
              <SummaryLine label="Entrega" value={cart.shipping.cost === 0 ? "Grátis" : formatPrice(cart.shipping.cost)} />
              <p>{translateShippingLabel(cart.shipping.label)}</p>
            </div>
          )}
          {cart.discount > 0 && <SummaryLine label="Desconto" value={`−${formatPrice(cart.discount)}`} emphasis="discount" />}
          {cart.serviceFee > 0 && (
            <div data-testid="buyer-service-fee" className="checkout-cart__service-fee">
              <SummaryLine label={serviceFeeCopy.label} value={formatPrice(cart.serviceFee)} />
              <p>{serviceFeeCopy.notice}</p>
            </div>
          )}
          <div data-neu="surface" className="checkout-cart__total">
            <span>Total a pagar</span>
            <strong>{formatPrice(displayedTotal)}</strong>
          </div>
        </footer>
      )}

      <style>{`
        .checkout-cart { height: 100%; min-width: 0; display: flex; flex-direction: column; gap: 12px; padding-top: 6px; box-sizing: border-box; }
        .checkout-cart__header { display: flex; align-items: flex-start; gap: 10px; padding: 2px 2px 14px; border-bottom: 1px solid var(--bd); }
        .checkout-cart__icon { position: relative; width: 38px; height: 38px; flex: none; display: grid; place-items: center; border: 1px solid var(--bd); border-radius: 13px; background: var(--chip); color: var(--aacp-accent-text, var(--aacp-accent, #0f766e)); }
        .checkout-cart__badge { position: absolute; top: -3px; right: -3px; box-sizing: border-box; min-width: 20px; height: 20px; padding: 0 4px; display: grid; place-items: center; border-radius: 999px; background: var(--aacp-accent, #0f766e); color: var(--aacp-on-accent, #f6f7f5); font-size: 10px; font-weight: 800; line-height: 1; box-shadow: 0 2px 8px color-mix(in srgb, var(--aacp-accent, #0f766e) 30%, transparent); }
        .checkout-cart__heading { min-width: 0; flex: 1; }
        .checkout-cart__heading-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
        .checkout-cart__heading h2 { margin: 0; color: var(--tx); font-size: 14px; line-height: 1.3; letter-spacing: -.15px; }
        .checkout-cart__heading p { margin: 3px 0 0; color: var(--mut); font-size: 11px; line-height: 1.35; }
        .checkout-cart__status { flex: none; padding: 3px 7px; border: 1px solid var(--sheetbd, var(--bd)); border-radius: 999px; color: var(--g2, var(--aacp-accent, #0f766e)); font-family: 'Space Mono', monospace; font-size: 8px; white-space: nowrap; }
        .checkout-cart__notice, .checkout-cart__error { margin: 0; padding: 9px 10px; border: 1px solid var(--bd); border-radius: 12px; color: var(--mut); background: var(--chip); font-size: 12px; line-height: 1.4; }
        .checkout-cart__error { color: var(--tx); }
        .checkout-cart__items { min-height: 0; flex: 1; overflow-y: auto; padding: 0 2px; scrollbar-width: thin; scrollbar-color: var(--bd) transparent; }
        .checkout-cart__product { display: grid; grid-template-columns: 52px minmax(0, 1fr); column-gap: 12px; row-gap: 10px; align-items: start; padding: 13px; border: 1px solid var(--bd); border-radius: 16px; background: var(--card); }
        .checkout-cart__product + .checkout-cart__product { margin-top: 10px; }
        .checkout-cart__product-image { grid-row: span 2; width: 52px; height: 52px; overflow: hidden; border: 1px solid var(--bd); border-radius: 13px; background: var(--chip); }
        .checkout-cart__product-copy { min-width: 0; }
        .checkout-cart__product-name { display: -webkit-box; overflow: hidden; color: var(--tx); font-size: 13.5px; font-weight: 700; line-height: 1.28; -webkit-box-orient: vertical; -webkit-line-clamp: 2; }
        .checkout-cart__product-price { display: block; margin-top: 3px; color: var(--mut); font-size: 10.5px; line-height: 1.35; }
        .checkout-cart__product-variant { display: block; margin-top: 4px; color: var(--mut); font-size: 12px; line-height: 1.4; overflow-wrap: anywhere; }
        .checkout-cart__product-actions { grid-column: 2; display: flex; align-items: center; justify-content: space-between; gap: 12px; min-width: 0; }
        .checkout-cart__remove { padding: 4px 0; border: 0; background: transparent; color: var(--aacp-accent-text, var(--aacp-accent, #0f766e)); font: inherit; font-size: 11px; font-weight: 700; text-decoration: underline; cursor: pointer; }
        .checkout-cart__remove:disabled { cursor: not-allowed; opacity: .45; }
        .checkout-cart__quantity { display: flex; flex: none; align-items: center; gap: 9px; }
        .checkout-cart__quantity-button { width: 36px; height: 36px; display: grid; place-items: center; padding: 0; border: 1px solid var(--bd); border-radius: 11px; background: var(--chip); color: var(--tx); font: inherit; font-size: 15px; cursor: pointer; touch-action: manipulation; }
        .checkout-cart__quantity-button:disabled { cursor: not-allowed; opacity: .45; }
        .checkout-cart__quantity-value { min-width: 14px; color: var(--tx); font-size: 13px; font-weight: 700; text-align: center; }
        .checkout-cart__empty { padding: 26px 10px; color: var(--mut); text-align: center; }
        .checkout-cart__empty strong { display: block; color: var(--tx); font-size: 13px; }
        .checkout-cart__empty p { margin: 5px 0 14px; font-size: 11.5px; }
        .checkout-cart__empty input { box-sizing: border-box; width: 100%; padding: 11px 13px; border: 1px solid var(--bd); border-radius: 12px; outline: none; background: var(--chip); color: var(--tx); font: inherit; font-size: 13px; }
        .checkout-cart__summary { flex: none; padding: 11px 2px 2px; border-top: 1px solid var(--bd); }
        .checkout-cart__summary-line { display: flex; align-items: flex-start; justify-content: space-between; gap: 14px; padding: 6px 0; color: var(--mut); font-size: 12px; line-height: 1.35; }
        .checkout-cart__summary-line span { min-width: 0; }
        .checkout-cart__summary-line strong { flex: none; color: var(--tx); font-size: 12px; }
        .checkout-cart__discount { color: var(--aacp-accent-text, var(--aacp-accent, #0f766e)) !important; }
        .checkout-cart__service-fee { padding: 3px 0 6px; }
        .checkout-cart__service-fee p { margin: 1px 0 0; color: var(--mut); font-size: 10.5px; line-height: 1.35; }
        .checkout-cart__shipping { padding: 2px 0 5px; }
        .checkout-cart__shipping p { margin: -1px 0 0; color: var(--mut); font-size: 10.5px; line-height: 1.35; overflow-wrap: anywhere; }
        .checkout-cart__total { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-top: 7px; padding: 12px; border: 1px solid color-mix(in srgb, var(--aacp-accent, #0f766e) 35%, var(--bd)); border-radius: 15px; background: color-mix(in srgb, var(--aacp-accent, #0f766e) 7%, var(--card)); }
        .checkout-cart__total span { color: var(--tx); font-size: 13px; font-weight: 700; }
        .checkout-cart__total strong { color: var(--tx); font-size: 18px; letter-spacing: -.4px; white-space: nowrap; }
        @media (max-width: 639px) { .checkout-cart { gap: 14px; } .checkout-cart__header { padding-bottom: 12px; } .checkout-cart__product { grid-template-columns: 56px minmax(0, 1fr); padding: 14px; } .checkout-cart__product-image { width: 56px; height: 56px; } .checkout-cart__quantity-button { width: 40px; height: 40px; } .checkout-cart__summary { padding-bottom: 2px; } }
      `}</style>
    </section>
  );
}
