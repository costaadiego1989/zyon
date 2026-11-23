import { useEffect, useMemo, useRef, useState } from "react";
import type { ServiceAppointmentAdminListQuery } from "@zyon/shared-types";
import type { MerchantProfile } from "../../api-client.js";
import { useApi } from "../../hooks/useApi.js";
import { canManageServiceAttendance } from "../../lib/auth/permissions.js";
import { appointmentReadQuery, type ServiceAppointmentsApi } from "../../api/endpoints/service-appointments.js";
import { classifyServiceAttendanceError, type ServiceAttendanceErrorKind } from "../../api/endpoints/service-attendance.js";
import { DashboardJsonParseError } from "../../api/http/error.js";
import { SESSION_EXPIRED_EVENT } from "../../api/http/client.js";
import { readAppointmentSnapshot, type AppointmentReadSnapshot } from "./appointment-read-snapshot.js";

type Query = Omit<ServiceAppointmentAdminListQuery, "cursor">;
interface Context { merchantId: string; client: ServiceAppointmentsApi }
interface Load {
  context: Context | null;
  queryKey: string | null;
  cursor?: string;
  status: "forbidden" | "unauthorized" | "invalid" | "loading" | "ready" | "error";
  snapshot: AppointmentReadSnapshot | null;
  issue?: ServiceAttendanceErrorKind;
}

/** No mutation or automatic retry. Every visible page is a canonical read. */
export function useServiceAppointments({ me, query }: { me: MerchantProfile | null; query: Query }) {
  const api = useApi(), allowed = canManageServiceAttendance(me);
  const context = useMemo<Context | null>(() => allowed && me ? { merchantId: me.id, client: api.serviceAppointments(me) } : null,
    [api, allowed, me?.id, me?.user_id, me?.role]);
  let input: ServiceAppointmentAdminListQuery | null = null;
  try { input = appointmentReadQuery({ ...query, cursor: undefined }); } catch { /* Invalid selection has no request or data. */ }
  const queryKey = input ? JSON.stringify(input) : null;
  const current = useRef({ context, queryKey }); current.current = { context, queryKey };
  const mounted = useRef(true), sequence = useRef(0), reading = useRef<AbortController | null>(null);
  const expiredFor = useRef<Context | null>(null);
  const [load, setLoad] = useState<Load>({ context: null, queryKey: null, status: "forbidden", snapshot: null });
  const latest = useRef(load); latest.current = load;
  const isCurrent = () => mounted.current && context !== null && current.current.context === context
    && current.current.queryKey === queryKey && expiredFor.current !== context;

  async function readPage(cursor?: string): Promise<boolean> {
    if (!context || !input || !isCurrent()) return false;
    const selected = { ...input, ...(cursor ? { cursor } : {}) }, request = ++sequence.current;
    reading.current?.abort(); const controller = new AbortController(); reading.current = controller;
    setLoad(previous => ({ context, queryKey, cursor, status: "loading",
      snapshot: previous.context === context && previous.queryKey === queryKey ? previous.snapshot : null }));
    try {
      const result = await context.client.list(selected, { signal: controller.signal });
      if (!isCurrent() || request !== sequence.current) return false;
      const snapshot = readAppointmentSnapshot(context.merchantId, selected, result);
      if (!snapshot) throw new DashboardJsonParseError("invalid_service_appointments_snapshot");
      setLoad({ context, queryKey, cursor, status: "ready", snapshot });
      return true;
    } catch (error) {
      if (!isCurrent() || request !== sequence.current) return false;
      const issue = classifyServiceAttendanceError(error);
      setLoad(previous => ({ context, queryKey, cursor, status: "error", issue,
        snapshot: issue !== "unauthorized" && issue !== "forbidden" && previous.context === context && previous.queryKey === queryKey ? previous.snapshot : null }));
      return false;
    }
  }

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; reading.current?.abort(); sequence.current++; };
  }, []);
  useEffect(() => {
    const expire = () => {
      const scope = current.current.context;
      if (!scope) return;
      expiredFor.current = scope;
      reading.current?.abort(); sequence.current++;
      setLoad({ context: scope, queryKey: current.current.queryKey, status: "unauthorized", snapshot: null, issue: "unauthorized" });
    };
    window.addEventListener(SESSION_EXPIRED_EVENT, expire);
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, expire);
  }, []);
  useEffect(() => {
    void readPage();
    return () => { reading.current?.abort(); sequence.current++; };
    // Context includes API, authenticated merchant/user and management access.
  }, [context, queryKey]);

  const state: Load = !context ? { context: null, queryKey, status: "forbidden", snapshot: null }
    : expiredFor.current === context ? { context, queryKey, status: "unauthorized", snapshot: null, issue: "unauthorized" }
    : !input ? { context, queryKey, status: "invalid", snapshot: null, issue: "invalid" }
    : load.context === context && load.queryKey === queryKey ? load : { context, queryKey, status: "loading", snapshot: null };
  return { allowed, status: state.status, snapshot: state.snapshot, issue: state.issue,
    refresh: () => readPage(latest.current.context === context && latest.current.queryKey === queryKey ? latest.current.cursor : undefined),
    firstPage: () => readPage(),
    nextPage: () => isCurrent() && latest.current.context === context && latest.current.queryKey === queryKey
      && latest.current.status === "ready" && latest.current.snapshot?.page.nextCursor
      ? readPage(latest.current.snapshot.page.nextCursor) : Promise.resolve(false),
  };
}
