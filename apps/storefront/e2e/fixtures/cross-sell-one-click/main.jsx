import { useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import CrossSellBlock from "../../../src/components/blocks/CrossSellBlock";
import CrossSellInterstitial from "../../../src/components/CrossSellInterstitial";
import RichProductContentRenderer from "../../../src/components/blocks/RichProductContentRenderer";
import RichProductDetailsPanel from "../../../src/components/blocks/RichProductDetailsPanel";
import { createCrossSellDetailContext, isCrossSellDetailCurrent } from "../../../src/lib/storefront-cross-sell-detail";
import { CartProvider } from "../../../src/lib/cart-store";
import { useStorefrontCrossSell } from "../../../src/lib/use-storefront-cross-sell";
import { rememberConversationAccess } from "../../../src/lib/conversation-access";
import { CheckoutFixture } from "./checkout";

// Isolated local browser fixture: production components/hook/coordinator/HTTP
// client. Playwright controls the upstream API; this is not Nest/SQL or rollout.
const token = `${btoa(JSON.stringify({ origin: location.origin, expiresAt: Date.now() / 1000 + 3600 })).replace(/=/g, "")}.synthetic-not-signed`;
rememberConversationAccess("cart", token);
const optionMode = new URLSearchParams(location.search).has("options");
const detailMode = new URLSearchParams(location.search).has("detail");
const candidates = [{ id: "added", productId: "product-added", name: "Complemento aprovado", price: 100,
  priceFormatted: "R$ 100,00", inStock: true, promoId: "promo", discountPercent: 99,
  ...(optionMode && !detailMode ? { selectedOptionItemIds: ["target-size"] } : {}) }];
const initialCart = { cartId: "cart", items: [{ variantId: "existing", productName: "Existing", quantity: 1, price: 100, subtotal: 100 }],
  itemCount: 1, subtotal: 100, total: 100, discount: 0, freeShipping: false };
if (optionMode) {
  initialCart.items = [{ ...initialCart.items[0], price: 105, subtotal: 105, optionItemIds: ["size"] },
    { ...initialCart.items[0], price: 105, subtotal: 105, optionItemIds: ["color"] }];
  initialCart.itemCount = 2; initialCart.total = initialCart.subtotal = 210;
}
function Fixture() {
  const [cart, setCart] = useState(initialCart), [chatCalls, setChatCalls] = useState(0);
  const [applied, setApplied] = useState(0);
  const [conversationId, setConversationId] = useState("cart");
  const [detail, setDetail] = useState(null), [opened, setOpened] = useState(false);
  const viewRef = useRef(null);
  viewRef.current = { context: detail, productId: opened ? detail?.productId : null, blocked: false,
    merchantId: "store", conversationId, cartId: cart.cartId };
  const flow = useStorefrontCrossSell({ merchantId: "store", conversationId, cart }, [candidates], snapshot => {
    setCart(snapshot); setApplied(value => value + 1);
  });
  const products = flow.present(candidates), data = { trigger: "Complete seu pedido", products };
  const mode = new URLSearchParams(location.search).get("placement");
  const open = detailMode ? product => { const context = createCrossSellDetailContext({ merchantId: "store", conversationId, cartId: cart.cartId }, product, mode);
    viewRef.current = { ...viewRef.current, context, productId: context.productId }; setDetail(context); setOpened(true); } : undefined;
  const close = () => { viewRef.current = { ...viewRef.current, productId: null }; setOpened(false); };
  return <main>
    <h1>Cross-sell — fixture sintética local</h1>
    <output data-testid="applied">{applied}</output><output data-testid="chat-calls">{chatCalls}</output>
    <output data-testid="cart-total">{cart.total}</output>
    <output data-testid="conversation">{conversationId}</output>
    <button data-testid="replace-conversation" onClick={() => setConversationId("replacement")}>Trocar sessão da fixture</button>
    <section aria-label="Oferta validada" hidden={opened}>
      {mode === "interstitial" ? <CrossSellInterstitial data={data} onClose={() => {}} onViewCart={() => {}}
        onOpenProduct={open} onAddItem={(_id, _name, _promo, _coupon, shown) => { if (shown) void flow.accept(shown); }} />
        : mode === "rich" ? <RichProductContentRenderer blocks={[]} faqs={[]} testimonials={[]} videos={[]}
          narrationEnabled={false} crossSell={data} onOpenCrossSell={open} onAddCrossSell={shown => { void flow.accept(shown); }}
          purchase={{ productName: "Produto principal", defaultVariantId: "existing", priceReais: 100,
            variants: [{ id: "existing", attributes: {}, available: true, priceReais: 100, currency: "BRL", lowStock: false }], images: [], optionGroups: [] }} />
          : <CrossSellBlock block={{ type: "cross_sell", data }} onOpenCrossSell={open} onQuickReply={() => setChatCalls(value => value + 1)} onAcceptCrossSell={flow.accept} />}
    </section>
    {opened && detail ? <RichProductDetailsPanel key={detail.key} productId={detail.productId} merchantSlug="fixture" onClose={close}
      financialPurchase={{ context: detail, scopeKey: flow.scopeKey, isCurrent: () => isCrossSellDetailCurrent(detail, viewRef.current),
        prepare: flow.prepare, present: flow.quoted, accept: flow.accept }} /> : null}
  </main>;
}
const style = document.createElement("style");
style.textContent = ":root{--aacp-fg:#182322;--aacp-muted:#586561;--aacp-accent:#14766c;--aacp-line:#d6dedb;--aacp-surface:#fff;--aacp-surface-2:#f4f7f6;--aacp-font:Arial;--aacp-bg:#fff}*{box-sizing:border-box}body{margin:0;font-family:Arial;color:var(--aacp-fg)}main{width:min(100%,680px);margin:auto;padding:16px}";
document.head.append(style);
createRoot(document.getElementById("root")).render(<CartProvider>{new URLSearchParams(location.search).has("checkout") ? <CheckoutFixture /> : <Fixture />}</CartProvider>);
