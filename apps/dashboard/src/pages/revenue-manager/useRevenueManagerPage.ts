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
  const [engineEnabled, setEngineEnabled] = useState<boolean>(true);
  const [engineSaving, setEngineSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [hData, oData, lData, rules] = await Promise.all([
        api.getHypotheses?.().catch(() => null),
        api.getObservations?.().catch(() => null),
        api.getStrategyLessons?.().catch(() => null),
        api.getMerchantRules?.().catch(() => null),
      ]);
      setHypotheses(hData ?? []);
      setObservations(oData ?? []);
      setLessons(lData ?? []);
      if (rules && typeof rules.autonomousEngineEnabled === "boolean") {
        setEngineEnabled(rules.autonomousEngineEnabled);
      }
    } catch (e) {
      reportError({ source: "revenue-manager.load", error: e });
    } finally {
      setLoading(false);
    }
  }, [api]);

  // Kill-switch: enable/disable the autonomous engine (persists to MerchantRules).
  const toggleEngine = async () => {
    const next = !engineEnabled;
    setEngineEnabled(next); // optimistic
    setEngineSaving(true);
    try {
      await api.putMerchantRules?.({ autonomousEngineEnabled: next });
      showToast("success", next ? "Motor autônomo ativado" : "Motor autônomo desativado");
    } catch (e) {
      setEngineEnabled(!next); // revert on failure
      reportError({ source: "revenue-manager.toggle-engine", error: e });
      showToast("error", "Erro ao alterar o motor autônomo");
    } finally {
      setEngineSaving(false);
    }
  };

  useEffect(() => { void load(); }, [load]);

  const approveHypothesis = async (id: string) => {
    setApproving(prev => new Set([...prev, id]));
    try {
      await api.approveHypothesis?.(id, { approved_by: me?.id ?? "merchant", mode: "test_ab" });
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

  return { hypotheses, observations, lessons, loading, approving, approveHypothesis, rejectHypothesis, refresh: load, engineEnabled, engineSaving, toggleEngine };
}
