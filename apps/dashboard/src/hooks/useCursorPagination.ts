import { useState, useCallback } from "react";
import type { CursorPage } from "../api-client.js";

export interface CursorPaginationState<T> {
  items: T[];
  nextCursor: string | null;
  hasMore: boolean;
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
  load: () => Promise<void>;
  loadMore: () => Promise<void>;
}

/**
 * Shared hook for cursor-based pagination.
 * Eliminates duplicated load/loadMore/state pattern across audit-log, customers, orders pages.
 */
export function useCursorPagination<T>(
  fetcher: (cursor?: string) => Promise<CursorPage<T>>
): CursorPaginationState<T> {
  const [items, setItems] = useState<T[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setItems([]);
    setNextCursor(null);
    setHasMore(false);
    try {
      const page = await fetcher();
      const data = Array.isArray(page?.data) ? page.data : [];
      setItems(data);
      setNextCursor(page?.next_cursor ?? null);
      setHasMore(page?.has_more ?? false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [fetcher]);

  const loadMore = useCallback(async () => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await fetcher(nextCursor);
      const data = Array.isArray(page?.data) ? page.data : [];
      setItems(prev => [...prev, ...data]);
      setNextCursor(page?.next_cursor ?? null);
      setHasMore(page?.has_more ?? false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoadingMore(false);
    }
  }, [fetcher, nextCursor, loadingMore]);

  return { items, nextCursor, hasMore, loading, loadingMore, error, load, loadMore };
}
