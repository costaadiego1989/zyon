"use client";
import { createPostAcceptReadGuard, postAcceptCartKey, type PostCartSuggestions, type PostAcceptRevision } from './post-cart-suggestions';

import { useEffect, useMemo, useRef, useState } from "react";
import { cartApi, crossSellApi } from "./api/api-client";
import { getValidBuyer } from "./buyer-auth";
import type { CartState } from "./cart-store";
import { StorefrontCrossSellBuyerFlow, type CrossSellDisplayProduct } from "./storefront-cross-sell-flow";

/** All placements share one displayed-quote/acceptance lifecycle per cart revision. */
export function useStorefrontCrossSell(input: { merchantId?: string; conversationId: string | null; cart: CartState },
  groups: readonly (readonly CrossSellDisplayProduct[] | null | undefined)[], applyCart: (cart: Record<string, unknown>) => void, onPostCartSuggestions?: (block: PostCartSuggestions) => void) {
  const [, rerender] = useState(0);
  const mounted = useRef(false), scopeRef = useRef(""), applyRef = useRef(applyCart);
  applyRef.current = applyCart;
  const suggestionsRef = useRef(onPostCartSuggestions); suggestionsRef.current = onPostCartSuggestions;
  const key = postAcceptCartKey(input, input.cart);
  const appliedScope = useRef<PostAcceptRevision>({ key, revision: 0 });
  const pendingRead = useRef<AbortController | null>(null);
  const buyerEpoch = useRef(0);
  useEffect(() => {
    const changed = (event: StorageEvent) => {
      if (event.key !== null && event.key !== "zyon_buyer_token") return;
      buyerEpoch.current += 1; pendingRead.current?.abort();
    };
    window.addEventListener("storage", changed);
    return () => window.removeEventListener("storage", changed);
  }, []);
  if (appliedScope.current.key !== key) {
    appliedScope.current = { key, revision: appliedScope.current.revision + 1 };
    pendingRead.current?.abort();
  }
  scopeRef.current = key;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; pendingRead.current?.abort(); }; }, []);
  const flow = useMemo(() => {
    if (!input.merchantId || !input.conversationId || input.cart.cartId !== input.conversationId) return null;
    return new StorefrontCrossSellBuyerFlow({ merchantId: input.merchantId, cartId: input.cart.cartId, conversationId: input.conversationId }, {
      quote: (scope, selection) => crossSellApi.quote(scope.merchantId, scope.cartId, scope.conversationId, selection),
      accept: (scope, quote) => crossSellApi.accept(scope.merchantId, scope.cartId, scope.conversationId, quote),
      getCart: scope => cartApi.get(scope.cartId, scope.merchantId),
      applyCart: cart => {
        // Advance the owned reference synchronously from the confirmed snapshot,
        // before React renders and before a best-effort recommendation read.
        const acceptedKey = postAcceptCartKey(input, cart as Parameters<typeof postAcceptCartKey>[1]);
        if (appliedScope.current.key !== acceptedKey) {
          appliedScope.current = { key: acceptedKey, revision: appliedScope.current.revision + 1 };
          pendingRead.current?.abort();
        }
        scopeRef.current = acceptedKey; applyRef.current(cart);
      },
      afterAccepted: async (scope, quote, cart, readOwnerCurrent) => {
        if (!suggestionsRef.current || !mounted.current || readOwnerCurrent?.() === false) return;
        const captured = { ...appliedScope.current };
        if (captured.key !== postAcceptCartKey(scope, cart as Parameters<typeof postAcceptCartKey>[1])) return;
        const identity = { buyerId: getValidBuyer()?.globalUserId ?? null, revision: buyerEpoch.current };
        const current = createPostAcceptReadGuard(captured, () => appliedScope.current, () => mounted.current, {
          captured: identity, current: () => ({ buyerId: getValidBuyer()?.globalUserId ?? null, revision: buyerEpoch.current }),
        });
        pendingRead.current?.abort(); const controller = new AbortController(); pendingRead.current = controller;
        try {
          const read = await cartApi.getPostAddSuggestions(scope.cartId, scope.merchantId, quote.variantId, controller.signal);
          if (!current() || readOwnerCurrent?.() === false || postAcceptCartKey(scope, read as Parameters<typeof postAcceptCartKey>[1]) !== captured.key) return;
          if (read.postCartSuggestions) suggestionsRef.current?.(read.postCartSuggestions);
        } catch { /* The accepted item remains accepted; no writer is replayed. */ }
        finally { if (pendingRead.current === controller) pendingRead.current = null; }
      },
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
    accept: (product: CrossSellDisplayProduct, guard?: () => boolean) => {
      if (!flow) return Promise.resolve(false);
      // Capture before Flow.accept starts its ACK/GET awaits. This predicate
      // stays on the mounted hook and survives its accepted-cart Flow change.
      const owner = { buyerId: getValidBuyer()?.globalUserId ?? null, revision: buyerEpoch.current };
      const readOwnerCurrent = () => mounted.current && buyerEpoch.current === owner.revision
        && (getValidBuyer()?.globalUserId ?? null) === owner.buyerId;
      return flow.accept(product, guard, readOwnerCurrent);
    },
  };
}
