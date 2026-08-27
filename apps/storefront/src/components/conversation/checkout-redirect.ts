/**
 * Checkout redirect logic — generates embed token and redirects to widget.
 * Extracted to avoid duplication between onCheckout and BuyerAuthGate.onComplete.
 *
 * The cart is NOT passed via URL (anti-pattern: size limits, URL leakage, tamperability).
 * Instead, the backend hydrates the checkout session's cart from the storefront cart store
 * using the cart_ref (conversation ID) passed as cartId param.
 */
export async function redirectToCheckout(opts: {
  merchantId?: string;
  cartId?: string;
  globalUserId?: string;
}) {
  const widgetBase = process.env.NEXT_PUBLIC_WIDGET_BASE_URL ?? "http://localhost:5173";
  const params = new URLSearchParams();
  if (opts.merchantId) params.set("merchantId", opts.merchantId);
  if (opts.cartId) params.set("cartId", opts.cartId);
  if (opts.globalUserId) params.set("globalUserId", opts.globalUserId);

  const tokenRes = await fetch("/api/checkout-token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      merchant_id: opts.merchantId,
      cart_ref: opts.cartId,
      allowed_origin: widgetBase,
    }),
  });

  if (!tokenRes.ok) {
    throw new Error("Não foi possível gerar token de checkout. Tente novamente.");
  }

  const data = await tokenRes.json();
  if (!data.embed_session_token) {
    throw new Error("Não foi possível gerar token de checkout. Tente novamente.");
  }

  params.set("embedToken", data.embed_session_token);
  window.location.href = `${widgetBase}?${params.toString()}`;
}
