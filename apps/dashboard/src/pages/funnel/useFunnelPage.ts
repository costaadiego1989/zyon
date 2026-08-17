import { useEffect, useState, useRef, useCallback } from "react";

// ── Types ────────────────────────────────────────────────────────────────────

export type FunnelPeriod = "today" | "7d" | "30d" | "90d";
export type FunnelBreakdownDimension = "none" | "device" | "buyer_type" | "payment_method";

export interface FunnelStep {
  name: string;
  label: string;
  count: number;
  percentage: number;
}

export interface FunnelTransition {
  from: string;
  to: string;
  rate: number;
  dropOff: number;
  avgTimeSeconds: number;
}

export interface FunnelBottleneck {
  step: string;
  dropOff: number;
  suggestion: string;
}

export interface FunnelSegment {
  steps: FunnelStep[];
  overallConversion: number;
}

export interface FunnelPreviousPeriod {
  steps: FunnelStep[];
  overallConversion: number;
  totalSessions: number;
}

export interface FunnelData {
  steps: FunnelStep[];
  transitions: FunnelTransition[];
  bottleneck: FunnelBottleneck | null;
  period: { from: string; to: string };
  totalSessions: number;
  overallConversion: number;
  breakdowns?: Record<string, FunnelSegment>;
  previous?: FunnelPreviousPeriod;
}

export interface FunnelSession {
  sessionId: string;
  buyerPhone: string;
  buyerEmail: string;
  buyerName: string;
  stage: "data_collection" | "shipping" | "payment" | "completed";
  lastActivityAt: string;
  abandonmentScore: number;
}

export interface FunnelSessionsResponse {
  sessions: FunnelSession[];
  total: number;
  status: "active" | "all";
}

export interface FunnelPageVM {
  period: FunnelPeriod;
  setPeriod: (p: FunnelPeriod) => void;
  breakdown: FunnelBreakdownDimension;
  setBreakdown: (b: FunnelBreakdownDimension) => void;
  compareEnabled: boolean;
  setCompareEnabled: (v: boolean) => void;
  data: FunnelData | null;
  sessions: FunnelSession[];
  loading: boolean;
  error: string | null;
  refresh: () => void;
  exportCsv: () => void;
}

// ── Hook ─────────────────────────────────────────────────────────────────────

export function useFunnelPage(props: {
  apiBaseUrl: string;
  merchantId: string;
  merchantName?: string;
}): FunnelPageVM {
  const { apiBaseUrl, merchantId, merchantName } = props;

  const [period, setPeriod] = useState<FunnelPeriod>("7d");
  const [breakdown, setBreakdown] = useState<FunnelBreakdownDimension>("none");
  const [compareEnabled, setCompareEnabled] = useState(false);
  const [data, setData] = useState<FunnelData | null>(null);
  const [sessions, setSessions] = useState<FunnelSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const sessionsTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchFunnel = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ period });
      if (breakdown !== "none") params.set("breakdown", breakdown);
      if (compareEnabled) params.set("compare", "true");

      const res = await fetch(
        `${apiBaseUrl}/checkout/funnel/${merchantId}?${params.toString()}`,
        { credentials: "include" },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json: FunnelData = await res.json();
      setData(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [apiBaseUrl, merchantId, period, breakdown, compareEnabled]);

  const fetchSessions = useCallback(async () => {
    try {
      const res = await fetch(
        `${apiBaseUrl}/checkout/funnel/${merchantId}/sessions`,
        { credentials: "include" },
      );
      if (!res.ok) return;
      const json: FunnelSessionsResponse = await res.json();
      setSessions(json.sessions);
    } catch {
      // non-blocking; sessions are supplementary
    }
  }, [apiBaseUrl, merchantId]);

  useEffect(() => {
    void fetchFunnel();
  }, [fetchFunnel]);

  useEffect(() => {
    void fetchSessions();
    sessionsTimer.current = setInterval(() => void fetchSessions(), 30_000);
    return () => {
      if (sessionsTimer.current) clearInterval(sessionsTimer.current);
    };
  }, [fetchSessions]);

  const refresh = useCallback(() => {
    void fetchFunnel();
    void fetchSessions();
  }, [fetchFunnel, fetchSessions]);

  const exportCsv = useCallback(() => {
    if (!data) return;
    const rows = data.steps.map((step, i) => {
      const transition = data.transitions.find(t => t.from === step.name);
      const dropOffPct = transition ? (transition.dropOff * 100).toFixed(1) : "0.0";
      const avgTime = transition ? String(transition.avgTimeSeconds) : "0";
      return `${step.label},${step.count},${step.percentage.toFixed(1)},${dropOffPct},${avgTime}`;
    });

    const header = "Etapa,Sessões,Conversão (%),Drop-off (%),Tempo médio (s)";
    const csv = [header, ...rows].join("\n");
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const date = new Date().toISOString().slice(0, 10);
    const name = merchantName ?? merchantId;
    const a = document.createElement("a");
    a.href = url;
    a.download = `funil-${name}-${period}-${date}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [data, period, merchantId, merchantName]);

  return {
    period,
    setPeriod,
    breakdown,
    setBreakdown,
    compareEnabled,
    setCompareEnabled,
    data,
    sessions,
    loading,
    error,
    refresh,
    exportCsv,
  };
}
