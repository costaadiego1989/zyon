import { useEffect, useMemo, useRef, useState } from "react";
import type { MerchantProfile } from "../../api-client.js";
import { useApi } from "../../hooks/useApi.js";
import { canManageServiceAttendance } from "../../lib/auth/permissions.js";
import {
  classifyServiceAttendanceError, type ServiceAttendanceApi, type ServiceAttendanceErrorKind,
  type ServiceProfessionalPage, type ServiceCategoryDTO, type ServiceBusinessPolicyDTO,
  type ServiceProfessionalInput, type ServiceBusinessPolicyUpdate, type ServiceCategoryCreate, type ServiceCategoryUpdate,
  type ServiceRecurringAvailabilityInput, type ServiceAvailabilityExceptionInput, type ServiceMutationOptions,
  type ServiceAvailabilityDatesDTO, type ServiceAvailabilitySlotsDTO,
} from "../../api/endpoints/service-attendance.js";

const tabs = ["agenda", "professionals", "categories", "availability", "settings"] as const;
export interface ServiceAttendanceFilters {
  tab: typeof tabs[number];
  professionalId: string;
  categoryId: string;
  fromDate: string;
  toDate: string;
}
const emptyFilters: ServiceAttendanceFilters = { tab: "agenda", professionalId: "", categoryId: "", fromDate: "", toDate: "" };
function canonicalDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const time = Date.parse(value + "T00:00:00Z");
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value;
}
function normalizeFilters(input: ServiceAttendanceFilters): ServiceAttendanceFilters {
  const id = (value: string) => typeof value === "string" && value.trim() && value.length <= 191 ? value : "";
  const validWindow = canonicalDate(input.fromDate) && canonicalDate(input.toDate) && input.fromDate <= input.toDate
    && Date.parse(input.toDate) - Date.parse(input.fromDate) < 31 * 86_400_000;
  return { tab: tabs.includes(input.tab) ? input.tab : "agenda", professionalId: id(input.professionalId), categoryId: id(input.categoryId),
    fromDate: validWindow ? input.fromDate : "", toDate: validWindow ? input.toDate : "" };
}
export function parseServiceAttendanceFilters(hash: string): ServiceAttendanceFilters {
  if (hash.split("?")[0] !== "#service-attendance") return { ...emptyFilters };
  const query = new URLSearchParams(hash.split("?")[1] ?? "");
  return normalizeFilters(Object.fromEntries(Object.keys(emptyFilters).map(key => [key, query.get(key) ?? emptyFilters[key as keyof ServiceAttendanceFilters]])) as unknown as ServiceAttendanceFilters);
}
interface Context { client: ServiceAttendanceApi }
interface Snapshot { professionals: ServiceProfessionalPage; categories: Array<ServiceCategoryDTO & { product_count: number }>; policy: ServiceBusinessPolicyDTO }
interface LoadState { context: Context | null; status: "loading" | "ready" | "empty" | "error" | "forbidden"; data: Snapshot | null; errorKind?: ServiceAttendanceErrorKind }
interface CommandState { context: Context | null; status: "idle" | "saving" | "success" | "error" | "conflict" | "uncertain"; errorKind?: ServiceAttendanceErrorKind }
interface AvailabilityState { context: Context | null; selectors: string; status: "idle" | "loading" | "error" | ServiceAvailabilityDatesDTO["status"]; data: ServiceAvailabilityDatesDTO | ServiceAvailabilitySlotsDTO | null; errorKind?: ServiceAttendanceErrorKind }
export type ServiceActionResult<T> = { status: "success"; value: T } | { status: "error"; kind: ServiceAttendanceErrorKind } | { status: "stale" | "busy" | "forbidden" };

