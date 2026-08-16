import { useEffect, useState, useRef, useCallback } from "react";

// ── Types ────────────────────────────────────────────────────────────────────

export type FunnelPeriod = "today" | "7d" | "30d" | "90d";

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

export interface FunnelData {
  steps: FunnelStep[];
  transitions: FunnelTransition[];
  bottleneck: FunnelBottleneck | null;
  period: { from: string; to: string };
  totalSessions: number;
  overallConversion: number;
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
  data: FunnelData | null;
  sessions: FunnelSession[];
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

// ── Hook ─────────────────────────────────────────────────────────────────────

export function useFunnelPage(props: {
  apiBaseUrl: string;
  merchantId: string;
}): FunnelPageVM {
  const { apiBaseUrl, merchantId } = props;

  const [period, setPeriod] = useState<FunnelPeriod>("7d");
  const [data, setData] = useState<FunnelData | null>(null);
  const [sessions, setSessions] = useState<FunnelSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const sessionsTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchFunnel = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `${apiBaseUrl}/checkout/funnel/${merchantId}?period=${period}`,
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
  }, [apiBaseUrl, merchantId, period]);

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

  return { period, setPeriod, data, sessions, loading, error, refresh };
}
