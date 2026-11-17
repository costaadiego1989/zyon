import { useEffect, useMemo, useRef, useState } from "react";
import type { MerchantProfile, Product } from "../../../api-client.js";
import { useApi } from "../../../hooks/useApi.js";
import { canManageServiceAttendance } from "../../../lib/auth/permissions.js";
import { classifyServiceAttendanceError, type ServiceProfessionalDTO, type ServiceProfessionalPage, type ServiceAttendanceApi } from "../../../api/endpoints/service-attendance.js";
import type { useServiceAttendancePage } from "../useServiceAttendancePage.js";

interface Context { key: string; merchantId: string; client: ServiceAttendanceApi }
interface ProfessionalPage { context: Context | null; base: ServiceProfessionalPage | null; rows: ServiceProfessionalDTO[]; nextCursor: string | null; phase: "idle" | "loading" | "error"; error: string | null }
interface CatalogPage { context: Context | null; rows: Product[]; nextCursor: string | undefined; phase: "idle" | "loading" | "ready" | "error"; error: string | null }
export function useProfessionalsPanelData(me: MerchantProfile | null, vm: ReturnType<typeof useServiceAttendancePage>) {
  const api = useApi(), allowed = vm.allowed && canManageServiceAttendance(me);
  const key = allowed && me ? JSON.stringify([me.id, me.user_id, me.role, me.businessMode, me.businessModeSelectionState]) : "";
  const context = useMemo<Context | null>(() => key && me ? { key, merchantId: me.id, client: api.serviceAttendance(me) } : null, [api, key]);
  const current = useRef(context); current.current = context;
  const mounted = useRef(true);
  const base = vm.loadState.data?.professionals ?? null;
  const currentBase = useRef(base); currentBase.current = base;
  const [page, setPage] = useState<ProfessionalPage>({ context: null, base: null, rows: [], nextCursor: null, phase: "idle", error: null });
  const [catalog, setCatalog] = useState<CatalogPage>({ context: null, rows: [], nextCursor: undefined, phase: "idle", error: null });
  const professionalLock = useRef<{ context: Context; base: ServiceProfessionalPage } | null>(null), catalogLock = useRef<{ context: Context } | null>(null), catalogSequence = useRef(0);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; catalogSequence.current++; }; }, []);
  const valid = (scope: Context) => mounted.current && current.current === scope;
  const extra = page.context === context && page.base === base ? page : null;
  const baseMismatch = Boolean(context && base?.items.some(item => item.merchantId !== context.merchantId));
  const rows = !context || baseMismatch ? [] : [...(base?.items ?? []), ...(extra?.rows ?? [])];
  const nextCursor = extra ? extra.nextCursor : base?.nextCursor ?? null;
  const visibleCatalog = catalog.context === context ? catalog : { context, rows: [], nextCursor: undefined, phase: "idle" as const, error: null };

  async function loadMoreProfessionals() {
    const scope = context, source = base, cursor = nextCursor;
    if (!scope || !valid(scope) || !source || !cursor || baseMismatch || professionalLock.current?.context === scope && professionalLock.current.base === source) return;
    const token = { context: scope, base: source }; professionalLock.current = token;
    setPage({ context: scope, base: source, rows: extra?.rows ?? [], nextCursor: cursor, phase: "loading", error: null });
    try {
      const result = await scope.client.listProfessionals({ limit: 25, cursor });
      if (!valid(scope) || currentBase.current !== source) return;
      if (result.items.some(item => item.merchantId !== scope.merchantId) || result.nextCursor === cursor) throw new TypeError("invalid_professional_page");
      const all = [...source.items, ...(extra?.rows ?? []), ...result.items], seen = new Set<string>();
      const combined = all.filter(item => { if (seen.has(item.id)) return false; seen.add(item.id); return true; });
      const baseIds = new Set(source.items.map(item => item.id));
      setPage({ context: scope, base: source, rows: combined.filter(item => !baseIds.has(item.id)), nextCursor: result.nextCursor, phase: "idle", error: null });
    } catch (error) {
      if (valid(scope) && currentBase.current === source) setPage({ context: scope, base: source, rows: extra?.rows ?? [], nextCursor: cursor, phase: "error", error: classifyServiceAttendanceError(error) });
    } finally { if (professionalLock.current === token) professionalLock.current = null; }
  }
  async function loadCatalog(reset = false) {
    const scope = context;
    if (!scope || !valid(scope) || catalogLock.current?.context === scope && !reset) return;
    const previous = reset ? [] : visibleCatalog.rows, cursor = reset ? undefined : visibleCatalog.nextCursor;
    if (!reset && !cursor && visibleCatalog.phase === "ready") return;
    const token = { context: scope }, sequence = ++catalogSequence.current; catalogLock.current = token;
    setCatalog({ context: scope, rows: previous, nextCursor: cursor, phase: "loading", error: null });
    try {
      const result = await api.listProducts(scope.merchantId, { status: "all", limit: 25, ...(cursor ? { cursor } : {}) });
      if (!valid(scope) || sequence !== catalogSequence.current) return;
      if (result.products.some(item => item.merchantId !== scope.merchantId) || cursor && result.nextCursor === cursor) throw new TypeError("invalid_service_catalog_scope");
      const all = [...previous, ...result.products], seen = new Set<string>();
      setCatalog({ context: scope, rows: all.filter(item => { if (seen.has(item.id)) return false; seen.add(item.id); return true; }), nextCursor: result.nextCursor, phase: "ready", error: null });
    } catch (error) {
      if (valid(scope) && sequence === catalogSequence.current) setCatalog({ context: scope, rows: previous, nextCursor: cursor, phase: "error", error: classifyServiceAttendanceError(error) });
    } finally { if (catalogLock.current === token) catalogLock.current = null; }
  }
  return { allowed, contextKey: key, rows, nextCursor, listLoading: extra?.phase === "loading", listError: baseMismatch ? "invalid_response" : extra?.error ?? null,
    loadMoreProfessionals, services: visibleCatalog.rows.filter(item => item.type === "service"), catalogPhase: visibleCatalog.phase, catalogError: visibleCatalog.error,
    catalogHasMore: Boolean(visibleCatalog.nextCursor), loadCatalog };
}
