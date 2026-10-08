import { useCallback, useEffect, useRef, useState } from "react";
import { checkoutApi } from "./api/api-client";
import type { CommerceTurnResult, CrossSellInterstitialData } from "./viewmodels/useConversationViewModel/types";

export function usePreCheckoutCrossSell(input: {
  merchantId: string | null;
  cartId: string | null;
  itemCount: number;
  sendMessage: (message: string) => Promise<CommerceTurnResult | null>;
  dismissOtherSuggestions: () => void;
}) {
  const [data, setData] = useState<CrossSellInterstitialData | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [addedIds, setAddedIds] = useState<string[]>([]);
  const scope = `${input.merchantId}:${input.cartId}`;
  const currentScope = useRef(scope); currentScope.current = scope;
  const continuation = useRef<(() => void) | null>(null);
  const running = useRef(false);
  const generation = useRef(0);
  useEffect(() => {
    generation.current++; running.current = false; continuation.current = null;
    setData(null); setBusy(false); setError(null); setAddedIds([]);
  }, [scope]);

  const request = useCallback(async (next: () => void) => {
    if (running.current || continuation.current) return;
    if (!input.merchantId || !input.cartId || !input.itemCount) { next(); return; }
    const expectedScope = currentScope.current;
    const attempt = ++generation.current;
    running.current = true;
    try {
      const suggestions = await checkoutApi.preCheckoutSuggestions(input.merchantId, input.cartId);
      if (currentScope.current !== expectedScope || generation.current !== attempt) return;
      if (!suggestions.products?.length) { next(); return; }
      input.dismissOtherSuggestions();
      continuation.current = next;
      setAddedIds([]); setError(null); setData(suggestions);
    } catch {
      // Optional recommendations cannot prevent a buyer from continuing their purchase.
      if (currentScope.current === expectedScope && generation.current === attempt) next();
    } finally {
      if (generation.current === attempt) running.current = false;
    }
  }, [input.merchantId, input.cartId, input.itemCount, input.dismissOtherSuggestions]);

  function cancel() {
    if (running.current) return;
    generation.current++; continuation.current = null; setData(null); setError(null);
  }
  function proceed() {
    if (running.current) return;
    const next = continuation.current;
    continuation.current = null; setData(null); setError(null);
    next?.();
  }
  async function add(id: string, name: string) {
    if (running.current || addedIds.includes(id)) return;
    const expectedScope = currentScope.current;
    const attempt = ++generation.current;
    running.current = true; setBusy(true); setError(null);
    try {
      const result = await input.sendMessage(`Adicionar ${name} ao carrinho [variantId:${id}]`);
      if (currentScope.current !== expectedScope || generation.current !== attempt) return;
      input.dismissOtherSuggestions();
      const saved = result?.blocks.some(block => block.type === "cart_add_result" && block.data?.status === "succeeded"
        && block.data?.variantId === id && block.data?.cartId === input.cartId);
      if (!saved) { setError("Não foi possível adicionar este produto. Tente novamente ou continue para o checkout."); return; }
      setAddedIds(ids => [...ids, id]);
    } catch {
      if (currentScope.current === expectedScope && generation.current === attempt) setError("Não foi possível adicionar este produto. Tente novamente ou continue para o checkout.");
    } finally {
      if (generation.current === attempt) { running.current = false; setBusy(false); }
    }
  }
  return { data, busy, error, addedIds, request, cancel, proceed, add };
}
