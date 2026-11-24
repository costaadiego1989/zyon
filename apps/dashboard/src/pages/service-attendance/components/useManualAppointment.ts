import { useEffect, useMemo, useRef, useState } from "react";
import type { MerchantProfile, TenantCustomer } from "../../../api-client.js";
import type { ServiceAppointmentAdminDetail } from "@zyon/shared-types";
import { useApi } from "../../../hooks/useApi.js";
import { canManageServiceAttendance } from "../../../lib/auth/permissions.js";
import { SESSION_EXPIRED_EVENT } from "../../../api/http/client.js";
import { DashboardHttpError } from "../../../api/http/error.js";
import { createIdempotencyKey } from "../../../api/http/idempotency.js";
import { classifyServiceAttendanceError, type ServiceAvailabilityDatesDTO, type ServiceAvailabilitySlotsDTO } from "../../../api/endpoints/service-attendance.js";
import type { ManualServiceAppointmentInput, ManualServiceAppointmentReceipt } from "../../../api/endpoints/service-appointment-operations.js";
import type { useServiceAttendancePage } from "../useServiceAttendancePage.js";
import { useProfessionalsPanelData } from "./useProfessionalsPanelData.js";
import { createManualAppointmentDraft, manualAppointmentCommand, manualPolicyReady, readManualAppointmentDetail, type ManualAppointmentDraft } from "./manual-appointment-form.js";
import { FIXED_SERVICE_UI_TIME_ZONE } from "./fixed-service-time-zone.js";

type Status = "editing" | "submitting" | "uncertain" | "rejected" | "reconciling" | "detail_error" | "success" | "unauthorized" | "forbidden";
export interface ManualAppointmentProps { me: MerchantProfile | null; vm: ReturnType<typeof useServiceAttendancePage>; open: boolean; onClose?: () => void }
interface Scope {
  merchantId: string;
  attendance: ReturnType<ReturnType<typeof useApi>["serviceAttendance"]>;
  operations: ReturnType<ReturnType<typeof useApi>["serviceAppointmentOperations"]>;
  appointments: ReturnType<ReturnType<typeof useApi>["serviceAppointments"]>;
  customers: ReturnType<ReturnType<typeof useApi>["serviceManualCustomers"]>;
}
interface State {
  scope: Scope | null; status: Status; draft: ManualAppointmentDraft; error: string | null;
  customers: TenantCustomer[]; customerCursor: string | null; customerLoading: boolean; customerError: string | null;
  dates: ServiceAvailabilityDatesDTO | null; slots: ServiceAvailabilitySlotsDTO | null; calendarLoading: boolean; calendarError: string | null;
  detail: ServiceAppointmentAdminDetail | null;
}
interface Attempt { scope: Scope; body: ManualServiceAppointmentInput; receipt: ManualServiceAppointmentReceipt | null; busy: boolean; outcome: "sending" | "uncertain" | "rejected" | "acknowledged" }
const empty = (scope: Scope | null, period: { fromDate: string; toDate: string }): State => ({ scope, status: "editing", draft: createManualAppointmentDraft(period), error: null,
  customers: [], customerCursor: null, customerLoading: false, customerError: null, dates: null, slots: null, calendarLoading: false, calendarError: null, detail: null });
const date = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;

/** Manual admission has one frozen command until a known rejection or canonical ACK.
 * No automatic write retry, matching-by-coordinates, financial inference or reload storage. */
