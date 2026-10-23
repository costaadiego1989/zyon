import { useEffect, useRef, useState } from "react";
import { CheckoutSession, cartFromExperience } from "../../../../widget_v2/src/api/checkout-session";
import { useCheckoutStore } from "../../../../widget_v2/src/store/checkout-store";
import { BlockRenderer } from "../../../../widget_v2/src/components/chat/ChatBlocks";
import { CheckoutProductDetailContext } from "../../../../widget_v2/src/lib/checkout-product-detail-context";
import RichProductDetailsPanel from "../../../src/components/blocks/RichProductDetailsPanel";

// Real production SDK/store/blocks/detail, intercepted API. Deliberately small
// host fixture, NOT actual ConversationShell, Nest, SQL, PSP or signed auth proof.
export function CheckoutFixture() {
  const standalone = new URLSearchParams(location.search).has("standalone");
  const [detail, setDetail] = useState(null), [generation, setGeneration] = useState(0), [ready, setReady] = useState(false);
  const api = useCheckoutStore(state => state.api), cart = useCheckoutStore(state => state.cart);
  const checkoutStage = useCheckoutStore(state => state.checkoutStage);
  const error = useCheckoutStore(state => state.cartError), recovery = useCheckoutStore(state => state.crossSellRecoveryRequired);
  const context = useRef(null); context.current = { detail, generation };
  useEffect(() => {
    let active = true; const instance = new CheckoutSession({ merchantId: "store", embedToken: "synthetic-browser-token", apiBaseUrl: location.origin });
    void instance.start().then(response => {
      if (!active) return;
      useCheckoutStore.setState({ api: instance, sessionId: instance.currentSessionId, status: "active", leadRegistered: true,
        cart: { ...cartFromExperience(response.experience), status: "awaiting" }, crossSellRecoveryRequired: false,
        preparedCrossSellQuotes: {}, crossSellQuoteGeneration: {}, staleCrossSellQuotes: {}, cartError: null }); setReady(true);
    });
    return () => { active = false; };
  }, [generation]);
  const open = request => {
    const expectedGeneration = generation;
    const purchase = { request: { ...request, isCurrent: () => context.current.detail === purchase && context.current.generation === expectedGeneration && request.isCurrent() },
      close: () => setDetail(value => value === purchase ? null : value) };
    setDetail(purchase);
  };
  return <main>
    <h1>Checkout — fixture sintética local</h1>
    <output data-testid="checkout-total">{cart.total}</output><output data-testid="checkout-session">{api?.currentSessionId}</output>
    <output data-testid="checkout-recovery">{String(recovery)}</output>
    <output hidden data-testid="checkout-stage">{checkoutStage}</output>
    <output hidden data-testid="checkout-cart-status">{cart.status}</output>
    <output hidden data-testid="checkout-fulfillment">{JSON.stringify(cart.items.map(item => [item.sku, item.productType, item.fulfillmentStrategy]))}</output>
    <button data-testid="checkout-replace" onClick={() => { useCheckoutStore.getState().resetSession(); setDetail(null); setReady(false); setGeneration(value => value + 1); }}>Trocar sessão sintética</button>
    <section data-testid="checkout-origin" hidden={Boolean(detail)}>
      <CheckoutProductDetailContext.Provider value={standalone ? undefined : open}>
        {ready ? <BlockRenderer block={{ type: "cross_sell", data: { products: standalone ? [
          { name: "Complemento azul", sku: "BLUE", variantId: "blue", productId: "product-added", suggestionId: "suggestion", price: 1, inStock: true },
          { name: "Complemento vermelho", sku: "RED", variantId: "red", productId: "product-other", suggestionId: "suggestion", price: 999, inStock: true },
          { name: "Complemento com opções", sku: "REQUIRED", variantId: "required", productId: "product-required", suggestionId: "suggestion", optionGroups: [{ required: true }], inStock: true },
        ] : [{ name: "Complemento checkout", sku: "BLUE", variantId: "blue", productId: "product-added", suggestionId: "suggestion", inStock: true }] } }} /> : <p>Carregando fixture</p>}
      </CheckoutProductDetailContext.Provider>
      <button data-testid="checkout-payment" onClick={() => { void useCheckoutStore.getState().pay("pix"); }}>Pagamento da fixture</button>
      <button data-testid="checkout-remove" onClick={() => { void useCheckoutStore.getState().removeCartItem("EXISTING"); }}>Remover da fixture</button>
      {error ? <p role="alert">{error}</p> : null}
    </section>
    {detail ? <RichProductDetailsPanel key={detail.request.key} productId={detail.request.productId} merchantSlug="fixture"
      checkoutPurchase={detail} onClose={() => detail.close()} /> : null}
  </main>;
}
