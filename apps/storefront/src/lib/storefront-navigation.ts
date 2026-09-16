export interface StorefrontView { productId?: string; checkout: boolean; cart: boolean; recovery?: string }
const catalogId = /^[A-Za-z0-9_-]{1,191}$/;
export function readStorefrontView(search: string): StorefrontView {
  const params = new URLSearchParams(search);
  const show = params.get("show");
  const product = params.get("product") ?? params.get("productId");
  const recovery = params.get("recovery");
  return {
    productId: ["content", "product", "rich"].includes(show ?? "") && product && catalogId.test(product) ? product : undefined,
    checkout: show === "checkout", cart: show === "cart",
    recovery: show === "checkout" && recovery ? recovery : undefined,
  };
}
export function productShareUrl(origin: string, slug: string, productId: string): string {
  if (!slug || !catalogId.test(productId)) return "";
  const url = new URL(`/store/${encodeURIComponent(slug)}`, origin);
  url.searchParams.set("show", "content");
  url.searchParams.set("product", productId);
  return url.href;
}
export function storefrontViewUrl(current: string, view: StorefrontView): string {
  const url = new URL(current);
  for (const key of ["show", "product", "productId", "recovery", "sessionId", "embedToken", "cartRef"]) url.searchParams.delete(key);
  if (view.checkout) {
    url.searchParams.set("show", "checkout");
    if (view.recovery) url.searchParams.set("recovery", view.recovery);
  } else if (view.cart) url.searchParams.set("show", "cart");
  else if (view.productId && catalogId.test(view.productId)) {
    url.searchParams.set("show", "content");
    url.searchParams.set("product", view.productId);
  }
  return url.pathname + url.search + url.hash;
}
