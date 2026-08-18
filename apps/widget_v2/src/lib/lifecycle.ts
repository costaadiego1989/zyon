// Handle checkout completion — clear local state, notify parent
export function onOrderCompleted(orderId: string, _storeUrl?: string) {
  // Clear cart from sessionStorage
  const keys = Object.keys(sessionStorage);
  keys
    .filter((k) => k.startsWith("zyon-cart"))
    .forEach((k) => sessionStorage.removeItem(k));

  // Notify parent window (for iframe embeds)
  if (window.parent !== window) {
    window.parent.postMessage(
      { type: "AACP_ORDER_COMPLETED", orderId },
      "*"
    );
  }

  // Dispatch custom event (for direct embeds)
  window.dispatchEvent(
    new CustomEvent("aacp:order-completed", { detail: { orderId } })
  );
}

export function onCheckoutAbandoned() {
  if (window.parent !== window) {
    window.parent.postMessage({ type: "AACP_CHECKOUT_ABANDONED" }, "*");
  }
  window.dispatchEvent(new CustomEvent("aacp:checkout-abandoned"));
}
