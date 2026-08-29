export function onOrderCompleted(orderId: string, _storeUrl?: string) {
  const keys = Object.keys(sessionStorage);
  keys
    .filter((k) => k.startsWith("zyon-cart"))
    .forEach((k) => sessionStorage.removeItem(k));

  if (window.parent !== window) {
    window.parent.postMessage(
      { type: "AACP_ORDER_COMPLETED", orderId },
      "*"
    );
  }

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
