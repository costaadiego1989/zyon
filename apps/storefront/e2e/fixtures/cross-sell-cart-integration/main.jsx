import { useState } from "react";
import { createRoot } from "react-dom/client";
import { CartProvider, useCart } from "../../../src/lib/cart-store";
import { useStorefrontCrossSell } from "../../../src/lib/use-storefront-cross-sell";
import { rememberConversationAccess } from "../../../src/lib/conversation-access";
import CrossSellBlock from "../../../src/components/blocks/CrossSellBlock";

// Scheduling hints only: the synthetic HTTP server does NOT verify signatures.
for (const id of ["cart-a", "cart-b", "cart-c"]) rememberConversationAccess(id,
  `${btoa(JSON.stringify({ origin: location.origin, expiresAt: Date.now() / 1000 + 3600 })).replace(/=/g, "")}.synthetic-not-signed`);
sessionStorage.setItem("zyon-cart-id:merchant-a", "cart-a");
sessionStorage.setItem("zyon-cart-id:merchant-b", "cart-c");
const products = [{ id: "target", productId: "product-target", name: "Complemento aprovado", price: 100,
  priceFormatted: "R$ 100,00", inStock: true, promoId: "promo", discountPercent: 99 }];

function JointFixture({ merchantId, conversationId, changeScope }) {
  // This context is the ONLY cart state: no useState cart, shadow provider,
  // mocked useCart or reconstructed applyCart is used by the integration gate.
  const { cart, snapshotMerchantId, updateFromBlocks, updateItemQuantity, updating, error } = useCart();
  const [applications, setApplications] = useState(0), [chatCalls, setChatCalls] = useState(0);
  const flow = useStorefrontCrossSell({ merchantId, conversationId, cart }, [products], snapshot => {
    updateFromBlocks([{ type: "cart_summary", data: snapshot }]);
    setApplications(value => value + 1);
  });
  const shown = flow.present(products);
  const patch = () => void updateItemQuantity("existing", 2, { optionItemIds: [] });
  return <main>
    <h1>Synthetic local joint CartProvider/cross-sell integration fixture</h1>
    <output data-testid="provider-state">{JSON.stringify({ merchantId, conversationId, snapshotMerchantId, cart, updating, error, applications, chatCalls })}</output>
    <output data-testid="scope">{merchantId}/{cart.cartId}</output>
    <output data-testid="provider-total">{cart.total}</output>
    <button data-testid="ordinary-patch" onClick={patch}>Start ordinary provider PATCH</button>
    <button data-testid="replace-merchant" onClick={() => changeScope("merchant-b", "cart-c")}>Replace tenant</button>
    <button data-testid="replace-cart" onClick={() => {
      updateFromBlocks([{ type: "cart_summary", data: { cartId: "cart-b", items: [{ variantId: "replacement", productName: "Replacement", quantity: 1, price: 7, subtotal: 7, optionItemIds: [] }], itemCount: 1, total: 7, discount: 0, freeShipping: false } }]);
      changeScope("merchant-a", "cart-b");
    }}>Replace cart and conversation</button>
    <section aria-label="Joint production cross-sell">
      {shown.length ? <CrossSellBlock block={{ type: "cross_sell", data: { trigger: "Complete seu pedido", products: shown } }}
        onAcceptCrossSell={flow.accept} onQuickReply={() => setChatCalls(value => value + 1)} /> : null}
    </section>
  </main>;
}
function App() {
  const [scope, setScope] = useState({ merchantId: "merchant-a", conversationId: "cart-a" });
  return <CartProvider merchantId={scope.merchantId}><JointFixture {...scope} changeScope={(merchantId, conversationId) => setScope({ merchantId, conversationId })} /></CartProvider>;
}
createRoot(document.getElementById("root")).render(<App />);
