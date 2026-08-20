import { useEffect, useState } from "react";
import { useApi } from "../../hooks/useApi.js";
import { reportError } from "../../hooks/useErrorReporter.js";
import type { CartRecoveryMetrics, CartRecoveryAttempt } from "../../api/endpoints/cart-recovery.js";

const MOCK_METRICS: CartRecoveryMetrics = {
  total_abandoned: 2847,
  total_attempts: 1923,
  total_recovered: 486,
  recovery_rate_percent: 25.3,
  revenue_recovered_brl: 38427,
};

const MOCK_ATTEMPTS: CartRecoveryAttempt[] = [
  {
    id: "att-001",
    session_id: "sess-12345",
    strategy: "free_shipping",
    status: "recovered",
    created_at: "2026-08-20T14:22:00Z",
  },
  {
    id: "att-002",
    session_id: "sess-12346",
    strategy: "escalate_discount",
    status: "sent",
    created_at: "2026-08-20T13:55:00Z",
  },
  {
    id: "att-003",
    session_id: "sess-12347",
    strategy: "cross_sell",
    status: "failed",
    created_at: "2026-08-20T12:30:00Z",
  },
  {
    id: "att-004",
    session_id: "sess-12348",
    strategy: "address_objection",
    status: "recovered",
    created_at: "2026-08-20T11:15:00Z",
  },
  {
    id: "att-005",
    session_id: "sess-12349",
    strategy: "wait",
    status: "pending",
    created_at: "2026-08-20T10:00:00Z",
  },
];

export function useCartRecoveryPage() {
  const api = useApi();
  const [metrics, setMetrics] = useState<CartRecoveryMetrics | null>(null);
  const [attempts, setAttempts] = useState<CartRecoveryAttempt[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const [metData, attData] = await Promise.all([
          api.getCartRecoveryMetrics?.().catch(() => null),
          api.getCartRecoveryAttempts?.().catch(() => null),
        ]);
        if (cancelled) return;
        setMetrics(metData ?? MOCK_METRICS);
        setAttempts(attData ?? MOCK_ATTEMPTS);
      } catch (e) {
        reportError({ source: "cart-recovery.load", error: e });
        if (!cancelled) {
          setMetrics(MOCK_METRICS);
          setAttempts(MOCK_ATTEMPTS);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return { metrics, attempts, loading };
}
