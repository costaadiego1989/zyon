import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AuditEvent, MerchantProfile } from "../api-client.js";
import { useApi } from "../hooks/useApi.js";
import { readError } from "../utils/read-error.js";
import { downloadCsv } from "../hooks/useCsvExport.js";

// ── Types ──────────────────────────────────────────────────────────────────

export interface AuditFilters {
  dateRange: "7d" | "30d" | "90d" | "all";
  actionCategory: "destructive" | "constructive" | "update" | "all";
  actorType: "human" | "service" | "all";
}

// ── Pure utils (exported for testability) ──────────────────────────────────

export function actionBadgeCategory(action: string, metadata?: Record<string, unknown> | null): "destructive" | "constructive" | "update" | "other" {
  // Older events retain HTTP actions. Classify only known collection creates;
  // POST commands such as checkout, preview, start or archive are not creates.
  if (/^http\.(put|patch)$/i.test(action)) return "update";
  if (/^http\.post$/i.test(action)) {
    const path = typeof metadata?.path === "string" ? metadata.path.replace(/\/+$/, "") : "";
    if (/(?:^|\/)(?:api-keys|experiments|coupons|products|categories|banners|faqs)$/.test(path)) return "constructive";
    return "other";
  }
  if (/delete|remove|revoke|disable/i.test(action)) return "destructive";
  if (/create|add|enable|approve/i.test(action)) return "constructive";
  if (/update|edit|change|modify/i.test(action)) return "update";
  return "other";
}

export function actionBadgeClass(action: string, metadata?: Record<string, unknown> | null): string {
  const cat = actionBadgeCategory(action, metadata);
  switch (cat) {
    case "destructive": return "badge bad";
    case "constructive": return "badge ok";
    case "update": return "badge warn";
    default: return "badge muted";
  }
}

export function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "agora";
  if (minutes < 60) return `há ${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `há ${hours}h`;
  const days = Math.floor(hours / 24);
  return `há ${days}d`;
}

export function formatAbsoluteTime(iso: string): string {
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(
    new Date(iso),
  );
}

function dateRangeToSince(range: AuditFilters["dateRange"]): string | undefined {
  if (range === "all") return undefined;
  const days = { "7d": 7, "30d": 30, "90d": 90 }[range];
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

export function filterEvents(events: AuditEvent[], filters: AuditFilters): AuditEvent[] {
  return events.filter(evt => {
    if (filters.actionCategory !== "all") {
      if (actionBadgeCategory(evt.action, evt.metadata) !== filters.actionCategory) return false;
    }
    if (filters.actorType !== "all" && evt.actor_type !== filters.actorType) return false;
    return true;
  });
}

// ── ViewModel Hook ─────────────────────────────────────────────────────────

export function useAuditLogPage(props: { me: MerchantProfile | null }) {
  const api = useApi();
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const requestVersion = useRef(0);
  const moreWorking = useRef(false);
  const [moreError, setMoreError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<AuditFilters>({
    dateRange: "all",
    actionCategory: "all",
    actorType: "all",
  });
  const [expandedRowId, setExpandedRowId] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const pageSize = 20;

  // Filtered events (actionCategory + actorType are client-side; dateRange goes to API)
  const filteredEvents = useMemo(() => filterEvents(events, filters), [events, filters]);
  const totalFiltered = filteredEvents.length;
  const pagedEvents = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filteredEvents.slice(start, start + pageSize);
  }, [filteredEvents, page]);

  const load = useCallback(async () => {
    const version = ++requestVersion.current;
    moreWorking.current = false;
    setLoadingMore(false);
    setMoreError(null);
    setPage(1);
    setLoading(true);
    setError(null);
    setEvents([]);
    setNextCursor(null);
    setHasMore(false);
    try {
      const page = await api.getAuditEvents({
        limit: 50,
        since: dateRangeToSince(filters.dateRange),
      });
      if (version !== requestVersion.current) return;
      const items = Array.isArray(page?.data) ? page.data : Array.isArray(page) ? page as unknown as AuditEvent[] : [];
      setEvents(items);
      setNextCursor(page?.next_cursor ?? null);
      setHasMore(page?.has_more ?? false);
    } catch (e) {
      if (version === requestVersion.current) setError(readError(e));
    } finally {
      if (version === requestVersion.current) setLoading(false);
    }
  }, [api, filters.dateRange]);

  const loadMore = useCallback(async () => {
    if (!nextCursor || moreWorking.current || loading) return;
    const version = requestVersion.current;
    moreWorking.current = true;
    setMoreError(null);
    setLoadingMore(true);
    try {
      const page = await api.getAuditEvents({
        limit: 50,
        cursor: nextCursor,
        since: dateRangeToSince(filters.dateRange),
      });
      const items = Array.isArray(page?.data) ? page.data : Array.isArray(page) ? page as unknown as AuditEvent[] : [];
      if (version !== requestVersion.current) return;
      setEvents(prev => [...prev, ...items.filter(item => !prev.some(existing => existing.id === item.id))]);
      setNextCursor(page?.next_cursor ?? null);
      setHasMore(page?.has_more ?? false);
    } catch (e) {
      if (version === requestVersion.current) setMoreError(readError(e));
    } finally {
      if (version === requestVersion.current) { moreWorking.current = false; setLoadingMore(false); }
    }
  }, [api, nextCursor, loading, filters.dateRange]);

  const exportCsv = useCallback(() => {
    const header = "Data,Tipo Ator,Ator,Ação,Recurso,ID Recurso,Resultado,IP,ID Correlação";
    const rows = filteredEvents.map(e =>
      [e.occurred_at, e.actor_type, e.actor_id ?? "", e.action,
       e.resource_type, e.resource_id ?? "", e.outcome ?? "success",
       e.ip_address ?? "", e.correlation_id ?? ""].join(",")
    );
    downloadCsv(header, rows, `auditoria-${new Date().toISOString().slice(0, 10)}.csv`);
  }, [filteredEvents]);

  const toggleExpand = useCallback((id: string) => {
    setExpandedRowId(prev => prev === id ? null : id);
  }, []);

  // Auto-load on mount or when me/dateRange changes
  useEffect(() => {
    if (!props.me) {
      setEvents([]);
      return;
    }
    void load();
  }, [props.me, filters.dateRange]); // eslint-disable-line react-hooks/exhaustive-deps

  // Reset page when filters change
  useEffect(() => { setPage(1); }, [filters]);

  return {
    events,
    filteredEvents,
    pagedEvents,
    page,
    pageSize,
    totalFiltered,
    setPage,
    loading,
    loadingMore,
    hasMore,
    error,
    moreError,
    filters,
    setFilters,
    expandedRowId,
    load,
    loadMore,
    exportCsv,
    toggleExpand,
  };
}
