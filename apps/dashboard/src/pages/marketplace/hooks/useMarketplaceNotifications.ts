import { useCallback, useEffect, useRef, useState } from "react";
import { useApi } from "../../hooks/useApi.js";
import type { NotificationItem } from "../../components/NotificationBell.js";

export type MarketplaceEventType =
  | "settlement_transferred"
  | "settlement_finalized"
  | "chargeback_received"
  | "chargeback_debt_created"
  | "return_cancelled";

interface MarketplaceEvent {
  id: string;
  type: MarketplaceEventType;
  settlementId: string;
  amountCents: number;
  createdAt: string;
}

const EVENT_TITLES: Record<MarketplaceEventType, string> = {
  settlement_transferred: "Repasse executado",
  settlement_finalized: "Settlement finalizado",
  chargeback_received: "Chargeback recebido",
  chargeback_debt_created: "Débito criado por chargeback",
  return_cancelled: "Devolução cancelou repasse",
};

const POLL_INTERVAL_MS = 15_000; // 15s

/**
 * Polls marketplace events and converts them to NotificationItems
 * for the NotificationBell component.
 */
export function useMarketplaceNotifications(enabled: boolean) {
  const api = useApi();
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const lastSeenRef = useRef<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const poll = useCallback(async () => {
    if (!enabled) return;
    try {
      const since = lastSeenRef.current ?? new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const res = await (api as any).getMarketplaceEvents?.({ since });
      if (!res || !Array.isArray(res.events)) return;

      const events: MarketplaceEvent[] = res.events;
      if (events.length === 0) return;

      // Track last seen
      lastSeenRef.current = events[0].createdAt;

      // Convert to NotificationItem (dedupe by id)
      const existing = new Set(notifications.map((n) => n.id));
      const newItems: NotificationItem[] = events
        .filter((e) => !existing.has(e.id))
        .map((e) => ({
          id: e.id,
          type: "message" as const,
          title: `${EVENT_TITLES[e.type] ?? e.type} — R$ ${(e.amountCents / 100).toFixed(2)}`,
          createdAt: e.createdAt,
        }));

      if (newItems.length > 0) {
        setNotifications((prev) => [...newItems, ...prev].slice(0, 50));
      }
    } catch {
      // Endpoint may not exist yet — silently continue
    }
  }, [api, enabled, notifications]);

  useEffect(() => {
    if (!enabled) return;

    // Initial poll
    void poll();

    // Setup interval
    intervalRef.current = setInterval(() => {
      void poll();
    }, POLL_INTERVAL_MS);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [enabled]); // eslint-disable-line react-hooks/exhaustive-deps

  function clearNotifications() {
    setNotifications([]);
  }

  return {
    notifications,
    clearNotifications,
  };
}
