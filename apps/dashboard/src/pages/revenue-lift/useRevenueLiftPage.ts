import { useEffect, useState, useCallback, useRef } from "react";
import { useApi } from "../../hooks/useApi.js";
import { reportError } from "../../hooks/useErrorReporter.js";
import type {
  RevenueLiftSummary,
  RevenueLiftTrendResponse,
} from "../../api/endpoints/revenue-lift.js";

export function useRevenueLiftPage() {
  const api = useApi();
  const [summary, setSummary] = useState<RevenueLiftSummary | null>(null);
  const [trend, setTrend] = useState<RevenueLiftTrendResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(""),
    [trendError, setTrendError] = useState("");
  const [periodDays, setPeriodDays] = useState(30);
  const reading = useRef(0);
  const load = useCallback(async () => {
    const request = ++reading.current;
    setLoading(true);
    setError("");
    setTrendError("");
    setSummary(null);
    setTrend(null);
    const [s, t] = await Promise.allSettled([
      api.getRevenueLift(periodDays),
      api.getRevenueLiftTrend(periodDays),
    ]);
    if (request !== reading.current) return;
    if (s.status === "fulfilled") setSummary(s.value);
    else {
      reportError({ source: "revenue-lift.summary", error: s.reason });
      setError("Não foi possível consultar os resultados deste período.");
    }
    if (t.status === "fulfilled") setTrend(t.value);
    else {
      reportError({ source: "revenue-lift.trend", error: t.reason });
      setTrendError(
        "Não foi possível carregar a evolução diária. O resumo disponível foi preservado."
      );
    }
    setLoading(false);
  }, [api, periodDays]);
  useEffect(() => {
    void load();
    return () => {
      reading.current++;
    };
  }, [load]);
  return {
    summary,
    trend,
    loading,
    error,
    trendError,
    periodDays,
    setPeriodDays,
    refresh: load,
  };
}
