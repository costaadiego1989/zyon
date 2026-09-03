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

  const generateLabel = useCallback(async (returnId: string) => {
    setActing(returnId);
    try {
      await api.generateReturnLabel(merchantId, returnId);
      setReturns((prev) => prev.map((r) => r.id === returnId ? { ...r, status: "LABEL_GENERATED" as ReturnStatus } : r));
      showToast("success", "Etiqueta de devolução gerada");
    } catch (e) {
      reportError({ source: "returns.generateLabel", error: e });
      showToast("error", "Erro ao gerar etiqueta");
    } finally { setActing(null); }
  }, [api, merchantId]);

  const markReceived = useCallback(async (returnId: string) => {
    setActing(returnId);
    try {
      await api.markReturnReceived(merchantId, returnId);
      setReturns((prev) => prev.map((r) => r.id === returnId ? { ...r, status: "RECEIVED" as ReturnStatus } : r));
      showToast("success", "Produto marcado como recebido");
    } catch (e) {
      reportError({ source: "returns.markReceived", error: e });
      showToast("error", "Erro ao marcar recebido");
    } finally { setActing(null); }
  }, [api, merchantId]);

  const processRefund = useCallback(async (returnId: string) => {
    setActing(returnId);
    try {
      await api.processRefund(merchantId, returnId);
      setReturns((prev) => prev.map((r) => r.id === returnId ? { ...r, status: "REFUND_PROCESSING" as ReturnStatus } : r));
      showToast("success", "Reembolso em processamento");
    } catch (e) {
      reportError({ source: "returns.processRefund", error: e });
      showToast("error", "Erro ao processar reembolso");
    } finally { setActing(null); }
  }, [api, merchantId]);

  // Accept a return: refund the buyer and, for cross-store items, cancel the
  // seller repasse (marketplace settlement → return_cancelled). Mixed orders
  // only cancel the returned cross-store items, handled server-side by variant.
  const acceptReturn = useCallback(async (returnId: string) => {
    setActing(returnId);
    try {
      await api.acceptReturn(merchantId, returnId);
      setReturns((prev) => prev.map((r) => r.id === returnId ? { ...r, status: "REFUND_PROCESSING" as ReturnStatus } : r));
      showToast("success", "Devolução aceita — reembolso em processamento");
    } catch (e) {
      reportError({ source: "returns.acceptReturn", error: e });
      showToast("error", "Erro ao aceitar devolução");
    } finally { setActing(null); }
  }, [api, merchantId]);

  const stats = {
    total: returns.length,
    inTransit: returns.filter((r) => r.status === "SHIPPED" || r.status === "LABEL_GENERATED").length,
    awaitingInspection: returns.filter((r) => r.status === "RECEIVED").length,
    refunded: returns.filter((r) => r.status === "REFUND_COMPLETED").length,
  };

  return { returns, loading, acting, stats, generateLabel, markReceived, processRefund, acceptReturn, refresh: load };
}
