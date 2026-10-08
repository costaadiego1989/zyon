"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { getValidBuyer } from "@/lib/buyer-auth";
import { listSupportCases, SUPPORT_CHANGED_EVENT, type SupportCaseSummary } from "@/lib/services/support-case.service";

export function useSupportInbox(merchantId?: string, enabled = true) {
  const [items, setItems] = useState<SupportCaseSummary[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const identity = useRef<string>();
  const generation = useRef(0);
  const busy = useRef(false);
  const refresh = useCallback(async () => {
    const buyer = getValidBuyer();
    const key = `${merchantId ?? "all"}/${buyer?.globalUserId ?? "guest"}`;
    if (identity.current !== key) { identity.current = key; generation.current++; setItems([]); setUnreadCount(0); setLoading(Boolean(buyer)); }
    if (!buyer) { setLoading(false); setError(null); return; }
    if (busy.current) return;
    busy.current = true;
    const current = generation.current;
    try { const data = await listSupportCases(merchantId); if (current === generation.current && getValidBuyer()?.globalUserId === buyer.globalUserId) { setItems(data.items); setUnreadCount(data.unreadCount); setError(null); } }
    catch (e) { if (current === generation.current) setError(e instanceof Error ? e.message : "Não foi possível consultar seus atendimentos."); }
    finally { busy.current = false; if (current === generation.current) setLoading(false); }
  }, [merchantId]);
  useEffect(() => {
    if (!enabled) return;
    void refresh();
    const update = () => { void refresh(); };
    const interval = window.setInterval(update, 10000);
    window.addEventListener("focus", update); window.addEventListener("storage", update); window.addEventListener(SUPPORT_CHANGED_EVENT, update);
    return () => { generation.current++; window.clearInterval(interval); window.removeEventListener("focus", update); window.removeEventListener("storage", update); window.removeEventListener(SUPPORT_CHANGED_EVENT, update); };
  }, [enabled, refresh]);
  return { items, unreadCount, loading, error, refresh };
}
