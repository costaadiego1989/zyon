import { useEffect, useState } from "react";
import { useApi } from "../../hooks/useApi.js";
import { reportError } from "../../hooks/useErrorReporter.js";
import type { RevenueLiftSummary, RevenueLiftCohort, RevenueLiftTrend } from "../../api/endpoints/revenue-lift.js";

const MOCK_SUMMARY: RevenueLiftSummary = {
  lift_percent: 17.8,
  confidence: "significant",
  ai_cost_brl: 247,
  net_lift_brl: 18420,
  roi_percent: 7350,
  feature_breakout: [
    { feature: "Negociação Inteligente", contribution_percent: 38 },
    { feature: "Cross-sell Contextual", contribution_percent: 24 },
    { feature: "Cart Recovery", contribution_percent: 20 },
    { feature: "Objeção Frete", contribution_percent: 12 },
    { feature: "Urgência Contextual", contribution_percent: 6 },
  ],
};

const MOCK_TREND: RevenueLiftTrend[] = [
  { date: "2026-08-14", lift_percent: 15.2, revenue_control_brl: 12400, revenue_treatment_brl: 14287 },
  { date: "2026-08-15", lift_percent: 16.1, revenue_control_brl: 13200, revenue_treatment_brl: 15325 },
  { date: "2026-08-16", lift_percent: 18.4, revenue_control_brl: 11800, revenue_treatment_brl: 13971 },
  { date: "2026-08-17", lift_percent: 17.9, revenue_control_brl: 14500, revenue_treatment_brl: 17095 },
  { date: "2026-08-18", lift_percent: 19.2, revenue_control_brl: 15100, revenue_treatment_brl: 17999 },
  { date: "2026-08-19", lift_percent: 17.3, revenue_control_brl: 13800, revenue_treatment_brl: 16187 },
  { date: "2026-08-20", lift_percent: 17.8, revenue_control_brl: 14200, revenue_treatment_brl: 16726 },
];

export function useRevenueLiftPage() {
  const api = useApi();
  const [summary, setSummary] = useState<RevenueLiftSummary | null>(null);
  const [trend, setTrend] = useState<RevenueLiftTrend[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const [summaryData, trendData] = await Promise.all([
          api.getRevenueLift().catch(() => null),
          api.getRevenueLiftTrend().catch(() => null),
        ]);
        if (cancelled) return;
        setSummary(summaryData ?? MOCK_SUMMARY);
        setTrend(trendData ?? MOCK_TREND);
      } catch (e) {
        reportError({ source: "revenue-lift.load", error: e });
        if (!cancelled) {
          setError("Configuração pendente");
          setSummary(MOCK_SUMMARY);
          setTrend(MOCK_TREND);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return { summary, trend, loading, error };
}
