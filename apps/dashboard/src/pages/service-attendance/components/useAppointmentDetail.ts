import { useEffect, useMemo, useRef, useState } from "react";
import type { ServiceAppointmentAdminDetail, ServiceAppointmentOperationSummary } from "@zyon/shared-types";
import type { MerchantProfile } from "../../../api-client.js";
import { useApi } from "../../../hooks/useApi.js";
import { canManageServiceAttendance } from "../../../lib/auth/permissions.js";
import { SESSION_EXPIRED_EVENT } from "../../../api/http/client.js";
import { DashboardHttpError } from "../../../api/http/error.js";
import { createIdempotencyKey } from "../../../api/http/idempotency.js";
import { classifyServiceAttendanceError, type ServiceAvailabilityDatesDTO, type ServiceAvailabilitySlotsDTO } from "../../../api/endpoints/service-attendance.js";
import type { AttendanceAction, AttendanceReceiptInput, CancellationInput, RescheduleInput, TransitionInput, OperationAck, OperationPolicies, OperationPreview } from "../../../api/endpoints/service-appointment-actions.js";
import type { useServiceAttendancePage } from "../useServiceAttendancePage.js";
import { useProfessionalsPanelData } from "./useProfessionalsPanelData.js";
import { availabilityInstantWall } from "./availability-form.js";
import { readOperationDetail, coherentOperationSummary } from "./appointment-detail-data.js";
export interface AppointmentDetailProps { me: MerchantProfile | null; vm: ReturnType<typeof useServiceAttendancePage>; appointmentId: string | null; open: boolean; onClose?: () => void; onChanged?: () => void }
type Status = "idle" | "loading" | "ready" | "error" | "submitting" | "uncertain" | "rejected" | "detail_error" | "unauthorized" | "forbidden";
type Mode = "detail" | "cancel" | "reschedule" | "receipt";
interface Auth { merchantId: string; actions: ReturnType<ReturnType<typeof useApi>["serviceAppointmentActions"]>; reader: ReturnType<ReturnType<typeof useApi>["serviceAppointments"]>; calendar: ReturnType<ReturnType<typeof useApi>["serviceAttendance"]> }
type FrozenCommand = { kind: "transition"; body: TransitionInput } | { kind: "cancel"; body: CancellationInput } | { kind: "reschedule"; body: RescheduleInput } | { kind: "receipt"; body: AttendanceReceiptInput };
interface Attempt { command: FrozenCommand; ack: OperationAck | null; busy: boolean; rejected: boolean }
interface Draft { professionalId: string; fromDate: string; toDate: string; date: string; startsAt: string; accepted: boolean; paymentId: string; paymentMethod: string }
interface Session { id: string; status: Status; mode: Mode; detail: ServiceAppointmentAdminDetail | null; summary: ServiceAppointmentOperationSummary | null; policies: OperationPolicies | null;
  preview: OperationPreview | null; dates: ServiceAvailabilityDatesDTO | null; slots: ServiceAvailabilitySlotsDTO | null; draft: Draft; error: string | null; readError: string | null;
  reading: boolean; readSequence: number; editSequence: number; controller: AbortController | null; editController: AbortController | null; attempt: Attempt | null }
interface Selection { auth: Auth; session: Session }
const id = (value: unknown): value is string => typeof value === "string" && !!value && value.trim() === value && value.length <= 191 && ![".", ".."].includes(value) && !/[\x00-\x1f\x7f]/.test(value);
const civil = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
function newSession(appointmentId: string): Session { return { id: appointmentId, status: "idle", mode: "detail", detail: null, summary: null, policies: null, preview: null, dates: null, slots: null,
  draft: { professionalId: "", fromDate: "", toDate: "", date: "", startsAt: "", accepted: false, paymentId: "", paymentMethod: "" }, error: null, readError: null, reading: false, readSequence: 0, editSequence: 0, controller: null, editController: null, attempt: null }; }

/** Scoped sessions retain unknown commands across drawer close/selection ABA.
 * No automatic command replay, provider operation or financial inference. */
