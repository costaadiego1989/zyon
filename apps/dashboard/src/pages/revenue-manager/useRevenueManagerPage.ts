import { STRATEGY_CHANGED_EVENT } from "./strategy-review.js";
import { useEffect, useState, useCallback, useRef } from "react";
import { useApi } from "../../hooks/useApi.js";
import { showToast } from "../../components/Toast.js";
import { reportError } from "../../hooks/useErrorReporter.js";
import type { MerchantProfile } from "../../api-client.js";
import type {
  Hypothesis,
  AnalysisStatus,
  DailyObservation,
  StrategyLesson,
} from "../../api/endpoints/revenue-manager.js";
export function useRevenueManagerPage(me: MerchantProfile | null) {
  const api = useApi();
  const [hypotheses, setHypotheses] = useState<Hypothesis[]>([]);
  const [observations, setObservations] = useState<DailyObservation[]>([]);
  const [lessons, setLessons] = useState<StrategyLesson[]>([]);
  const [analysisStatus, setAnalysisStatus] = useState<AnalysisStatus | null>(null);
  const [analysisStatusError, setAnalysisStatusError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [actionError, setActionError] = useState("");
  const [approving, setApproving] = useState<Set<string>>(new Set());
  const [engineEnabled, setEngineEnabled] = useState(false);
  const [hypothesesError, setHypothesesError] = useState(false);
  const [engineSaving, setEngineSaving] = useState(false);
  const refreshPending = useRef(false);
  const reading = useRef(0),
    working = useRef(false),
    decisions = useRef(new Set<string>());
  const load = useCallback(async () => {
    if (!me) return;
    if (working.current) { refreshPending.current = true; return; }
    const request = ++reading.current;
    setLoading(true);
    const results = await Promise.allSettled([
      api.getHypotheses(),
      api.getObservations(),
      api.getStrategyLessons(),
      api.getMerchantRules(),
    ]);
    if (request !== reading.current) return;
    const nextErrors: Record<string, string> = {};
    const [h, o, l, r] = results;
    setHypothesesError(h.status !== "fulfilled");
    if (h.status === "fulfilled") setHypotheses(h.value);
    else {
      setHypotheses([]);
      nextErrors.hypotheses = "Não foi possível consultar as sugestões.";
    }
    if (o.status === "fulfilled") setObservations(o.value);
    else {
      setObservations([]);
      nextErrors.observations = "Não foi possível consultar as observações.";
    }
    if (l.status === "fulfilled") setLessons(l.value);
    else {
      setLessons([]);
      nextErrors.lessons = "Não foi possível consultar os aprendizados.";
    }
    if (r.status === "fulfilled")
      setEngineEnabled(r.value.autonomousEngineEnabled !== false);
    else
      nextErrors.engine =
        "Não foi possível consultar a configuração de geração de sugestões.";
    results.forEach((result) => {
      if (result.status === "rejected")
        reportError({ source: "revenue-manager.load", error: result.reason });
    });
    setErrors(nextErrors);
    setLoading(false);
  }, [api, me?.id]);
  const toggleEngine = async () => {
    if (working.current || loading || errors.engine) return;
    working.current = true;
    setEngineSaving(true);
    setActionError("");
    try {
      const result = await api.putMerchantRules({
        autonomousEngineEnabled: !engineEnabled,
      });
      setEngineEnabled(result.autonomousEngineEnabled !== false);
      showToast("success", "Configuração de sugestões salva");
    } catch (error) {
      reportError({ source: "revenue-manager.toggle-engine", error });
      setActionError(
        "Não foi possível salvar. A configuração anterior foi mantida."
      );
    } finally {
      working.current = false;
      setEngineSaving(false);
      if (refreshPending.current) { refreshPending.current = false; void load(); }
    }
  };
  useEffect(() => {
    let active = true;
    const refreshStatus = async () => {
      try {
        const status = await api.getAnalysisStatus();
        if (active) { setAnalysisStatus(status); setAnalysisStatusError(false); }
      } catch { if (active) setAnalysisStatusError(true); }
    };
    void refreshStatus();
    const timer = window.setInterval(() => { void refreshStatus(); }, 30_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [api]);

  useEffect(() => {
    void load();
    const reload = () => {
      void load();
    };
    window.addEventListener(STRATEGY_CHANGED_EVENT, reload);
    return () => {
      refreshPending.current = false;
      reading.current++;
      window.removeEventListener(STRATEGY_CHANGED_EVENT, reload);
    };
  }, [load]);
  const rejectHypothesis = async (id: string, reason: string) => {
    if (decisions.current.has(id)) return;
    decisions.current.add(id);
    setApproving(new Set(decisions.current));
    setActionError("");
    try {
      await api.rejectHypothesis(id, { reason });
      setHypotheses((prev) =>
        prev.map((h) => (h.id === id ? { ...h, status: "rejected" } : h))
      );
      showToast("success", "Sugestão recusada");
    } catch (error) {
      reportError({ source: "revenue-manager.reject", error });
      setActionError(
        "Não foi possível recusar a sugestão. Atualize a lista para conferir o estado antes de tentar novamente."
      );
    } finally {
      decisions.current.delete(id);
      setApproving(new Set(decisions.current));
    }
  };
  return {
    hypotheses,
    analysisStatus,
    analysisStatusError,
    hypothesesError,
    observations,
    lessons,
    loading,
    errors,
    actionError,
    approving,
    rejectHypothesis,
    refresh: load,
    engineEnabled,
    engineSaving,
    toggleEngine,
  };
}
