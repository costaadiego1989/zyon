import type { CartItem } from "../hooks/useCart";

export function CartPage({
  items,
  onRemove,
  onCheckout,
}: {
  items: CartItem[];
  onRemove: (sku: string) => void;
  onCheckout: () => void;
}) {
  const total = items.reduce((sum, item) => sum + item.price * item.quantity, 0);

  if (items.length === 0) {
    return (
      <div>
        <h2>Carrinho</h2>
        <p>Seu carrinho está vazio.</p>
      </div>
    );
  }

  return (
    <div>
      <h2>Carrinho</h2>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ borderBottom: "2px solid #ddd" }}>
            <th style={{ textAlign: "left", padding: 8 }}>Produto</th>
            <th style={{ textAlign: "right", padding: 8 }}>Preço</th>
            <th style={{ textAlign: "center", padding: 8 }}>Qtd</th>
            <th style={{ textAlign: "right", padding: 8 }}>Subtotal</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.sku} style={{ borderBottom: "1px solid #eee" }}>
              <td style={{ padding: 8 }}>{item.name}</td>
              <td style={{ padding: 8, textAlign: "right" }}>R$ {item.price.toFixed(2)}</td>
              <td style={{ padding: 8, textAlign: "center" }}>{item.quantity}</td>
              <td style={{ padding: 8, textAlign: "right" }}>R$ {(item.price * item.quantity).toFixed(2)}</td>
              <td style={{ padding: 8 }}>
                <button onClick={() => onRemove(item.sku)} data-testid={`remove-${item.sku}`}>Remover</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{ marginTop: 16, textAlign: "right", fontSize: 18, fontWeight: 700 }}>
        Total: R$ {total.toFixed(2)}
      </div>
      <button
        onClick={onCheckout}
        data-testid="go-checkout"
        style={{ marginTop: 16, background: "#16a34a", color: "#fff", border: "none", borderRadius: 6, padding: "12px 24px", cursor: "pointer", fontSize: 16 }}
      >
        Ir para Checkout
      </button>
    </div>
  );
}