export function useAppointmentDetail({ me, vm, appointmentId, open, onChanged }: AppointmentDetailProps) {
  const api = useApi(), data = useProfessionalsPanelData(me, vm), [, render] = useState(0);
  const allowed = canManageServiceAttendance(me), actorKey = allowed && me ? JSON.stringify([me.id, me.user_id, me.role, me.businessMode, me.businessModeSelectionState]) : "";
  const auth = useMemo<Auth | null>(() => actorKey && me ? { merchantId: me.id, actions: api.serviceAppointmentActions(me), reader: api.serviceAppointments(me), calendar: api.serviceAttendance(me) } : null, [api, actorKey]);
  const sessions = useRef<{ auth: Auth | null; values: Map<string, Session> }>({ auth: null, values: new Map() });
  if (sessions.current.auth !== auth) { for (const row of sessions.current.values.values()) { row.controller?.abort(); row.editController?.abort(); } sessions.current = { auth, values: new Map() }; }
  const selection = useMemo<Selection | null>(() => {
    if (!auth || !id(appointmentId)) return null;
    let session = sessions.current.values.get(appointmentId); if (!session) { session = newSession(appointmentId); sessions.current.values.set(appointmentId, session); }
    return { auth, session };
  }, [auth, appointmentId]);
  const current = useRef(selection); current.current = selection;
  const currentAuth = useRef(auth); currentAuth.current = auth;
  const visible = useRef(open); visible.current = open;
  const mounted = useRef(true), expired = useRef<Auth | null>(null), denied = useRef<Auth | null>(null);
  const currentData = useRef(data); currentData.current = data;
  const changed = useRef(onChanged); changed.current = onChanged;
  function valid(scope: Selection | null): scope is Selection { return !!scope && mounted.current && current.current === scope && currentAuth.current === scope.auth && expired.current !== scope.auth && denied.current !== scope.auth; }
  function notify(scope: Selection) { if (valid(scope)) render(value => value + 1); }
  function edit(scope: Selection | null): scope is Selection { return valid(scope) && visible.current && scope.session.status === "ready" && !scope.session.attempt; }
  function fence(actor: Auth, status: "unauthorized" | "forbidden") {
    if (!mounted.current || currentAuth.current !== actor) return;
    if (status === "unauthorized") expired.current = actor; else denied.current = actor;
    for (const row of sessions.current.values.values()) { row.controller?.abort(); row.editController?.abort(); row.detail = null; row.summary = null; row.policies = null; row.preview = null; row.attempt = null; row.draft = newSession(row.id).draft; }
    sessions.current.values.clear(); render(value => value + 1);
  }
  function authFailure(scope: Selection, error: unknown) { const kind = classifyServiceAttendanceError(error); if (kind === "unauthorized" || kind === "forbidden") { fence(scope.auth, kind); return true; } return false; }
  useEffect(() => {
    mounted.current = true;
    const expire = () => { if (currentAuth.current) fence(currentAuth.current, "unauthorized"); };
    window.addEventListener(SESSION_EXPIRED_EVENT, expire);
    return () => { mounted.current = false; for (const row of sessions.current.values.values()) { row.controller?.abort(); row.editController?.abort(); } sessions.current.values.clear(); window.removeEventListener(SESSION_EXPIRED_EVENT, expire); };
  }, []);
  async function read(scope: Selection): Promise<boolean> {
    if (!valid(scope)) return false;
    const s = scope.session, sequence = ++s.readSequence; s.controller?.abort(); const controller = new AbortController(); s.controller = controller;
    s.status = "loading"; s.error = null; s.summary = null; notify(scope);
    try {
      const [raw, summary] = await Promise.all([scope.auth.reader.detail(s.id, { signal: controller.signal }), scope.auth.actions.summary(s.id, { signal: controller.signal })]);
      if (!valid(scope) || sequence !== s.readSequence) return false;
      const detail = readOperationDetail(raw, scope.auth.merchantId, s.id), ack = s.attempt?.ack;
      if (!detail || !coherentOperationSummary(detail, summary) || s.detail && detail.version < s.detail.version
        || ack?.appointmentVersion !== undefined && detail.version < ack.appointmentVersion
        || ack?.paymentId && !detail.payments.some(row => row.id === ack.paymentId && row.version >= (ack.paymentVersion ?? Number.MAX_SAFE_INTEGER))) throw Error("inconsistent_operation_read");
      const commandCompleted = !!s.attempt?.ack;
      s.detail = detail; s.summary = summary; s.status = "ready"; s.error = null; s.attempt = null; s.mode = "detail"; s.preview = null; s.policies = null; s.draft.accepted = false;
      if (!s.draft.fromDate) s.draft.fromDate = availabilityInstantWall(detail.startsAt, "America/Sao_Paulo").slice(0, 10);
      if (!s.draft.toDate) s.draft.toDate = s.draft.fromDate;
      notify(scope); if (commandCompleted && valid(scope)) changed.current?.(); return true;
    } catch (error) {
      if (valid(scope) && sequence === s.readSequence && !authFailure(scope, error)) { s.status = s.attempt?.ack ? "detail_error" : "error"; s.summary = null; s.error = s.attempt?.ack ? "Ainda não foi possível conferir a operação. Recarregue os detalhes, sem reenviar o comando." : "Não foi possível conferir os dados atuais deste agendamento."; notify(scope); }
      return false;
    }
  }
  useEffect(() => {
    if (open && valid(selection) && selection.session.status === "idle") void read(selection);
    return () => { if (selection) {
      const s = selection.session; s.readSequence++; s.editSequence++; s.controller?.abort(); s.editController?.abort(); s.reading = false;
      if (s.status === "loading") { s.status = s.attempt?.ack ? "detail_error" : s.detail ? "error" : "idle"; s.error = s.attempt?.ack ? "Ainda não foi possível conferir a operação. Recarregue os detalhes, sem reenviar o comando." : null; }
    } };
  }, [selection, open]);
  function update(change: Partial<Draft>) {
    if (!edit(selection)) return; const s = selection.session;
    if (["professionalId", "fromDate", "toDate", "date", "startsAt"].some(key => key in change)) {
      // Destination edits do not invalidate the appointment's pending policy read.
      if (!s.reading || s.policies) { s.editSequence++; s.editController?.abort(); s.reading = false; }
      s.preview = null; s.draft.accepted = false;
    }
    s.draft = { ...s.draft, ...change };
    if (["professionalId", "fromDate", "toDate"].some(key => key in change)) { s.dates = null; s.slots = null; s.draft.date = ""; s.draft.startsAt = ""; }
    s.readError = null; notify(selection);
  }
  async function policies(scope: Selection, mode: "cancel" | "reschedule") {
    const s = scope.session, sequence = ++s.editSequence; s.editController?.abort(); const controller = new AbortController(); s.editController = controller;
    s.mode = mode; s.policies = null; s.preview = null; s.draft.accepted = false; s.reading = true; s.readError = null; notify(scope);
    try { const value = await scope.auth.actions.policies(s.id, { signal: controller.signal }); if (!valid(scope) || sequence !== s.editSequence) return; s.policies = value; s.reading = false; notify(scope); }
    catch (error) { if (valid(scope) && sequence === s.editSequence && !authFailure(scope, error)) { s.reading = false; s.readError = "Não foi possível consultar as políticas atuais. Reabra a ação para conferir."; notify(scope); } }
  }
  async function openCancellation() { if (edit(selection) && selection.session.summary?.canReviewCancellation) await policies(selection, "cancel"); }
  async function openReschedule() { if (edit(selection) && selection.session.summary?.canReviewRescheduling) { const s = selection.session; s.dates = null; s.slots = null; s.draft.professionalId = ""; s.draft.date = ""; s.draft.startsAt = ""; await policies(selection, "reschedule"); } }
  function openReceipt(paymentId: string) { if (!edit(selection)) return; const s = selection.session, balance = s.summary?.localPayments.find(row => row.paymentId === paymentId && row.canRecordReceipt && row.balanceStatus === "available"); if (!balance) return; s.mode = "receipt"; s.draft.paymentId = paymentId; s.draft.accepted = false; s.readError = null; notify(selection); }
  function back() { if (!edit(selection)) return; const s = selection.session; s.editSequence++; s.editController?.abort(); s.mode = "detail"; s.preview = null; s.draft.accepted = false; s.reading = false; s.readError = null; notify(selection); }
  function resources(scope: Selection) { const s = scope.session, detail = s.detail;
    const professional = currentData.current.rows.find(row => row.id === s.draft.professionalId && row.merchantId === scope.auth.merchantId && row.isActive && row.isPublished && row.services.some(link => link.productId === detail?.productId));
    if (!detail || !professional) throw Error("Selecione um profissional vinculado.");
    return { productId: detail.productId, variantId: detail.variantId, professionalId: professional.id, expectedVersion: professional.version };
  }
  function checkCalendar(scope: Selection, value: ServiceAvailabilityDatesDTO) {
    const s = scope.session, r = resources(scope);
    if (!value || !["ready", "empty", "stale"].includes(value.status) || value.timeZone !== "America/Sao_Paulo" || value.professionalVersion !== r.expectedVersion
      || !Number.isSafeInteger(value.policyVersion) || (value.policyVersion ?? 0) < 1 || !Array.isArray(value.dates) || new Set(value.dates).size !== value.dates.length
      || value.dates.some(day => !civil(day) || day < s.draft.fromDate || day > s.draft.toDate) || !Number.isSafeInteger(value.durationMinutes) || value.durationMinutes < 5 || value.durationMinutes > 480
      || !Number.isFinite(Date.parse(value.asOf))) throw Error("invalid_destination_calendar");
  }
  async function loadDates() {
    if (!edit(selection) || selection.session.mode !== "reschedule") return; const scope = selection, s = scope.session, sequence = ++s.editSequence, controller = new AbortController(); s.editController?.abort(); s.editController = controller;
    s.reading = true; s.readError = null; s.dates = null; s.slots = null; s.preview = null; s.draft.date = ""; s.draft.startsAt = ""; s.draft.accepted = false; notify(scope);
    try { if (!civil(s.draft.fromDate) || !civil(s.draft.toDate) || s.draft.fromDate > s.draft.toDate || Date.parse(s.draft.toDate) - Date.parse(s.draft.fromDate) >= 31 * 86400000) throw Error("invalid_period");
      const value = await scope.auth.calendar.getAvailableDates({ ...resources(scope), fromDate: s.draft.fromDate, toDate: s.draft.toDate }, { signal: controller.signal });
      if (!valid(scope) || sequence !== s.editSequence) return; checkCalendar(scope, value); s.dates = value; s.reading = false; notify(scope);
    } catch (error) { if (valid(scope) && sequence === s.editSequence && !authFailure(scope, error)) { s.reading = false; s.readError = "Não foi possível consultar as novas datas. Confira o período e o profissional."; notify(scope); } }
  }
  async function selectDate(day: string) {
    if (!edit(selection)) return; const scope = selection, s = scope.session;
    s.editSequence++; s.editController?.abort(); s.draft.date = day; s.draft.startsAt = ""; s.draft.accepted = false; s.slots = null; s.preview = null; s.readError = null;
    if (s.dates?.status !== "ready" || !s.dates.dates.includes(day)) { notify(scope); return; }
    const sequence = s.editSequence, controller = new AbortController(); s.editController = controller; s.reading = true; notify(scope);
    try { const value = await scope.auth.calendar.getAvailableSlots({ ...resources(scope), date: day }, { signal: controller.signal });
      if (!valid(scope) || sequence !== s.editSequence) return; checkCalendar(scope, value);
      if (!Array.isArray(value.slots) || value.slots.some(row => row.date !== day || row.timeZone !== "America/Sao_Paulo" || row.durationMinutes !== value.durationMinutes || !Number.isFinite(Date.parse(row.startsAt)) || !Number.isFinite(Date.parse(row.endsAt)) || Date.parse(row.endsAt) - Date.parse(row.startsAt) !== row.durationMinutes * 60000)
        || new Set(value.slots.map(row => row.startsAt)).size !== value.slots.length) throw Error("invalid_destination_slots");
      s.slots = value; s.reading = false; notify(scope);
    } catch (error) { if (valid(scope) && sequence === s.editSequence && !authFailure(scope, error)) { s.reading = false; s.readError = "Não foi possível consultar os novos horários. Selecione a data novamente."; notify(scope); } }
  }
  function destination(scope: Selection) { const s = scope.session, r = resources(scope), slot = s.slots?.slots.find(row => row.date === s.draft.date && row.startsAt === s.draft.startsAt);
    if (s.slots?.status !== "ready" || !slot || s.slots.professionalVersion !== r.expectedVersion) throw Error("Selecione um horário consultado.");
    return { professionalId: r.professionalId, expectedProfessionalVersion: r.expectedVersion, startsAt: slot.startsAt };
  }
  async function preview() {
    if (!edit(selection) || !selection.session.detail || !selection.session.policies) return; const scope = selection, s = scope.session, sequence = ++s.editSequence, controller = new AbortController(); s.editController?.abort(); s.editController = controller;
    s.reading = true; s.readError = null; s.preview = null; s.draft.accepted = false; notify(scope);
    try { const value = await scope.auth.actions.preview(s.id, { expectedVersion: s.detail!.version, destination: destination(scope) }, { signal: controller.signal });
      if (!valid(scope) || sequence !== s.editSequence) return;
      if (value.quote.productId !== s.detail!.productId || value.quote.variantId !== s.detail!.variantId || value.quote.policyHash !== s.policies!.hash) throw Error("policy_or_product_changed");
      s.preview = value; s.reading = false; notify(scope);
    } catch (error) { if (valid(scope) && sequence === s.editSequence && !authFailure(scope, error)) { s.reading = false; s.readError = "As condições não foram confirmadas. Consulte as políticas e o horário novamente."; notify(scope); } }
  }
  async function execute(scope: Selection, operation: Attempt) {
    const s = scope.session;
    if (!valid(scope) || s.attempt !== operation || operation.busy) return;
    operation.busy = true; operation.rejected = false; s.status = "submitting"; s.error = null; notify(scope);
    try {
      const c = operation.command;
      const ack = c.kind === "transition" ? await scope.auth.actions.transition(s.id, c.body) : c.kind === "cancel" ? await scope.auth.actions.cancel(s.id, c.body)
        : c.kind === "reschedule" ? await scope.auth.actions.reschedule(s.id, c.body) : await scope.auth.actions.receipt(s.id, c.body);
      if (!valid(scope) || s.attempt !== operation) return;
      operation.ack = ack; await read(scope);
    } catch (error) {
      if (!valid(scope) || s.attempt !== operation || authFailure(scope, error)) return;
      operation.rejected = error instanceof DashboardHttpError && [400, 409, 412, 422].includes(error.status);
      s.status = operation.rejected ? "rejected" : "uncertain"; s.error = operation.rejected ? "Confira os dados atuais antes de tentar outra operação. Seu rascunho foi preservado." : "Sua tentativa foi preservada. O resultado não foi confirmado; repita apenas esta mesma operação."; notify(scope);
    } finally {
      operation.busy = false;
      if (s.attempt === operation && s.status === "submitting") { s.status = "uncertain"; s.error = "Sua tentativa foi preservada. Volte a esta operação para conferir o resultado."; }
      if (mounted.current && currentAuth.current === scope.auth && current.current?.session === s) render(value => value + 1);
    }
  }
  async function start(command: FrozenCommand) { if (!edit(selection)) return; const scope = selection, s = scope.session; const operation: Attempt = { command: structuredClone(command), ack: null, busy: false, rejected: false }; s.attempt = operation; s.editSequence++; s.editController?.abort(); await execute(scope, operation); }
  async function transition(action: AttendanceAction) { if (edit(selection) && selection.session.summary?.attendanceActions.includes(action) && selection.session.detail) await start({ kind: "transition", body: { commandId: createIdempotencyKey(), expectedVersion: selection.session.detail.version, action } }); }
  async function cancel() { if (!edit(selection)) return; const s = selection.session; if (s.mode !== "cancel" || !s.detail || !s.summary?.canReviewCancellation || !s.policies || !s.draft.accepted) return; await start({ kind: "cancel", body: { commandId: createIdempotencyKey(), operatorRequestId: createIdempotencyKey(), expectedVersion: s.detail.version, policyHash: s.policies.hash } }); }
  async function reschedule() { if (!edit(selection)) return; const s = selection.session, quote = s.preview; if (s.mode !== "reschedule" || !s.summary?.canReviewRescheduling || !s.detail || !s.policies || !quote || !s.draft.accepted || quote.requiresSeparateFinancialReview || quote.quote.policyHash !== s.policies.hash || quote.quote.version !== s.detail.version) return;
    try { const selected = destination(selection); if (selected.professionalId !== quote.quote.professionalId || selected.expectedProfessionalVersion !== quote.quote.professionalVersion || selected.startsAt !== quote.quote.startsAt) throw Error("destination_changed");
      await start({ kind: "reschedule", body: { commandId: createIdempotencyKey(), operatorRequestId: createIdempotencyKey(), expectedVersion: s.detail.version, destination: selected, policyHash: quote.quote.policyHash, acceptedQuoteHash: quote.quoteHash } });
    } catch { s.readError = "Consulte novamente as condições da remarcação."; notify(selection); }
  }
  async function receipt() { if (!edit(selection)) return; const s = selection.session, balance = s.summary?.localPayments.find(row => row.paymentId === s.draft.paymentId); if (s.mode !== "receipt" || !s.draft.accepted || !balance?.canRecordReceipt || balance.balanceStatus !== "available" || !balance.remainingCents || !s.draft.paymentMethod.trim()) return;
    if (s.draft.paymentMethod.length > 64 || /[\x00-\x1f\x7f]/.test(s.draft.paymentMethod)) { s.readError = "Informe uma forma de recebimento válida, com até 64 caracteres."; notify(selection); return; }
    await start({ kind: "receipt", body: { commandId: createIdempotencyKey(), paymentId: balance.paymentId, expectedPaymentVersion: balance.paymentVersion, amountCents: balance.remainingCents, currency: balance.currency, paymentMethod: s.draft.paymentMethod.trim() } });
  }
  async function retry() { if (valid(selection) && visible.current) { const operation = selection.session.attempt; if (operation && !operation.ack && !operation.rejected) await execute(selection, operation); } }
  async function reload() { if (!valid(selection) || !visible.current || selection.session.attempt?.busy) return; const operation = selection.session.attempt; if (operation && !operation.ack && !operation.rejected) return; await read(selection); }
  async function loadMoreProfessionals() { if (edit(selection)) await currentData.current.loadMoreProfessionals(); }
  const blocked: Status | null = auth && (expired.current === auth ? "unauthorized" : denied.current === auth ? "forbidden" : null);
  const s = selection?.session, readable = !!selection && !blocked && valid(selection), status: Status = blocked ?? (readable ? s!.status : "forbidden");
  return { status, allowed: readable, detail: readable ? s!.detail : null, summary: readable ? s!.summary : null, mode: readable ? s!.mode : "detail" as Mode,
    draft: readable ? s!.draft : newSession("").draft, policies: readable ? s!.policies : null, preview: readable ? s!.preview : null, dates: readable ? s!.dates : null, slots: readable ? s!.slots : null,
    reading: readable && s!.reading, error: readable ? s!.error : null, readError: readable ? s!.readError : null, locked: status !== "ready",
    professionals: readable ? data.rows.filter(row => row.merchantId === auth!.merchantId && row.isActive && row.isPublished && row.services.some(link => link.productId === s!.detail?.productId)) : [], professionalHasMore: !!data.nextCursor,
    update, reload, retry, transition, openCancellation, openReschedule, openReceipt, back, loadDates, selectDate, previewQuote: preview, cancel, reschedule, receipt, loadMoreProfessionals };
}
