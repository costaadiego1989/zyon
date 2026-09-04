import { useEffect, useState, useCallback } from "react";
import { useApi } from "../../hooks/useApi.js";
import { reportError } from "../../hooks/useErrorReporter.js";
import type { RevenueLiftSummary, RevenueLiftTrendResponse } from "../../api/endpoints/revenue-lift.js";

export function useRevenueLiftPage() {
  const api = useApi();
  const [summary, setSummary] = useState<RevenueLiftSummary | null>(null);
  const [trend, setTrend] = useState<RevenueLiftTrendResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [periodDays, setPeriodDays] = useState(30);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [s, t] = await Promise.all([
        api.getRevenueLift(periodDays),
        api.getRevenueLiftTrend(periodDays),
      ]);
      setSummary(s);
      setTrend(t);
    } catch (e) {
      reportError({ source: "revenue-lift.load", error: e });
    } finally {
      setLoading(false);
    }
  }, [api, periodDays]);

  useEffect(() => { void load(); }, [load]);

  return { summary, trend, loading, periodDays, setPeriodDays, refresh: load };
}
