import { useEffect, useState, useCallback } from "react";
import { useApi } from "../../hooks/useApi.js";
import { showToast } from "../../components/Toast.js";
import { reportError } from "../../hooks/useErrorReporter.js";
import type { MerchantProfile } from "../../api-client.js";
import type { Hypothesis, DailyObservation, StrategyLesson } from "../../api/endpoints/revenue-manager.js";

export function useRevenueManagerPage(me: MerchantProfile | null) {
  const api = useApi();
  const [hypotheses, setHypotheses] = useState<Hypothesis[]>([]);
  const [observations, setObservations] = useState<DailyObservation[]>([]);
  const [lessons, setLessons] = useState<StrategyLesson[]>([]);
  const [loading, setLoading] = useState(true);
  const [approving, setApproving] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [hData, oData, lData] = await Promise.all([
        api.getHypotheses?.().catch(() => null),
        api.getObservations?.().catch(() => null),
        api.getStrategyLessons?.().catch(() => null),
      ]);
      setHypotheses(hData ?? []);
      setObservations(oData ?? []);
      setLessons(lData ?? []);
    } catch (e) {
      reportError({ source: "revenue-manager.load", error: e });
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => { void load(); }, [load]);

  const approveHypothesis = async (id: string) => {
    setApproving(prev => new Set([...prev, id]));
    try {
      await api.approveHypothesis?.(id, { approved_by: me?.id ?? "merchant" });
      setHypotheses(prev => prev.map(h => h.id === id ? { ...h, status: "approved" as const } : h));
      showToast("success", "Hipótese aprovada — experimento será criado automaticamente");
    } catch (e) {
      reportError({ source: "revenue-manager.approve", error: e });
      showToast("error", e instanceof Error ? e.message : "Erro ao aprovar");
    } finally {
      setApproving(prev => { const next = new Set(prev); next.delete(id); return next; });
    }
  };

  const rejectHypothesis = async (id: string, reason: string) => {
    setApproving(prev => new Set([...prev, id]));
    try {
      await api.rejectHypothesis?.(id, { reason });
      setHypotheses(prev => prev.map(h => h.id === id ? { ...h, status: "rejected" as const } : h));
      showToast("success", "Hipótese rejeitada");
    } catch (e) {
      reportError({ source: "revenue-manager.reject", error: e });
      showToast("error", e instanceof Error ? e.message : "Erro ao rejeitar");
    } finally {
      setApproving(prev => { const next = new Set(prev); next.delete(id); return next; });
    }
  };

  return { hypotheses, observations, lessons, loading, approving, approveHypothesis, rejectHypothesis, refresh: load };
}
