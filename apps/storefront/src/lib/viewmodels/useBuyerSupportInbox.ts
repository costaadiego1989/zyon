"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { getValidBuyer } from "../buyer-auth";
import { fetchBuyerSupport, linkBuyerSupportConversation, type BuyerSupportTicket } from "../services/buyer-support.service";

export function useBuyerSupportInbox(merchantId?: string, conversationId?: string | null) {
  const [state, setState] = useState<{ scope: string; items: BuyerSupportTicket[]; loading: boolean; error: string | null }>({ scope: "", items: [], loading: false, error: null });
  const [buyerScope, setBuyerScope] = useState("");
  const currentScope = useRef("");
  const abort = useRef<AbortController>();
  const linked = useRef("");
  const refresh = useCallback(async () => {
    const buyer = getValidBuyer();
    const scope = buyer && merchantId ? `${merchantId}:${buyer.token}` : "";
    currentScope.current = scope;
    setBuyerScope(scope);
    abort.current?.abort();
    if (!scope || !merchantId) { setState({ scope: "", items: [], loading: false, error: null }); return; }
    const controller = new AbortController(); abort.current = controller;
    setState(previous => ({ scope, items: previous.scope === scope ? previous.items : [], loading: true, error: null }));
    try {
      const linkKey = `${scope}:${conversationId ?? ""}`;
      if (conversationId && linked.current !== linkKey) {
        try { await linkBuyerSupportConversation(conversationId); linked.current = linkKey; } catch { /* A missing/expired conversation never grants access to another customer's tickets. */ }
      }
      if (currentScope.current !== scope || controller.signal.aborted || getValidBuyer()?.token !== buyer!.token) return;
      const result = await fetchBuyerSupport(merchantId, controller.signal);
      if (currentScope.current !== scope || controller.signal.aborted || getValidBuyer()?.token !== buyer!.token) return;
      setState({ scope, items: result.items.filter(ticket => ticket.merchantId === merchantId), loading: false, error: null });
    } catch {
      if (currentScope.current !== scope || controller.signal.aborted) return;
      setState(previous => ({ scope, items: previous.scope === scope ? previous.items : [], loading: false, error: "Não foi possível atualizar seus atendimentos. Tente novamente." }));
    }
  }, [merchantId, conversationId]);
  useEffect(() => {
    void refresh();
    const update = () => { void refresh(); };
    const visibleUpdate = () => { if (document.visibilityState === "visible") update(); };
    const timer = window.setInterval(visibleUpdate, 10000);
    window.addEventListener("storage", update);
    window.addEventListener("focus", visibleUpdate);
    document.addEventListener("visibilitychange", visibleUpdate);
    return () => { abort.current?.abort(); currentScope.current = ""; window.clearInterval(timer); window.removeEventListener("storage", update); window.removeEventListener("focus", visibleUpdate); document.removeEventListener("visibilitychange", visibleUpdate); };
  }, [refresh]);
  const buyer = getValidBuyer();
  const expectedScope = buyer && merchantId ? `${merchantId}:${buyer.token}` : "";
  const items = state.scope === buyerScope && state.scope === expectedScope ? state.items : [];
  const ownsState = state.scope === expectedScope;
  return { items, unreadCount: items.filter(ticket => ticket.unreadCount > 0).length, loading: ownsState && state.loading, error: ownsState ? state.error : null, refresh };
}
export type BuyerSupportInbox = ReturnType<typeof useBuyerSupportInbox>;
