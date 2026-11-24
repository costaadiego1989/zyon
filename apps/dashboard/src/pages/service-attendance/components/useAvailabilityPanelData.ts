import { useEffect, useMemo, useRef, useState } from "react";
import type { MerchantProfile } from "../../../api-client.js";
import type { ServiceProfessionalAvailabilityDTO, ServiceAvailabilityExceptionDTO } from "../../../api/endpoints/service-attendance.js";
import { useApi } from "../../../hooks/useApi.js";
import { canManageServiceAttendance } from "../../../lib/auth/permissions.js";
import type { useServiceAttendancePage } from "../useServiceAttendancePage.js";
import { useProfessionalsPanelData } from "./useProfessionalsPanelData.js";

type ViewModel = ReturnType<typeof useServiceAttendancePage>;
interface GradeState { context: object | null; status: "idle" | "loading" | "ready" | "error"; value: ServiceProfessionalAvailabilityDTO | null }
function validGrade(value: ServiceProfessionalAvailabilityDTO, merchantId: string, professionalId: string) {
  if (!value || value.professionalId !== professionalId || !Number.isSafeInteger(value.version) || value.version < 1
    || typeof value.timeZone !== "string" || !value.timeZone || value.timeZone.length > 80
    || !Array.isArray(value.rows) || value.rows.length > 100 || !Array.isArray(value.exceptions)
    || value.nextCursor !== null && (typeof value.nextCursor !== "string" || !value.nextCursor || value.nextCursor.length > 191)) throw new Error("invalid_availability_response");
  new Intl.DateTimeFormat("en-CA", { timeZone: value.timeZone });
  if (value.rows.some(row => row.merchantId !== merchantId || row.professionalId !== professionalId || !row.isActive
    || !Number.isInteger(row.weekday) || row.weekday < 0 || row.weekday > 6 || !Number.isInteger(row.startMinute) || !Number.isInteger(row.endMinute)
    || row.startMinute < 0 || row.endMinute > 1440 || row.startMinute >= row.endMinute)) throw new Error("invalid_recurring_response");
  for (const row of value.rows) new Intl.DateTimeFormat("en-CA", { timeZone: row.timeZone });
  for (const row of value.exceptions) new Intl.DateTimeFormat("en-CA", { timeZone: row.timeZone });
  if (value.exceptions.some(row => !row.id || row.merchantId !== merchantId || row.professionalId !== professionalId || !row.isActive
    || !["one_off", "block"].includes(row.kind) || !Number.isSafeInteger(row.version) || row.version < 1
    || !Number.isFinite(Date.parse(row.startsAt)) || !Number.isFinite(Date.parse(row.endsAt)) || Date.parse(row.startsAt) >= Date.parse(row.endsAt)
    || typeof row.timeZone !== "string" || row.reason !== null && typeof row.reason !== "string")) throw new Error("invalid_exception_response");
}
export function useAvailabilityPanelData(me: MerchantProfile | null, vm: ViewModel) {
  const api = useApi(), professionals = useProfessionalsPanelData(me, vm);
  const allowed = vm.allowed && canManageServiceAttendance(me), id = vm.filters.professionalId;
  const professional = professionals.rows.find(row => row.id === id && row.merchantId === me?.id) ?? null;
  const context = useMemo(() => allowed && me && professional ? { merchantId: me.id, professionalId: id, client: api.serviceAttendance(me) } : null,
    [api, allowed, me?.id, me?.user_id, me?.role, me?.businessMode, me?.businessModeSelectionState, id, Boolean(professional), professional?.isActive]);
  const current = useRef(context); current.current = context;
  const mounted = useRef(true), generation = useRef(0), reading = useRef<{ context: object } | null>(null);
  const [grade, setGrade] = useState<GradeState>({ context: null, status: "idle", value: null });
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; generation.current++; }; }, []);
  const valid = (scope: NonNullable<typeof context>) => mounted.current && current.current === scope;
  const visible = grade.context === context ? grade : { context, status: "idle" as const, value: null };
  async function read(minimumVersion?: number): Promise<boolean> {
    const scope = context;
    if (!scope || !valid(scope) || reading.current?.context === scope) return false;
    const token = { context: scope }, sequence = ++generation.current; reading.current = token;
    setGrade({ context: scope, status: "loading", value: visible.value });
    try {
      const exceptions = new Map<string, ServiceAvailabilityExceptionDTO>(), cursors = new Set<string>();
      let cursor: string | undefined, first: ServiceProfessionalAvailabilityDTO | null = null;
      do {
        if (!valid(scope) || generation.current !== sequence) return false;
        const page = await scope.client.getProfessionalAvailability(scope.professionalId, cursor ? { cursor } : {});
        if (!valid(scope) || generation.current !== sequence) return false;
        validGrade(page, scope.merchantId, scope.professionalId);
        if (first && (first.version !== page.version || first.timeZone !== page.timeZone || JSON.stringify(first.rows) !== JSON.stringify(page.rows))) throw new Error("availability_changed_during_pagination");
        first ??= page;
        for (const row of page.exceptions) {
          const previous = exceptions.get(row.id);
          if (previous && JSON.stringify(previous) !== JSON.stringify(row)) throw new Error("availability_exception_changed");
          exceptions.set(row.id, row);
        }
        if (page.nextCursor === null) break;
        if (cursors.has(page.nextCursor)) throw new Error("availability_cursor_did_not_advance");
        cursors.add(page.nextCursor); cursor = page.nextCursor;
      } while (cursor !== undefined);
      if (minimumVersion !== undefined && (!Number.isSafeInteger(minimumVersion) || minimumVersion < 1 || first!.version < minimumVersion)) throw new Error("availability_read_older_than_write");
      setGrade({ context: scope, status: "ready", value: { ...first!, exceptions: [...exceptions.values()], nextCursor: null } });
      return true;
    } catch {
      if (valid(scope) && generation.current === sequence) setGrade({ context: scope, status: "error", value: visible.value });
      return false;
    } finally { if (reading.current === token) reading.current = null; }
  }
  return { allowed, context, professional, professionals, grade: visible, read,
    canEdit: Boolean(context && professional?.isActive && visible.status === "ready" && vm.command.status !== "saving" && vm.command.status !== "conflict" && vm.command.status !== "uncertain" && vm.loadState.status !== "loading") };
}
