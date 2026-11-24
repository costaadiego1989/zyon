import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ServiceMetricsResponse } from "@zyon/shared-types";
import type { MerchantProfile } from "../../api-client.js";
import { useApi } from "../../hooks/useApi.js";
import { canManageServiceAttendance } from "../../lib/auth/permissions.js";
import { SESSION_EXPIRED_EVENT } from "../../api/http/client.js";
import { classifyServiceMetricsError, validateServiceMetricsQuery, type ServiceMetricsClient,
  type ServiceMetricsErrorKind, type ServiceMetricsQuery } from "../../api/endpoints/service-metrics.js";

interface Context { merchantId: string; userId: string; client: ServiceMetricsClient }
type Status = ServiceMetricsResponse["dataStatus"] | "loading" | "error" | "invalid" | "forbidden" | "unauthorized";
interface State { context: Context | null; key: string; status: Status; data: ServiceMetricsResponse | null; errorKind?: ServiceMetricsErrorKind }
interface Pending { context: Context; key: string; controller: AbortController }

/** Service data only. The future page wrapper must choose its mode before
 * mounting this hook or the existing commerce hook in separate children. */
export function useServiceOverview({ me, query }: { me: MerchantProfile | null; query: ServiceMetricsQuery }) {
  const api = useApi();
  const allowed = canManageServiceAttendance(me);
  const context = useMemo<Context | null>(() => allowed && me ? {
    merchantId: me.id, userId: me.user_id, client: api.serviceMetrics({ id: me.id, user_id: me.user_id }),
  } : null, [api, allowed, me?.id, me?.user_id, me?.role, me?.businessMode, me?.businessModeSelectionState]);
  let selected: ServiceMetricsQuery | null = null;
  try { selected = validateServiceMetricsQuery(query); } catch { /* Invalid filters never issue a request. */ }
  const key = selected ? JSON.stringify(selected) : "invalid";
  const selectedRef = useRef(selected); selectedRef.current = selected;
  const mounted = useRef(true), sequence = useRef(0), pending = useRef<Pending | null>(null);
  const expiredFor = useRef<Context | null>(null);
  const [expiryVersion, setExpiryVersion] = useState(0);
  const expired = context !== null && expiredFor.current === context;
  const active = context !== null && selected !== null && !expired;
  const current = useRef({ context, key, active });
  current.current = { context, key, active };
  const [state, setState] = useState<State>({ context: null, key: "", status: "loading", data: null });
  const isCurrent = useCallback((scope: Context | null, selectedKey: string) => scope !== null && mounted.current
    && current.current.context === scope && current.current.key === selectedKey && current.current.active && expiredFor.current !== scope, []);

  const read = useCallback(async (scope: Context | null, selectedKey: string, filters: ServiceMetricsQuery | null): Promise<void> => {
    if (!scope || !filters || !isCurrent(scope, selectedKey)) return;
    const epoch = ++sequence.current;
    pending.current?.controller.abort();
    const token: Pending = { context: scope, key: selectedKey, controller: new AbortController() };
    pending.current = token;
    setState({ context: scope, key: selectedKey, status: "loading", data: null });
    try {
      const response = await scope.client.read(filters, { signal: token.controller.signal });
      if (!isCurrent(scope, selectedKey) || epoch !== sequence.current) return;
      setState({ context: scope, key: selectedKey, status: response.dataStatus, data: response });
    } catch (error) {
      if (!isCurrent(scope, selectedKey) || epoch !== sequence.current) return;
      setState({ context: scope, key: selectedKey, status: "error", data: null, errorKind: classifyServiceMetricsError(error) });
    } finally {
      if (pending.current === token) pending.current = null;
    }
  }, [isCurrent]);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; sequence.current++; pending.current?.controller.abort(); pending.current = null; };
  }, []);
  useEffect(() => {
    const expire = () => {
      const scope = current.current.context;
      if (!scope) return;
      expiredFor.current = scope;
      current.current.active = false;
      sequence.current++;
      pending.current?.controller.abort(); pending.current = null;
      setState({ context: scope, key: current.current.key, status: "unauthorized", data: null, errorKind: "unauthorized" });
      setExpiryVersion(value => value + 1);
    };
    window.addEventListener(SESSION_EXPIRED_EVENT, expire);
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, expire);
  }, []);
  useEffect(() => {
    if (active) void read(context, key, selectedRef.current);
    return () => {
      if (pending.current?.context === context && pending.current.key === key) {
        sequence.current++; pending.current.controller.abort(); pending.current = null;
      }
    };
    // Scalars in key capture all query fields; context captures principal/API.
  }, [context, key, active, expiryVersion, read]);

  // Mask stale data during render, before a changed scope's effect runs.
  const visible: State = !me ? { context: null, key, status: "unauthorized", data: null }
    : !allowed || !context ? { context: null, key, status: "forbidden", data: null }
      : expired ? { context, key, status: "unauthorized", data: null, errorKind: "unauthorized" }
        : !selected ? { context, key, status: "invalid", data: null, errorKind: "invalid" }
          : state.context === context && state.key === key ? state : { context, key, status: "loading", data: null };
  return { allowed, query: selected ? { ...selected } : null, status: visible.status, loading: visible.status === "loading", data: visible.data,
    errorKind: visible.errorKind, asOf: visible.data?.asOf ?? null,
    refresh: () => read(context, key, selected) };
}