export function useManualAppointment({ me, vm, open }: ManualAppointmentProps) {
  const api = useApi(), catalog = useProfessionalsPanelData(me, vm);
  const allowed = vm.allowed && canManageServiceAttendance(me);
  const key = allowed && me ? JSON.stringify([me.id, me.user_id, me.role, me.businessMode, me.businessModeSelectionState]) : "";
  const scope = useMemo<Scope | null>(() => key && me ? { merchantId: me.id, attendance: api.serviceAttendance(me), operations: api.serviceAppointmentOperations(me),
    appointments: api.serviceAppointments(me), customers: api.serviceManualCustomers(me) } : null, [api, key]);
  const current = useRef(scope); current.current = scope;
  const mounted = useRef(true), expired = useRef<Scope | null>(null), denied = useRef<Scope | null>(null), visible = useRef(open); visible.current = open;
  const [stored, setStored] = useState<State>(() => empty(scope, vm.filters));
  const live = useRef(stored); live.current = stored;
  const liveVm = useRef(vm); liveVm.current = vm;
  const liveCatalog = useRef(catalog); liveCatalog.current = catalog;
  const attempt = useRef<Attempt | null>(null), customerSequence = useRef(0), calendarSequence = useRef(0);
  const customerRead = useRef<AbortController | null>(null), calendarRead = useRef<AbortController | null>(null);
  function valid(target: Scope | null): target is Scope { return !!target && mounted.current && current.current === target && expired.current !== target && denied.current !== target; }
  function patch(target: Scope, change: Partial<State>) {
    if (!valid(target)) return;
    setStored(previous => previous.scope === target ? { ...previous, ...change } : { ...empty(target, liveVm.current.filters), ...change });
  }
  function fence(target: Scope, status: "unauthorized" | "forbidden") {
    if (!mounted.current || current.current !== target) return;
    if (status === "unauthorized") expired.current = target; else denied.current = target;
    attempt.current = null; customerSequence.current++; calendarSequence.current++; customerRead.current?.abort(); calendarRead.current?.abort();
    setStored({ ...empty(target, { fromDate: "", toDate: "" }), status });
  }
  function authError(target: Scope, error: unknown) {
    const kind = classifyServiceAttendanceError(error);
    if (kind === "unauthorized" || kind === "forbidden") { fence(target, kind); return true; }
    return false;
  }
  useEffect(() => {
    mounted.current = true;
    const expire = () => { if (current.current) fence(current.current, "unauthorized"); };
    window.addEventListener(SESSION_EXPIRED_EVENT, expire);
    return () => { mounted.current = false; attempt.current = null; customerSequence.current++; calendarSequence.current++; customerRead.current?.abort(); calendarRead.current?.abort(); window.removeEventListener(SESSION_EXPIRED_EVENT, expire); };
  }, []);
  useEffect(() => {
    attempt.current = null; customerSequence.current++; calendarSequence.current++; customerRead.current?.abort(); calendarRead.current?.abort();
    setStored(empty(scope, liveVm.current.filters));
  }, [scope]);
  useEffect(() => { if (open && valid(scope) && liveCatalog.current.catalogPhase === "idle") void liveCatalog.current.loadCatalog(); }, [scope, open]);

  const blocked = scope && (expired.current === scope ? "unauthorized" : denied.current === scope ? "forbidden" : null);
  const state = scope && stored.scope === scope ? stored : empty(scope, vm.filters);
  const policy = vm.loadState.data?.policy ?? null;
  const status: Status = blocked || (!scope ? "forbidden" : state.status);
  const snapshotReady = ["ready", "empty"].includes(vm.loadState.status) && !["saving", "conflict", "uncertain"].includes(vm.command.status);
  const locked = status !== "editing", ready = valid(scope) && snapshotReady && manualPolicyReady(policy);
  const services = valid(scope) ? catalog.services.filter(row => row.merchantId === scope.merchantId && row.isActive) : [];
  const professionals = valid(scope) ? catalog.rows.filter(row => row.merchantId === scope.merchantId && row.isActive && row.isPublished && row.services.some(link => link.productId === state.draft.productId)) : [];
  function editable(target: Scope | null): target is Scope { return valid(target) && visible.current && live.current.scope === target && live.current.status === "editing" && !attempt.current; }
  function clearCalendar(target: Scope) { calendarSequence.current++; calendarRead.current?.abort(); patch(target, { dates: null, slots: null, calendarLoading: false, calendarError: null }); }
  function update(change: Partial<ManualAppointmentDraft>) {
    if (!editable(scope)) return;
    const before = live.current.draft;
    let draft = { ...before, ...change };
    if (change.categoryId !== undefined) draft = { ...draft, productId: "", variantId: "", professionalId: "", date: "", slotStartsAt: "" };
    if (change.productId !== undefined) {
      const product = liveCatalog.current.services.find(row => row.id === change.productId && row.merchantId === scope.merchantId && row.isActive);
      const variants = product?.variants.filter(row => row.isActive) ?? [];
      draft = { ...draft, variantId: variants.length === 1 ? variants[0].id : "", professionalId: "", date: "", slotStartsAt: "" };
    }
    if (["categoryId", "productId", "variantId", "professionalId", "fromDate", "toDate", "explicitOneOff"].some(field => field in change)) {
      clearCalendar(scope); draft = { ...draft, date: "", slotStartsAt: "" };
    }
    patch(scope, { draft, error: null });
  }
  async function loadCustomers() {
    const target = scope;
    if (!editable(target) || live.current.customerLoading) return;
    const cursor = live.current.customerCursor, sequence = ++customerSequence.current, controller = new AbortController(); customerRead.current?.abort(); customerRead.current = controller;
    patch(target, { customerLoading: true, customerError: null });
    try {
      const result = await target.customers.list({ ...(cursor ? { cursor } : {}), signal: controller.signal });
      if (!valid(target) || sequence !== customerSequence.current) return;
      if (cursor && result.next_cursor === cursor) throw Error("repeated_customer_cursor");
      const byId = new Map((cursor ? live.current.customers : []).map(row => [row.id, row]));
      for (const row of result.data) byId.set(row.id, row);
      patch(target, { customers: [...byId.values()], customerCursor: result.next_cursor, customerLoading: false });
    } catch (error) { if (valid(target) && sequence === customerSequence.current && !authError(target, error)) patch(target, { customerLoading: false, customerError: "Não foi possível consultar os clientes. Tente novamente." }); }
  }
  function resources(target: Scope, draft: ManualAppointmentDraft) {
    const product = liveCatalog.current.services.find(row => row.id === draft.productId && row.merchantId === target.merchantId && row.isActive);
    const professional = liveCatalog.current.rows.find(row => row.id === draft.professionalId && row.merchantId === target.merchantId && row.isActive && row.isPublished && row.services.some(link => link.productId === draft.productId));
    if (!product?.variants.some(row => row.id === draft.variantId && row.isActive) || !professional) throw Error("Selecione serviço e profissional vinculados.");
    return { productId: product.id, variantId: draft.variantId, professionalId: professional.id, expectedVersion: professional.version };
  }
  function checkCalendar(value: ServiceAvailabilityDatesDTO, target: Scope, draft: ManualAppointmentDraft) {
    const professional = liveCatalog.current.rows.find(row => row.id === draft.professionalId), currentPolicy = liveVm.current.loadState.data?.policy;
    if (!value || !["ready", "empty", "stale"].includes(value.status) || value.timeZone !== FIXED_SERVICE_UI_TIME_ZONE || value.professionalVersion !== professional?.version
      || !manualPolicyReady(currentPolicy) || value.policyVersion !== currentPolicy.version || !Array.isArray(value.dates) || value.dates.some(row => !date(row) || row < draft.fromDate || row > draft.toDate)
      || new Set(value.dates).size !== value.dates.length || !Number.isSafeInteger(value.durationMinutes) || value.durationMinutes < 5 || value.durationMinutes > 480
      || !Number.isFinite(Date.parse(value.asOf)) || value.status !== "ready" && value.dates.length) throw Error("invalid_calendar_snapshot");
    if (!valid(target)) throw Error("stale_context");
  }
  async function loadDates() {
    const target = scope;
    if (!editable(target) || !["ready", "empty"].includes(liveVm.current.loadState.status) || !manualPolicyReady(liveVm.current.loadState.data?.policy)) return;
    const draft = live.current.draft, sequence = ++calendarSequence.current, controller = new AbortController(); calendarRead.current?.abort(); calendarRead.current = controller;
    patch(target, { dates: null, slots: null, calendarLoading: true, calendarError: null, draft: { ...draft, date: "", slotStartsAt: "" } });
    try {
      if (!date(draft.fromDate) || !date(draft.toDate) || draft.fromDate > draft.toDate || Date.parse(draft.toDate) - Date.parse(draft.fromDate) >= 31 * 86400000) throw Error("invalid_period");
      const value = await target.attendance.getAvailableDates({ ...resources(target, draft), fromDate: draft.fromDate, toDate: draft.toDate }, { signal: controller.signal });
      if (!valid(target) || sequence !== calendarSequence.current) return;
      checkCalendar(value, target, draft); patch(target, { dates: value, calendarLoading: false });
    } catch (error) { if (valid(target) && sequence === calendarSequence.current && !authError(target, error)) patch(target, { calendarLoading: false, calendarError: "Não foi possível consultar datas atuais. Confira as escolhas e consulte novamente." }); }
  }
  async function selectDate(value: string) {
    const target = scope;
    if (!editable(target)) return;
    const previous = live.current, draft = { ...previous.draft, date: value, slotStartsAt: "" };
    const sequence = ++calendarSequence.current, controller = new AbortController(); calendarRead.current?.abort(); calendarRead.current = controller;
    patch(target, { draft, slots: null, calendarLoading: false, calendarError: null });
    if (!value || previous.dates?.status !== "ready" || !previous.dates.dates.includes(value)) return;
    patch(target, { calendarLoading: true });
    try {
      const result = await target.attendance.getAvailableSlots({ ...resources(target, draft), date: value }, { signal: controller.signal });
      if (!valid(target) || sequence !== calendarSequence.current) return;
      checkCalendar(result, target, draft);
      if (!Array.isArray(result.slots) || result.slots.some(row => row.date !== value || row.timeZone !== FIXED_SERVICE_UI_TIME_ZONE || row.durationMinutes !== result.durationMinutes
        || !/^\d{2}:\d{2}$/.test(row.startTime) || !Number.isFinite(Date.parse(row.startsAt)) || !Number.isFinite(Date.parse(row.endsAt))
        || Date.parse(row.endsAt) - Date.parse(row.startsAt) !== row.durationMinutes * 60000) || new Set(result.slots.map(row => row.startsAt)).size !== result.slots.length) throw Error("invalid_slots_snapshot");
      patch(target, { slots: result, calendarLoading: false });
    } catch (error) { if (valid(target) && sequence === calendarSequence.current && !authError(target, error)) patch(target, { calendarLoading: false, calendarError: "Não foi possível consultar os horários. Selecione a data novamente." }); }
  }
  async function readDetail(target: Scope, operation: Attempt) {
    if (!valid(target) || attempt.current !== operation || !operation.receipt) return;
    patch(target, { status: "reconciling", error: null });
    try {
      const receipt = operation.receipt, result = await target.appointments.detail(receipt.appointment.id);
      if (!valid(target) || attempt.current !== operation) return;
      const detail = readManualAppointmentDetail(result, { merchantId: target.merchantId, appointmentId: receipt.appointment.id, productId: operation.body.productId, variantId: operation.body.variantId, minimumVersion: receipt.appointment.version });
      if (!detail) throw Error("invalid_manual_detail");
      patch(target, { status: "success", detail, error: null });
    } catch (error) { if (valid(target) && attempt.current === operation && !authError(target, error)) patch(target, { status: "detail_error", detail: null, error: "Ainda não foi possível conferir o agendamento. Recarregue os detalhes, sem criar outra tentativa." }); }
  }
  async function write(target: Scope, operation: Attempt) {
    if (!valid(target) || attempt.current !== operation || operation.busy) return;
    operation.busy = true; operation.outcome = "sending"; patch(target, { status: "submitting", error: null });
    try {
      const receipt = await target.operations.createManual(operation.body);
      if (!valid(target) || attempt.current !== operation) return;
      operation.receipt = receipt; operation.outcome = "acknowledged"; await readDetail(target, operation);
    } catch (error) {
      if (!valid(target) || attempt.current !== operation || authError(target, error)) return;
      const rejected = error instanceof DashboardHttpError && [400, 409, 412, 422].includes(error.status);
      operation.outcome = rejected ? "rejected" : "uncertain";
      patch(target, { status: rejected ? "rejected" : "uncertain", error: rejected ? "O servidor não aceitou esta tentativa. Revise os dados e consulte horários atuais antes de criar outra." : "Sua tentativa foi preservada. O resultado ainda não foi confirmado. Você pode repetir somente esta mesma tentativa." });
    } finally { operation.busy = false; }
  }
  async function submit() {
    const target = scope;
    if (!editable(target) || !manualPolicyReady(liveVm.current.loadState.data?.policy) || !["ready", "empty"].includes(liveVm.current.loadState.status)
      || ["saving", "conflict", "uncertain"].includes(liveVm.current.command.status)) return;
    try {
      const snapshot = live.current;
      const body = manualAppointmentCommand(snapshot.draft, { merchantId: target.merchantId, product: liveCatalog.current.services.find(row => row.id === snapshot.draft.productId),
        professional: liveCatalog.current.rows.find(row => row.id === snapshot.draft.professionalId), policy: liveVm.current.loadState.data?.policy ?? null,
        availability: snapshot.slots, customers: snapshot.customers, commandId: createIdempotencyKey() });
      const operation: Attempt = { scope: target, body: structuredClone(body), receipt: null, busy: false, outcome: "sending" };
      attempt.current = operation; customerSequence.current++; calendarSequence.current++; customerRead.current?.abort(); calendarRead.current?.abort(); await write(target, operation);
    } catch (error) { if (valid(target) && !attempt.current) patch(target, { error: error instanceof Error ? error.message : "Confira os dados do agendamento." }); }
  }
  async function retry() { const operation = attempt.current; if (valid(scope) && visible.current && operation?.scope === scope && operation.outcome === "uncertain" && !operation.receipt) await write(scope, operation); }
  async function reconcileDetail() {
    const operation = attempt.current;
    if (!valid(scope) || !visible.current || operation?.scope !== scope || !operation.receipt || operation.busy) return;
    operation.busy = true; try { await readDetail(scope, operation); } finally { operation.busy = false; }
  }
  function review() {
    const operation = attempt.current;
    if (!valid(scope) || !visible.current || operation?.scope !== scope || operation.busy || operation.outcome !== "rejected") return;
    attempt.current = null; clearCalendar(scope);
    patch(scope, { status: "editing", error: null, draft: { ...live.current.draft, date: "", slotStartsAt: "", oneOffStart: "" } });
  }
  function startNew() {
    const operation = attempt.current;
    if (!valid(scope) || !visible.current || operation?.scope !== scope || operation.busy || live.current.status !== "success" || !live.current.detail) return;
    attempt.current = null; customerSequence.current++; calendarSequence.current++; customerRead.current?.abort(); calendarRead.current?.abort();
    setStored(empty(scope, liveVm.current.filters));
  }
  async function loadCatalog() { if (editable(scope)) await liveCatalog.current.loadCatalog(); }
  async function loadMoreProfessionals() { if (editable(scope)) await liveCatalog.current.loadMoreProfessionals(); }
  return { status, allowed: !!scope && !blocked, ready, locked, draft: blocked || !scope ? createManualAppointmentDraft({ fromDate: "", toDate: "" }) : state.draft,
    error: blocked || !scope ? null : state.error, customers: blocked || !scope ? [] : state.customers, customerCursor: state.customerCursor,
    customerLoading: state.customerLoading, customerError: state.customerError, dates: state.dates, slots: state.slots, calendarLoading: state.calendarLoading, calendarError: state.calendarError,
    detail: blocked || !scope ? null : state.detail, policy, services, professionals, categories: valid(scope) ? vm.loadState.data?.categories ?? [] : [],
    catalogLoading: catalog.catalogPhase === "loading", catalogError: catalog.catalogError, catalogHasMore: catalog.catalogHasMore, professionalHasMore: !!catalog.nextCursor, professionalLoading: catalog.listLoading,
    update, loadCustomers, loadDates, selectDate, submit, retry, reconcileDetail, review, startNew, loadCatalog, loadMoreProfessionals };
}
