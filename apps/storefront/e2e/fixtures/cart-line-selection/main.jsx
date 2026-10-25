import { useState } from "react";
import { createRoot } from "react-dom/client";
import { CartSheet } from "@zyon/checkout-ui";
import { CartProvider, useCart } from "../../../src/lib/cart-store";
import { handleUpdateQuantity } from "../../../src/lib/handlers/conversation.handlers";
import { rememberConversationAccess } from "../../../src/lib/conversation-access";

// Synthetic scheduling-hint tokens only. The middleware never claims real JWT
// verification. Production conversationFetch/API client still perform transport.
for (const id of ["cart-a", "cart-b", "cart-c"]) rememberConversationAccess(id,
  `${btoa(JSON.stringify({ origin: location.origin, expiresAt: Date.now() / 1000 + 3600 })).replace(/=/g, "")}.synthetic-not-signed`);
sessionStorage.setItem("zyon-cart-id:merchant-a", "cart-a");
sessionStorage.setItem("zyon-cart-id:merchant-b", "cart-c");
function CartFixture({ merchantId, switchMerchant }) {
  const { cart, updating, error, updateFromBlocks, updateItemQuantity } = useCart();
  const update = (variantId, quantity, selection) => handleUpdateQuantity({ variantId, quantity, selection,
    cartId: cart.cartId, merchantId, updateItemQuantity });
  return <main>
    <h1>Synthetic local HTTP cart identity fixture</h1>
    <output data-testid="scope">{merchantId}/{cart.cartId}</output>
    <output data-testid="state">{JSON.stringify({ cart, updating, error })}</output>
    <button data-testid="replace-cart" onClick={() => updateFromBlocks([{ type: "cart_summary", data: {
      cartId: "cart-b", items: [{ variantId: "same-variant", productName: "Camiseta", quantity: 1, price: 20, subtotal: 20,
        optionItemIds: ["green"], serviceSlotId: null, selectionLabel: "Cor: Verde" }], itemCount: 1, total: 20, discount: 0 } }])}>Replace synthetic cart scope</button>
    <button data-testid="replace-merchant" onClick={switchMerchant}>Replace synthetic merchant scope</button>
    <button data-testid="replace-merchant-empty" onClick={() => {
      sessionStorage.removeItem("zyon-cart-id:merchant-b"); switchMerchant();
    }}>Replace merchant without a saved synthetic cart</button>
    <button data-testid="ambiguous" onClick={() => void update("same-variant", 0)}>Synthetic legacy ambiguous command</button>
    <div style={{ position: "relative", height: 600, width: "100%" }}>
      <CartSheet open cart={{ ...cart, subtotal: cart.total + cart.discount }} updating={updating} error={error}
        onClose={() => {}} onCheckout={() => {}} onUpdateQty={(id, quantity, selection) => void update(id, quantity, selection)}
        onRemoveItem={(id, selection) => void update(id, 0, selection)} />
    </div>
  </main>;
}
function App() {
  const [merchantId, setMerchantId] = useState("merchant-a");
  return <CartProvider merchantId={merchantId}><CartFixture merchantId={merchantId} switchMerchant={() => setMerchantId("merchant-b")} /></CartProvider>;
}
const style = document.createElement("style");
style.textContent = ":root{--aacp-fg:#182322;--aacp-muted:#586561;--aacp-accent:#14766c;--aacp-line:#d6dedb;--aacp-surface:#fff;--aacp-surface-2:#f4f7f6;--aacp-font:Arial;--aacp-bg:#fff}*{box-sizing:border-box}body{margin:0;font-family:Arial;color:var(--aacp-fg)}main{width:min(100%,680px);margin:auto;padding:8px}h1{font-size:12px}output[data-testid=state]{display:none}";
document.head.append(style);
createRoot(document.getElementById("root")).render(<App />);
