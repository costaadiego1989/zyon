// Client-side Google Analytics 4 helpers.
//
// Assumes window.gtag is already injected (typically by Google Tag Manager).
// Every function is a graceful no-op when gtag is unavailable, so the
// storefront stays safe to render in dev, tests, or analytics-blocked
// environments.

type GtagFn = (
  command: "event",
  name: string,
  params?: Record<string, unknown>,
) => void;

declare global {
  interface Window {
    gtag?: GtagFn;
  }
}

function safeGtag(name: string, params?: Record<string, unknown>): void {
  if (typeof window === "undefined") return;
  if (typeof window.gtag !== "function") return;
  try {
    window.gtag("event", name, params);
  } catch {
    // swallow - analytics must never break the page
  }
}

export function trackProductView(
  productId: string,
  name: string,
  price: number,
): void {
  safeGtag("product_view", {
    items: [
      {
        item_id: productId,
        item_name: name,
        price,
      },
    ],
  });
}

export function trackAddToCart(
  productId: string,
  quantity: number,
  value: number,
): void {
  safeGtag("add_to_cart", {
    items: [
      {
        item_id: productId,
        quantity,
      },
    ],
    value,
    currency: "BRL",
  });
}

export function trackBeginCheckout(
  cartValue: number,
  itemCount: number,
): void {
  safeGtag("begin_checkout", {
    value: cartValue,
    currency: "BRL",
    items: itemCount,
  });
}

export function trackPurchase(orderId: string, value: number): void {
  safeGtag("purchase", {
    transaction_id: orderId,
    value,
    currency: "BRL",
  });
}

export function trackConversationStart(storeId: string, variantId?: string | null): void {
  const params: Record<string, unknown> = {
    store_id: storeId,
  };
  // Attach variantId if experiment is active (for A/B testing analysis)
  if (variantId) {
    params.experiment_variant_id = variantId;
  }
  safeGtag("conversation_start", params);
}