export function useServiceAttendancePage({ me }: { me: MerchantProfile | null }) {
  const api = useApi();
  const allowed = canManageServiceAttendance(me);
  const context = useMemo<Context | null>(() => allowed && me ? { client: api.serviceAttendance(me) } : null,
    [api, allowed, me?.id, me?.user_id]);
  const current = useRef(context);
  current.current = context;
  const mounted = useRef(true);
  const [filterState, setFilterState] = useState(() => ({ context, value: parseServiceAttendanceFilters(window.location.hash) }));
  const filters = filterState.context === context ? filterState.value : emptyFilters;
  const selectors = JSON.stringify(filters);
  const currentSelectors = useRef(selectors);
  currentSelectors.current = selectors;
  const [load, setLoad] = useState<LoadState>({ context: null, status: "loading", data: null });
  const latestLoad = useRef(load); latestLoad.current = load;
  const [commandState, setCommand] = useState<CommandState>({ context: null, status: "idle" });
  const [availabilityState, setAvailability] = useState<AvailabilityState>({ context: null, selectors: "", status: "idle", data: null });
  const readSequence = useRef(0), availabilitySequence = useRef(0);
  const reading = useRef<AbortController | null>(null);
  const writing = useRef<{ context: Context } | null>(null);
  const commandIssue = useRef<{ context: Context; kind: ServiceAttendanceErrorKind; target: "all" | "categories" } | null>(null);
  const isCurrent = (scope: Context | null) => scope !== null && mounted.current && current.current === scope;

  async function refreshContext(scope: Context | null, reconcile = false, target: "all" | "categories" = "all"): Promise<boolean> {
    if (!isCurrent(scope) || !scope) return false;
    const sequence = ++readSequence.current;
    reading.current?.abort();
    const controller = new AbortController(); reading.current = controller;
    setLoad(previous => ({ context: scope, status: "loading", data: previous.context === scope ? previous.data : null }));
    try {
      const previous = latestLoad.current.context === scope ? latestLoad.current.data : null;
      const data: Snapshot = target === "categories" && previous
        ? { ...previous, categories: await scope.client.listCategories({ signal: controller.signal }) }
        : await Promise.all([
          scope.client.listProfessionals({}, { signal: controller.signal }), scope.client.listCategories({ signal: controller.signal }), scope.client.getPolicy({ signal: controller.signal }),
        ]).then(([professionals, categories, policy]) => ({ professionals, categories, policy }));
      if (!isCurrent(scope) || sequence !== readSequence.current) return false;
      setLoad({ context: scope, status: data.professionals.items.length || data.categories.length ? "ready" : "empty", data });
      if (reconcile && commandIssue.current?.context === scope) {
        commandIssue.current = null;
        setCommand({ context: scope, status: "idle" });
      }
      return true;
    } catch (error) {
      if (!isCurrent(scope) || sequence !== readSequence.current) return false;
      setLoad(previous => ({ context: scope, status: "error", errorKind: classifyServiceAttendanceError(error), data: previous.context === scope ? previous.data : null }));
      return false;
    }
  }

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; reading.current?.abort(); readSequence.current++; availabilitySequence.current++; };
  }, []);
  useEffect(() => {
    setFilterState(previous => previous.context === context ? previous : { context, value: { ...emptyFilters } });
    void refreshContext(context);
    return () => { reading.current?.abort(); readSequence.current++; availabilitySequence.current++; };
    // Context identity includes the authenticated user, merchant and capability.
  }, [context]);
  useEffect(() => {
    const change = () => {
      if (current.current !== context || window.location.hash.split("?")[0] !== "#service-attendance") return;
      setFilterState({ context, value: parseServiceAttendanceFilters(window.location.hash) });
    };
    window.addEventListener("hashchange", change);
    return () => window.removeEventListener("hashchange", change);
  }, [context]);

  function setFilters(change: Partial<ServiceAttendanceFilters>) {
    if (!isCurrent(context) || window.location.hash.split("?")[0] !== "#service-attendance") return;
    const next = normalizeFilters({ ...filters, ...change });
    const query = new URLSearchParams(window.location.hash.split("?")[1] ?? "");
    for (const key of Object.keys(emptyFilters) as Array<keyof ServiceAttendanceFilters>) {
      if (next[key]) query.set(key, next[key]); else query.delete(key);
    }
    window.history.pushState(null, "", `#service-attendance${query.size ? "?" + query : ""}`);
    setFilterState({ context, value: next });
  }

  async function runCommand<T>(operation: (client: ServiceAttendanceApi) => Promise<T>, target: "all" | "categories" = "all"): Promise<ServiceActionResult<T>> {
    if (!context) return { status: "forbidden" };
    if (!isCurrent(context)) return { status: "stale" };
    if (writing.current?.context === context) return { status: "busy" };
    if (commandIssue.current?.context === context) return { status: "error", kind: commandIssue.current.kind };
    const token = { context }; writing.current = token;
    setCommand({ context, status: "saving" });
    try {
      const value = await operation(context.client);
      if (!isCurrent(context)) return { status: "stale" };
      setCommand({ context, status: "success" });
      await refreshContext(context, false, target);
      return isCurrent(context) ? { status: "success", value } : { status: "stale" };
    } catch (error) {
      if (!isCurrent(context)) return { status: "stale" };
      const kind = classifyServiceAttendanceError(error);
      if (kind === "conflict" || kind === "network" || kind === "invalid_response") commandIssue.current = { context, kind, target };
      setCommand({ context, status: kind === "conflict" ? "conflict" : kind === "network" || kind === "invalid_response" ? "uncertain" : "error", errorKind: kind });
      return { status: "error", kind };
    } finally {
      if (writing.current === token) writing.current = null;
    }
  }

  async function reconcileCategories(readOffers: () => Promise<boolean>): Promise<boolean> {
    const scope = context, issue = commandIssue.current;
    const target = issue?.context === scope ? issue.target : "categories";
    if (!await refreshContext(scope, false, target) || !isCurrent(scope)) return false;
    try { if (!await readOffers()) return false; } catch { return false; }
    if (!isCurrent(scope) || commandIssue.current !== issue) return false;
    if (issue?.context === scope) { commandIssue.current = null; setCommand({ context: scope, status: "idle" }); }
    return true;
  }

  async function reconcileAvailability(readGrade: () => Promise<boolean>): Promise<boolean> {
    const scope = context, issue = commandIssue.current;
    if (!await refreshContext(scope, false) || !isCurrent(scope)) return false;
    try { if (!await readGrade()) return false; } catch { return false; }
    if (!isCurrent(scope) || commandIssue.current !== issue) return false;
    if (issue?.context === scope) { commandIssue.current = null; setCommand({ context: scope, status: "idle" }); }
    return true;
  }

  async function loadAvailability(resources: { productId: string; variantId: string }, date?: string): Promise<void> {
    if (!isCurrent(context) || !context) return;
    const filter = filters, key = selectors, sequence = ++availabilitySequence.current;
    if (!filter.professionalId || !filter.fromDate || !filter.toDate || (date !== undefined && !canonicalDate(date))) {
      setAvailability({ context, selectors: key, status: "error", data: null, errorKind: "invalid" }); return;
    }
    setAvailability({ context, selectors: key, status: "loading", data: null });
    try {
      const query = { ...resources, professionalId: filter.professionalId };
      const data = date === undefined ? await context.client.getAvailableDates({ ...query, fromDate: filter.fromDate, toDate: filter.toDate })
        : await context.client.getAvailableSlots({ ...query, date });
      if (!isCurrent(context) || key !== currentSelectors.current || sequence !== availabilitySequence.current) return;
      setAvailability({ context, selectors: key, status: data.status, data });
    } catch (error) {
      if (!isCurrent(context) || key !== currentSelectors.current || sequence !== availabilitySequence.current) return;
      setAvailability({ context, selectors: key, status: "error", data: null, errorKind: classifyServiceAttendanceError(error) });
    }
  }

  const loadState: LoadState = !context ? { context: null, status: "forbidden", data: null }
    : load.context === context ? load : { context, status: "loading", data: null };
  const command: CommandState = commandState.context === context ? commandState : { context, status: "idle" };
  const availability: AvailabilityState = availabilityState.context === context && availabilityState.selectors === selectors
    ? availabilityState : { context, selectors, status: "idle", data: null };
  return {
    allowed, filters, setFilters, loadState, command, availability, refresh: () => refreshContext(context, true), reconcileCategories, reconcileAvailability,
    loadAvailableDates: (resources: { productId: string; variantId: string }) => loadAvailability(resources),
    loadAvailableSlots: (resources: { productId: string; variantId: string }, date: string) => loadAvailability(resources, date),
    actions: {
      createProfessional: (input: ServiceProfessionalInput, options?: ServiceMutationOptions) => runCommand(client => client.createProfessional(input, options)),
      updateProfessional: (id: string, input: Partial<ServiceProfessionalInput> & { expectedVersion: number }, options?: ServiceMutationOptions) => runCommand(client => client.updateProfessional(id, input, options)),
      deactivateProfessional: (id: string, version: number, options?: ServiceMutationOptions) => runCommand(client => client.deactivateProfessional(id, version, options)),
      updatePolicy: (input: ServiceBusinessPolicyUpdate, options?: ServiceMutationOptions) => runCommand(client => client.updatePolicy(input, options)),
      assignServiceCategory: (productId: string, categoryId: string) => runCommand(async () => {
        const merchantId = me!.id;
        const product = await api.getProduct(merchantId, productId);
        if (!isCurrent(context)) throw new Error("stale_service_category_context");
        if (product.id !== productId || product.merchantId !== merchantId || product.type !== "service" || !product.isActive) throw new TypeError("published_service_required");
        return api.updateProduct(merchantId, productId, { categoryId });
      }, "categories"),
      createCategory: (input: ServiceCategoryCreate, options?: ServiceMutationOptions) => runCommand(client => client.createCategory(input, options), "categories"),
      updateCategory: (id: string, input: ServiceCategoryUpdate, options?: ServiceMutationOptions) => runCommand(client => client.updateCategory(id, input, options), "categories"),
      deleteCategory: (id: string, options?: ServiceMutationOptions) => runCommand(client => client.deleteCategory(id, options), "categories"),
      reorderCategories: (items: Array<{ id: string; sort_order: number }>, options?: ServiceMutationOptions) => runCommand(client => client.reorderCategories(items, options)),
      saveProfessionalAvailability: (id: string, input: ServiceRecurringAvailabilityInput, options?: ServiceMutationOptions) => runCommand(client => client.saveProfessionalAvailability(id, input, options)),
      createAvailabilityException: (id: string, input: ServiceAvailabilityExceptionInput, options?: ServiceMutationOptions) => runCommand(client => client.createAvailabilityException(id, input, options)),
      updateAvailabilityException: (id: string, exceptionId: string, input: ServiceAvailabilityExceptionInput, options?: ServiceMutationOptions) => runCommand(client => client.updateAvailabilityException(id, exceptionId, input, options)),
    },
  };
}
