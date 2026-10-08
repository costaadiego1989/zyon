import { useCallback, useEffect, useRef, useState } from "react";
import { supportRefreshCoordinator, supportRefreshError } from "./support-refresh.js";

/** Poll after completion, pause hidden tabs, and coalesce focus/socket refreshes. */
export function useSupportRefresh<T>(api: object, key: string, load: () => Promise<T>, intervalMs: number) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retryAt, setRetryAt] = useState(0);
  const generation = useRef(0);
  const owner = useRef<{ key: string; api: object }>();
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const refresh = useRef<() => Promise<void>>();
  const coordinator = supportRefreshCoordinator(api);
  const schedule = useCallback((delay: number) => {
    clearTimeout(timer.current);
    if (!document.hidden) timer.current = setTimeout(() => void refresh.current?.(), delay);
  }, []);
  const reload = useCallback(async () => {
    if (document.hidden || owner.current?.key !== key || owner.current.api !== api) return;
    clearTimeout(timer.current);
    const current = generation.current;
    const result = await coordinator.run(key, load);
    if (current !== generation.current) return;
    if (result.kind === "success") { setData(result.data); setError(null); setRetryAt(0); }
    else if (result.kind === "error") { setError(supportRefreshError(result.error)); setRetryAt(result.retryAt); }
    else if (result.retryAt - Date.now() > 1000) {
      setError("A atualização está pausada. A consulta será retomada automaticamente."); setRetryAt(result.retryAt);
    }
    setLoading(false);
    schedule(result.kind === "success" ? intervalMs : Math.max(1000, result.retryAt - Date.now()));
  }, [api, coordinator, key, load, intervalMs, schedule]);
  refresh.current = reload;
  useEffect(() => {
    generation.current++; owner.current = { key, api }; setData(null); setLoading(true); setError(null); setRetryAt(0);
    void reload();
    const resume = () => { if (document.hidden) clearTimeout(timer.current); else void reload(); };
    window.addEventListener("focus", resume); document.addEventListener("visibilitychange", resume);
    return () => { generation.current++; owner.current = undefined; clearTimeout(timer.current); window.removeEventListener("focus", resume); document.removeEventListener("visibilitychange", resume); };
  }, [api, key, reload]);
  return { data, loading, error, retryAt, reload };
}
