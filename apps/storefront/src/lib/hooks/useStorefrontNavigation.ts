"use client";
import { useCallback, useEffect, useState } from "react";
import { readStorefrontView, storefrontViewUrl, type StorefrontView } from "../storefront-navigation";

export function useStorefrontNavigation(initialSearch: string) {
  const [view, setView] = useState(() => readStorefrontView(initialSearch));
  useEffect(() => {
    const read = () => setView(readStorefrontView(window.location.search));
    read();
    window.addEventListener("popstate", read);
    window.addEventListener("aacp:navigation", read);
    return () => { window.removeEventListener("popstate", read); window.removeEventListener("aacp:navigation", read); };
  }, []);
  const navigate = useCallback((next: StorefrontView, replace = false) => {
    const url = storefrontViewUrl(window.location.href, next);
    if (url === window.location.pathname + window.location.search + window.location.hash) return;
    const state = { ...window.history.state, aacpView: !replace };
    window.history[replace ? "replaceState" : "pushState"](state, "", url);
    window.dispatchEvent(new Event("aacp:navigation"));
  }, []);
  const close = useCallback(() => {
    if (window.history.state?.aacpView) window.history.back();
    else navigate({ checkout: false, cart: false }, true);
  }, [navigate]);
  const setProduct = useCallback((product: { productId: string } | null) => {
    if (product) navigate({ checkout: false, cart: false, productId: product.productId });
    else if (readStorefrontView(window.location.search).productId) close();
  }, [navigate, close]);
  const setCheckout = useCallback((open: boolean) => {
    if (open) navigate({ checkout: true, cart: false });
    else if (readStorefrontView(window.location.search).checkout) close();
  }, [navigate, close]);
  const setCart = useCallback((open: boolean) => {
    if (open) navigate({ checkout: false, cart: true });
    else if (readStorefrontView(window.location.search).cart) close();
  }, [navigate, close]);
  return { view, setProduct, setCheckout, setCart, close };
}
