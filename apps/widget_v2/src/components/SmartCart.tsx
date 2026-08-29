import { useCheckoutStore } from "@/store/checkout-store";

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

export function SmartCart() {
  const cart = useCheckoutStore((s) => s.cart);
  const agent = useCheckoutStore((s) => s.agent);
  const updateQty = useCheckoutStore((s) => s.updateQty);
  const removeCartItem = useCheckoutStore((s) => s.removeCartItem);
  const sendMessage = useCheckoutStore((s) => s.sendMessage);

  const agentName = agent.name || "Assistente";

  const statusLabels: Record<string, string> = {
    awaiting: "Aguardando",
    shipping_calculated: "Frete calculado",
    ready_to_pay: "Pronto p/ pagar",
    paid: "Pago ✓",
  };

  const formatPrice = (value: number) =>
    new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: "BRL",
    }).format(value);

  const cartCount = cart.items.reduce((s, i) => s + i.quantity, 0);
  const finalTotal =
    cart.total + (cart.shipping?.cost ?? 0) - cart.discount;

  return (
    <div
      style={{
        height: "100%",
        display: "flex",
        flexDirection: "column",
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: "0 0 12px",
          display: "flex",
          alignItems: "center",
          gap: "11px",
        }}
      >
        <span
          style={{
            position: "relative",
            width: "30px",
            height: "30px",
            borderRadius: "9px",
            background: "var(--chip)",
            border: "1px solid var(--bd)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flex: "none",
          }}
        >
          <svg
            width="15"
            height="15"
            viewBox="0 0 24 24"
            fill="none"
            stroke="var(--mut)"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M6 6h15l-1.5 9h-12z" />
            <path d="M6 6L5 3H2" />
            <circle cx="9" cy="20" r="1.4" />
            <circle cx="18" cy="20" r="1.4" />
          </svg>
          {cartCount > 0 && <span className="cart-badge">{cartCount}</span>}
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <span style={{ fontSize: "13.5px", fontWeight: 600 }}>
              Smart Cart
            </span>
            <span
              style={{
                fontFamily: "'Space Mono',monospace",
                fontSize: "8.5px",
                color: "var(--g2)",
                border: "1px solid var(--sheetbd, var(--bd))",
                borderRadius: "20px",
                padding: "2px 7px",
                whiteSpace: "nowrap",
              }}
            >
              {statusLabels[cart.status]}
            </span>
          </div>
          <div
            style={{
              fontSize: "10.5px",
              color: "var(--mut)",
              marginTop: "1px",
            }}
          >
            Atualizado em tempo real pela {agentName}
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div
            style={{
              fontSize: "16px",
              fontWeight: 700,
              letterSpacing: "-.3px",
            }}
          >
            {formatPrice(finalTotal)}
          </div>
        </div>
      </div>

      {/* Items */}
      <div
        style={{
          flex: 1,
          overflowY: "auto",
          paddingTop: "4px",
        }}
      >
        {cart.items.length === 0 && (
          <div
            style={{
              textAlign: "center",
              padding: "30px 10px",
              color: "var(--mut)",
            }}
          >
            <div
              style={{ fontSize: "13px", fontWeight: 600, color: "var(--tx)" }}
            >
              Carrinho vazio
            </div>
            <div style={{ fontSize: "11.5px", marginTop: "4px" }}>
              Use a busca para escolher um produto.
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const input = (e.currentTarget.elements[0] as HTMLInputElement);
                const query = input.value.trim();
                if (query) {
                  void sendMessage(`buscar ${query}`);
                  input.value = "";
                }
              }}
              style={{ marginTop: "14px" }}
            >
              <input
                type="text"
                placeholder="Buscar produto..."
                style={{
                  width: "100%",
                  padding: "10px 14px",
                  borderRadius: "10px",
                  border: "1px solid var(--bd)",
                  background: "var(--card)",
                  color: "var(--tx)",
                  fontSize: "13px",
                  outline: "none",
                }}
              />
            </form>
          </div>
        )}

        {cart.items.map((item) => {
          const unitPrice =
            item.price_cents != null ? item.price_cents / 100 : item.price;
          return (
            <div key={item.sku}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "12px",
                  padding: "12px",
                  borderRadius: "15px",
                  background: "var(--card)",
                  border: "1px solid var(--bd)",
                  marginBottom: "11px",
                }}
              >
                <div
                  style={{
                    width: "46px",
                    height: "46px",
                    borderRadius: "11px",
                    flex: "none",
                    border: "1px solid var(--bd)",
                    overflow: "hidden",
                    background: item.imageUrl
                      ? `url(${item.imageUrl}) center/cover no-repeat`
                      : "repeating-linear-gradient(135deg,var(--tile1),var(--tile1) 6px,var(--tile2) 6px,var(--tile2) 12px)",
                  }}
                />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: "13.5px", fontWeight: 600 }}>
                    {item.name}
                  </div>
                  <div
                    style={{
                      fontSize: "10.5px",
                      color: "var(--mut)",
                      marginTop: "1px",
                    }}
                  >
                    {new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(unitPrice)} un.
                  </div>
                  <button
                    type="button"
                    onClick={() => void removeCartItem(item.sku)}
                    style={{
                      marginTop: "4px",
                      padding: "0",
                      border: "none",
                      background: "none",
                      fontSize: "10.5px",
                      fontWeight: 600,
                      color: "var(--aacp-accent, #0f766e)",
                      cursor: "pointer",
                      textDecoration: "underline",
                    }}
                  >
                    Remover
                  </button>
                </div>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "9px",
                  }}
                >
                  <button
                    type="button"
                    onClick={() => {
                      if (item.quantity <= 1) {
                        void removeCartItem(item.sku);
                      } else {
                        void updateQty(item.sku, item.quantity - 1);
                      }
                    }}
                    style={{
                      width: "24px",
                      height: "24px",
                      borderRadius: "7px",
                      border: "1px solid var(--bd)",
                      background: "var(--chip)",
                      color: "var(--tx)",
                      fontSize: "14px",
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      padding: 0,
                    }}
                  >
                    −
                  </button>
                  <span
                    style={{
                      fontSize: "13px",
                      fontWeight: 600,
                      minWidth: "12px",
                      textAlign: "center",
                    }}
                  >
                    {item.quantity}
                  </span>
                  <button
                    type="button"
                    onClick={() => void updateQty(item.sku, item.quantity + 1)}
                    style={{
                      width: "24px",
                      height: "24px",
                      borderRadius: "7px",
                      border: "1px solid var(--bd)",
                      background: "var(--chip)",
                      color: "var(--tx)",
                      fontSize: "14px",
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      padding: 0,
                    }}
                  >
                    +
                  </button>
                </div>
              </div>
            </div>
          );
        })}

        {/* Shipping line */}
        {cart.shipping && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: "14px",
              padding: "9px 2px",
              borderTop: "1px solid var(--bd)",
            }}
          >
            <span
              style={{
                fontSize: "12px",
                color: "var(--mut)",
                flex: 1,
                minWidth: 0,
                lineHeight: 1.35,
              }}
            >
              Frete · {translateShippingLabel(cart.shipping.label)}
            </span>
            <span
              style={{ fontSize: "12px", fontWeight: 600, color: "var(--tx)" }}
            >
              {cart.shipping.cost === 0
                ? "Grátis"
                : formatPrice(cart.shipping.cost)}
            </span>
          </div>
        )}

        {/* Discount line */}
        {cart.discount > 0 && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: "14px",
              padding: "9px 2px",
              borderTop: "1px solid var(--bd)",
            }}
          >
            <span
              style={{
                fontSize: "12px",
                color: "var(--mut)",
                flex: 1,
                minWidth: 0,
                lineHeight: 1.35,
              }}
            >
              Desconto
            </span>
            <span
              style={{
                fontSize: "12px",
                fontWeight: 600,
                color: "var(--aacp-accent, #0f766e)",
              }}
            >
              −{formatPrice(cart.discount)}
            </span>
          </div>
        )}

        {/* Total line */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "14px",
            padding: "12px 2px",
            borderTop: "1px solid var(--bd)",
            marginTop: "8px",
          }}
        >
          <span
            style={{
              fontSize: "13px",
              fontWeight: 700,
              color: "var(--tx)",
            }}
          >
            Total final
          </span>
          <span
            style={{
              fontSize: "16px",
              fontWeight: 700,
              color: "var(--tx)",
              letterSpacing: "-.3px",
            }}
          >
            {formatPrice(finalTotal)}
          </span>
        </div>
      </div>
    </div>
  );
}
