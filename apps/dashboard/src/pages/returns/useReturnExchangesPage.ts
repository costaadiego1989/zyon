import { useEffect, useState, useCallback } from "react";
import { useApi } from "../../hooks/useApi.js";
import { showToast } from "../../components/Toast.js";
import { reportError } from "../../hooks/useErrorReporter.js";
import type { ReturnEntry, ReturnStatus } from "../../api/endpoints/returns.js";

export function useReturnExchangesPage(merchantId: string) {
  const api = useApi();
  const [returns, setReturns] = useState<ReturnEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.listReturns(merchantId);
      setReturns(res.returns);
    } catch (e) {
      reportError({ source: "returns.load", error: e });
    } finally {
      setLoading(false);
    }
  }, [api, merchantId]);

  useEffect(() => { void load(); }, [load]);

  const openConversation = useCallback(async (returnId: string) => {
    if (acting) return;
    setActing(returnId);
    try {
      const result = await api.getReturnSupportCase(returnId);
      window.location.hash = `support?ticket=${encodeURIComponent(result.ticketId)}`;
    } catch (e) {
      reportError({ source: "returns.openConversation", error: e });
      showToast("error", "Não foi possível abrir a conversa. Tente novamente.");
    } finally { setActing(null); }
  }, [api, acting]);

  const stats = {
    total: returns.length,
    inTransit: returns.filter((r) => r.status === "SHIPPED" || r.status === "LABEL_GENERATED").length,
    awaitingInspection: returns.filter((r) => r.status === "RECEIVED").length,
    refunded: returns.filter((r) => r.status === "REFUND_COMPLETED").length,
  };

  return { returns, loading, acting, stats, openConversation, refresh: load };
}
