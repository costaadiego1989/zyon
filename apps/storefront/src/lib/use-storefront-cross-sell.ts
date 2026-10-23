"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { cartApi, crossSellApi } from "./api/api-client";
import type { CartState } from "./cart-store";
import { StorefrontCrossSellBuyerFlow, type CrossSellDisplayProduct } from "./storefront-cross-sell-flow";

/** All placements share one displayed-quote/acceptance lifecycle per cart revision. */
export function useStorefrontCrossSell(input: { merchantId?: string; conversationId: string | null; cart: CartState },
  groups: readonly (readonly CrossSellDisplayProduct[] | null | undefined)[], applyCart: (cart: Record<string, unknown>) => void) {
  const [, rerender] = useState(0);
  const mounted = useRef(false), scopeRef = useRef(""), applyRef = useRef(applyCart);
  applyRef.current = applyCart;
  const key = JSON.stringify([input.merchantId, input.conversationId, input.cart.cartId,
    input.cart.items.map(item => [item.variantId, item.quantity, item.price, [...(item.optionItemIds ?? [])].sort()]), input.cart.total, input.cart.discount,
    input.cart.couponCode ?? null, input.cart.freeShipping ?? false]);
  scopeRef.current = key;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const flow = useMemo(() => {
    if (!input.merchantId || !input.conversationId || input.cart.cartId !== input.conversationId) return null;
    return new StorefrontCrossSellBuyerFlow({ merchantId: input.merchantId, cartId: input.cart.cartId, conversationId: input.conversationId }, {
      quote: (scope, selection) => crossSellApi.quote(scope.merchantId, scope.cartId, scope.conversationId, selection),
      accept: (scope, quote) => crossSellApi.accept(scope.merchantId, scope.cartId, scope.conversationId, quote),
      getCart: scope => cartApi.get(scope.cartId, scope.merchantId),
      applyCart: cart => applyRef.current(cart),
    }, () => mounted.current && scopeRef.current === key, () => rerender(value => value + 1));
    // The serialized revision captures every financial dependency; object identity
    // must not invalidate an in-flight acceptance on an unrelated shell render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const unique = new Map<string, CrossSellDisplayProduct>();
  for (const products of groups) for (const product of products ?? []) {
    unique.set(JSON.stringify([product.id, product.promoId, [...(product.selectedOptionItemIds ?? [])].sort()]), product);
  }
  const candidates = [...unique.values()].slice(-40);
  const candidatesKey = JSON.stringify(candidates.map(product => [product.id, product.productId, product.promoId, product.inStock, product.couponCode, product.selectedOptionItemIds ?? []]));
  useEffect(() => {
    if (flow) void flow.prepare(candidates).catch(() => { /* malformed candidates do not authorize another path */ });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flow, candidatesKey]);
  return {
    scopeKey: key,
    prepare: (products: readonly CrossSellDisplayProduct[]) => flow?.prepare(products) ?? Promise.resolve(),
    quoted: (products: readonly CrossSellDisplayProduct[]) => flow?.present(products) ?? [],
    present: (products: readonly CrossSellDisplayProduct[]) => flow?.browse(products)
      ?? products.filter(product => !product.promoId && !product.couponCode && !(product.discountPercent && product.discountPercent > 0)),
    accept: (product: CrossSellDisplayProduct, guard?: () => boolean) => flow?.accept(product, guard) ?? Promise.resolve(false),
  };
}
