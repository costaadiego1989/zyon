import { useEffect, useState } from "react";
import { useApi } from "../../hooks/useApi.js";
import { showToast } from "../../components/Toast.js";
import { reportError } from "../../hooks/useErrorReporter.js";
import type { MerchantProfile } from "../../api-client.js";
import type { Hypothesis, DailyObservation, StrategyLesson } from "../../api/endpoints/revenue-manager.js";

const MOCK_HYPOTHESES: Hypothesis[] = [
  {
    id: "hyp-1",
    hypothesis_text: "Descontos escalonados por valor de carrinho aumentam taxa de conversão",
    expected_lift_percent: 12.5,
    risk_level: "low",
    status: "pending_review",
    created_at: "2026-08-18T14:30:00Z",
  },
  {
    id: "hyp-2",
    hypothesis_text: "Cross-sell de frete express aumenta AOV em checkout",
    expected_lift_percent: 8.3,
    risk_level: "medium",
    status: "approved",
    created_at: "2026-08-17T09:15:00Z",
  },
  {
    id: "hyp-3",
    hypothesis_text: "Urgência contextual com timer reduz abandono",
    expected_lift_percent: 15.8,
    risk_level: "high",
    status: "pending_review",
    created_at: "2026-08-16T11:20:00Z",
  },
];

const MOCK_OBSERVATIONS: DailyObservation[] = [
  { date: "2026-08-20", conversion_rate: 4.2, top_objection: "Valor do frete", sessions_count: 3421 },
  { date: "2026-08-19", conversion_rate: 3.8, top_objection: "Prazo de entrega", sessions_count: 3158 },
  { date: "2026-08-18", conversion_rate: 4.1, top_objection: "Segurança do pagamento", sessions_count: 3502 },
];

const MOCK_LESSONS: StrategyLesson[] = [
  {
    experiment_id: "exp-001",
    actual_winner: "Desconto progressivo",
    lift_percent: 14.2,
    lesson: "Descontos maiores incrementalmente melhores que fixos",
    learned_at: "2026-08-15T18:00:00Z",
  },
];

export function useRevenueManagerPage(me: MerchantProfile | null) {
  const api = useApi();
  const [hypotheses, setHypotheses] = useState<Hypothesis[]>([]);
  const [observations, setObservations] = useState<DailyObservation[]>([]);
  const [lessons, setLessons] = useState<StrategyLesson[]>([]);
  const [loading, setLoading] = useState(true);
  const [approving, setApproving] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const [hData, oData, lData] = await Promise.all([
          api.getHypotheses?.().catch(() => null),
          api.getObservations?.().catch(() => null),
          api.getStrategyLessons?.().catch(() => null),
        ]);
        if (cancelled) return;
        setHypotheses(hData ?? MOCK_HYPOTHESES);
        setObservations(oData ?? MOCK_OBSERVATIONS);
        setLessons(lData ?? MOCK_LESSONS);
      } catch (e) {
        reportError({ source: "revenue-manager.load", error: e });
        if (!cancelled) {
          setHypotheses(MOCK_HYPOTHESES);
          setObservations(MOCK_OBSERVATIONS);
          setLessons(MOCK_LESSONS);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const approveHypothesis = async (id: string) => {
    setApproving(prev => new Set([...prev, id]));
    try {
      await api.approveHypothesis?.(id, { approved_by: me?.id ?? "merchant" });
      setHypotheses(prev => prev.map(h => h.id === id ? { ...h, status: "approved" as const } : h));
      showToast("success", "Hipótese aprovada");
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

  return { hypotheses, observations, lessons, loading, approving, approveHypothesis, rejectHypothesis };
}
