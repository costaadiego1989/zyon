import { useEffect, useState, useCallback, useRef } from "react";
import { useApi } from "../../hooks/useApi.js";
import { showToast } from "../../components/Toast.js";
import { reportError } from "../../hooks/useErrorReporter.js";
import type { ReturnEntry, ReturnItemCondition, ReverseShippingView } from "../../api/endpoints/returns.js";

export function useReturnExchangesPage(merchantId: string) {
  const api = useApi();
  const currentMerchant = useRef(merchantId);
  currentMerchant.current = merchantId;
  const [returns, setReturns] = useState<ReturnEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState<string | null>(null);
  const [reverseShipping, setReverseShipping] = useState<ReverseShippingView | null>(null);
  const [refundConfirmation, setRefundConfirmation] = useState<{ returnId: string; action: "accept" | "refund"; amountCents: number } | null>(null);
  useEffect(() => { setRefundConfirmation(null); setReverseShipping(null); setReturns([]); setActing(null); }, [merchantId]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.listReturns(merchantId);
      if (currentMerchant.current !== merchantId) return;
      setReturns(res.returns);
    } catch (e) {
      reportError({ source: "returns.load", error: e });
    } finally {
      if (currentMerchant.current === merchantId) setLoading(false);
    }
  }, [api, merchantId]);

  useEffect(() => { void load(); }, [load]);

  const openReverseShipping = useCallback(async (returnId: string) => {
    setActing(returnId);
    try { const result = await api.getReturnReverseShipping(merchantId, returnId);
      if (currentMerchant.current === merchantId) setReverseShipping(result);
    } catch (error) { if (currentMerchant.current === merchantId) {
      reportError({ source: "returns.reverseShipping", error });
      showToast("error", "Não foi possível preparar a devolução. Confira a conta e a etiqueta original no Melhor Envio, ou informe uma etiqueta já emitida.");
    } } finally { if (currentMerchant.current === merchantId) setActing(null); }
  }, [api, merchantId]);
  const prepareReverseShipping = useCallback(async (input: Parameters<typeof api.prepareReturnReverseShipping>[2]) => {
    if (!reverseShipping) return;
    const id = reverseShipping.returnId; setActing(id);
    try { const result = await api.prepareReturnReverseShipping(merchantId, id, input);
      if (currentMerchant.current === merchantId) setReverseShipping(result);
    } catch (error) { if (currentMerchant.current === merchantId) {
      reportError({ source: "returns.reversePrepare", error }); showToast("error", "Preparação não confirmada. Atualize o estado antes de continuar.");
      await openReverseShipping(id);
    } } finally { if (currentMerchant.current === merchantId) setActing(null); }
  }, [api, merchantId, reverseShipping, openReverseShipping]);
  const confirmReverseShipping = useCallback(async () => {
    if (!reverseShipping) return;
    const id = reverseShipping.returnId; setActing(id);
    try { const result = await api.confirmReturnReverseShipping(merchantId, id, reverseShipping.amountCents);
      if (currentMerchant.current !== merchantId) return;
      setReverseShipping(result); await load();
      if (currentMerchant.current === merchantId) showToast("success", result.shipments.every(s => s.status === "reverse_generated")
        ? "Códigos de devolução confirmados" : "Emissão em conferência no Melhor Envio. A compra não será repetida.");
    } catch (error) { if (currentMerchant.current === merchantId) {
      reportError({ source: "returns.reverseConfirm", error }); showToast("error", "Resposta da emissão não confirmada. Consulte o estado antes de continuar.");
      await openReverseShipping(id); await load();
    } } finally { if (currentMerchant.current === merchantId) setActing(null); }
  }, [api, merchantId, reverseShipping, openReverseShipping, load]);

  const generateLabel = useCallback(async (returnId: string, label: { carrier: string; trackingNumber: string; labelUrl?: string }) => {
    setActing(returnId);
    try {
      const result = await api.generateReturnLabel(merchantId, returnId, label);
      if (currentMerchant.current !== merchantId) return false;
      setReturns((prev) => prev.map((r) => r.id === returnId ? { ...r, status: result.status, label: result.label } : r));
      showToast("success", "Etiqueta de devolução registrada");
      return true;
    } catch (e) {
      if (currentMerchant.current !== merchantId) return false;
      reportError({ source: "returns.generateLabel", error: e });
      showToast("error", "Não foi possível registrar a etiqueta. Confira os dados da transportadora.");
      return false;
    } finally { if (currentMerchant.current === merchantId) setActing(null); }
  }, [api, merchantId]);

  const markReceived = useCallback(async (returnId: string) => {
    setActing(returnId);
    try {
      const result = await api.markReturnReceived(merchantId, returnId);
      if (currentMerchant.current !== merchantId) return;
      setReturns((prev) => prev.map((r) => r.id === returnId ? { ...r, status: result.status } : r));
      showToast("success", "Produto marcado como recebido");
    } catch (e) {
      if (currentMerchant.current !== merchantId) return;
      reportError({ source: "returns.markReceived", error: e });
      showToast("error", "Erro ao marcar recebido");
    } finally { if (currentMerchant.current === merchantId) setActing(null); }
  }, [api, merchantId]);

  const inspectReturn = useCallback(async (returnId: string, itemCondition: ReturnItemCondition) => {
    setActing(returnId);
    try {
      const result = await api.inspectReturn(merchantId, returnId, { itemCondition, verdict: itemCondition === "UNUSABLE" ? "REJECTED" : "APPROVED" });
      if (currentMerchant.current !== merchantId) return false;
      setReturns(prev => prev.map(row => row.id === returnId ? { ...row, status: result.status, inspection: result.inspection } : row));
      showToast("success", "Análise da devolução registrada"); return true;
    } catch (e) { if (currentMerchant.current !== merchantId) return false; reportError({ source: "returns.inspect", error: e }); showToast("error", "Não foi possível registrar a análise"); return false; }
    finally { if (currentMerchant.current === merchantId) setActing(null); }
  }, [api, merchantId]);

  const submitRefund = useCallback(async (returnId: string, action: "accept" | "refund") => {
    setActing(returnId);
    try {
      const result = action === "accept" ? await api.acceptReturn(merchantId, returnId) : await api.processRefund(merchantId, returnId);
      if (currentMerchant.current !== merchantId) return;
      setReturns((prev) => prev.map((r) => r.id === returnId ? { ...r, status: result.status, refund: result.refund } : r));
      showToast(result.refund?.status === "FAILED" ? "error" : "success", result.status === "REFUND_COMPLETED"
        ? "Reembolso confirmado pelo provedor" : result.refund?.status === "FAILED" ? "O provedor não confirmou o estorno. Consulte o processamento."
          : "Estorno enviado. Aguardando confirmação do provedor.");
      setRefundConfirmation(null);
    } catch (e) {
      if (currentMerchant.current !== merchantId) return;
      reportError({ source: "returns.processRefund", error: e });
      setRefundConfirmation(null);
      await load();
      if (currentMerchant.current === merchantId) showToast("error", "Resposta do estorno não confirmada. Consulte o status do pedido antes de qualquer nova ação.");
    } finally { if (currentMerchant.current === merchantId) setActing(null); }
  }, [api, merchantId, load]);

  const requestRefund = useCallback(async (returnId: string, action: "accept" | "refund") => {
    setActing(returnId);
    try {
      const preview = await api.previewReturnRefund(merchantId, returnId);
      if (currentMerchant.current !== merchantId) return;
      if (preview.alreadySubmitted) { await submitRefund(returnId, "refund"); return; }
      if (!Number.isSafeInteger(preview.amountCents) || preview.amountCents <= 0) throw new Error("invalid_refund_preview");
      setRefundConfirmation({ returnId, action, amountCents: preview.amountCents });
    } catch (e) {
      if (currentMerchant.current !== merchantId) return;
      reportError({ source: "returns.acceptReturn", error: e });
      if (String(e instanceof Error ? e.message : e).includes("marketplace_refund_journal_required")) {
        window.location.hash = "marketplace-refunds";
        showToast("success", "Prepare o estorno deste pedido na área de Marketplace.");
      } else showToast("error", "Não foi possível conferir o estorno. Consulte os dados do pedido.");
    } finally { if (currentMerchant.current === merchantId) setActing(null); }
  }, [api, merchantId, submitRefund]);
  const acceptReturn = useCallback((returnId: string) => requestRefund(returnId, "accept"), [requestRefund]);
  const processRefund = useCallback((returnId: string) => requestRefund(returnId, "refund"), [requestRefund]);
  const confirmRefund = useCallback(() => {
    if (refundConfirmation) void submitRefund(refundConfirmation.returnId, refundConfirmation.action);
  }, [refundConfirmation, submitRefund]);

  const stats = {
    total: returns.length,
    inTransit: returns.filter((r) => r.status === "SHIPPED" || r.status === "LABEL_GENERATED").length,
    awaitingInspection: returns.filter((r) => r.status === "RECEIVED").length,
    refunded: returns.filter((r) => r.status === "REFUND_COMPLETED").length,
  };

  return { returns, loading, acting, stats, generateLabel, markReceived, inspectReturn, processRefund, acceptReturn, refresh: load,
    reverseShipping, openReverseShipping, prepareReverseShipping, confirmReverseShipping, closeReverseShipping: () => setReverseShipping(null),
    refundConfirmation, confirmRefund, dismissRefundConfirmation: () => setRefundConfirmation(null) };
}
