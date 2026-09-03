import { useCallback, useEffect, useRef, useState } from "react";
import { dashboardFetch } from "../api/http/client.js";
import { resolveDashboardApiBaseUrl } from "../api-client.js";

export interface NavCounts {
  orders: number;
  messages: number;
  cartRecovery: number;
}

export type NavBadgeKey = "orders" | "messages" | "cart-recovery";

const API_BASE_URL = resolveDashboardApiBaseUrl(import.meta.env);

const countField: Record<NavBadgeKey, keyof NavCounts> = {
  orders: "orders",
  messages: "messages",
  "cart-recovery": "cartRecovery",
};

export interface UseNavCounts {
  counts: NavCounts;
  /** Mark a section as viewed: optimistically zeroes its badge, then persists. */
  markViewed: (badgeKey: NavBadgeKey) => void;
}

/**
 * Poll unread-only nav badge counts from /dashboard/nav-counts.
 * Polls every 60s, refetches on window focus.
 * markViewed(key) dismisses a badge (optimistic + server persist) so counts
 * reflect only items unseen since the merchant last opened that section.
 * Graceful fallback: zeros on error, nav still renders.
 */
export function useNavCounts(): UseNavCounts {
  const [counts, setCounts] = useState<NavCounts>({ orders: 0, messages: 0, cartRecovery: 0 });
  const stoppedRef = useRef(false);

  const fetchCounts = useCallback(async () => {
    try {
      const res = await dashboardFetch(API_BASE_URL, "/dashboard/nav-counts");
      if (res.ok) {
        const data = await res.json();
        if (!stoppedRef.current) setCounts(data);
      }
    } catch {
      // Silent fail, keep current counts
    }
  }, []);

  const markViewed = useCallback((badgeKey: NavBadgeKey) => {
    // Optimistic: zero the badge immediately for snappy UX
    setCounts((prev) => ({ ...prev, [countField[badgeKey]]: 0 }));
    // Persist (best-effort — server also swallows failures)
    void dashboardFetch(API_BASE_URL, `/dashboard/nav-counts/${badgeKey}/viewed`, {
      method: "POST",
    }).catch(() => {
      // On failure, next poll will restore the true count
    });
  }, []);

  useEffect(() => {
    stoppedRef.current = false;

    void fetchCounts();
    const timer = setInterval(() => {
      if (!stoppedRef.current) void fetchCounts();
    }, 60_000);

    const handleFocus = () => {
      if (!stoppedRef.current) void fetchCounts();
    };
    window.addEventListener("focus", handleFocus);

    return () => {
      stoppedRef.current = true;
      clearInterval(timer);
      window.removeEventListener("focus", handleFocus);
    };
  }, [fetchCounts]);

  return { counts, markViewed };
}
