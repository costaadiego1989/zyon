import type { CheckoutSession } from "@zyon/shared-types";

export function checkoutWithCoupon(session: CheckoutSession, result: {
  coupon: { code?: unknown; discount_type?: unknown; discount_value?: unknown };
  discount_applied: number; shipping_discount_applied?: number;
}): CheckoutSession {
  const shippingDiscount = Math.max(0, result.shipping_discount_applied ?? 0);
  return {
    ...session,
    cart: { ...session.cart, currentDiscount: result.discount_applied,
      commercialNudge: couponNudge(result.coupon, result.discount_applied, shippingDiscount, session.cart.total) },
    shipping: session.shipping && shippingDiscount > 0
      ? { ...session.shipping, customerPrice: Math.max(0, session.shipping.customerPrice - shippingDiscount) }
      : session.shipping,
    updatedAt: new Date().toISOString(),
  };
}

function couponNudge(
  coupon: { code?: unknown; discount_type?: unknown; discount_value?: unknown },
  cartDiscount: number,
  shippingDiscount: number,
  cartTotal: number,
) {
  const code = typeof coupon.code === "string" ? coupon.code : "CUPOM";
  const discountType = typeof coupon.discount_type === "string" ? coupon.discount_type : "percent";
  if (shippingDiscount > 0 || discountType.startsWith("shipping_")) {
    const freeShipping = discountType === "shipping_free";
    return {
      kind: "coupon" as const,
      title: freeShipping ? "Frete grátis aplicado" : "Desconto no frete aplicado",
      message: freeShipping
        ? `O cupom ${code} liberou frete grátis para este pedido.`
        : `O cupom ${code} reduziu o frete em ${formatBrl(shippingDiscount)}.`,
      badge: freeShipping ? "Frete grátis" : `−${formatBrl(shippingDiscount)}`,
      couponCode: code,
    };
  }
  const percent =
    discountType === "percent" && cartTotal > 0
      ? Math.round((cartDiscount / cartTotal) * 10_000) / 100
      : undefined;
  return {
    kind: "coupon" as const,
    title: "Cupom aplicado",
    message: `O cupom ${code} foi aplicado e economiza ${formatBrl(cartDiscount)} neste pedido.`,
    badge: percent ? `−${percent}%` : `−${formatBrl(cartDiscount)}`,
    couponCode: code,
    ...(percent ? { discountPercent: percent } : {}),
  };
}

function formatBrl(value: number): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);
}
