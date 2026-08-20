/**
 * Checkout redirect logic — generates embed token and redirects to widget.
 * Extracted to avoid duplication between onCheckout and BuyerAuthGate.onComplete.
 */
export async function redirectToCheckout(opts: {
  merchantId?: string;
  cartId?: string;
}) {
  const widgetBase = process.env.NEXT_PUBLIC_WIDGET_BASE_URL ?? "http://localhost:5173";
  const params = new URLSearchParams();
  if (opts.merchantId) params.set("merchantId", opts.merchantId);
  if (opts.cartId) params.set("cartId", opts.cartId);

  try {
    const tokenRes = await fetch("/api/checkout-token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        merchant_id: opts.merchantId,
        cart_ref: opts.cartId,
        allowed_origin: widgetBase,
      }),
    });
    if (tokenRes.ok) {
      const data = await tokenRes.json();
      params.set("embedToken", data.embed_session_token);
    }
  } catch (e) {
    console.error("[checkout] token fetch error:", e);
  }

  window.location.href = `${widgetBase}?${params.toString()}`;
}
