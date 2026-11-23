import type { ServiceAttendanceErrorKind } from "../../api/endpoints/service-attendance.js";

interface CommandState {
  readonly status: "idle" | "pending" | "error" | "conflict" | "uncertain";
  readonly id: string | null;
  readonly appointmentId: string | null;
  readonly expectedVersion: number | null;
  readonly fenced: boolean;
  readonly issue?: ServiceAttendanceErrorKind;
}
/** The future T41 adapter owns the snapshot's shape and authorization. This
 * reducer only tracks a scoped selection and opaque canonical results. */
export interface AppointmentQueryState<T extends object> {
  readonly scope: string | null;
  readonly queryKey: string | null;
  readonly epoch: number;
  readonly phase: "unavailable" | "loading" | "ready" | "error";
  readonly snapshot: T | null;
  readonly issue?: ServiceAttendanceErrorKind;
  readonly lastReadId: number;
  readonly read: { requestId: number; reconcile: boolean } | null;
  readonly command: CommandState;
}
export type AppointmentQueryAction<T extends object> =
  | { type: "select"; scope: string | null; queryKey: string }
  | { type: "read_started"; epoch: number; requestId: number; reconcile?: boolean }
  | { type: "read_succeeded"; epoch: number; requestId: number; value: T }
  | { type: "read_failed"; epoch: number; requestId: number; kind: ServiceAttendanceErrorKind }
  | { type: "command_started"; epoch: number; commandId: string; appointmentId: string; expectedVersion: number }
  | { type: "command_succeeded"; epoch: number; commandId: string; value: T }
  | { type: "command_failed"; epoch: number; commandId: string; kind: ServiceAttendanceErrorKind };

const idleCommand = (): CommandState => ({ status: "idle", id: null, appointmentId: null, expectedVersion: null, fenced: false });
const positive = (value: number) => Number.isSafeInteger(value) && value > 0;
const id = (value: string) => !!value && value.trim() === value && value.length <= 191;
export function createAppointmentQueryState<T extends object>(): AppointmentQueryState<T> {
  return { scope: null, queryKey: null, epoch: 0, phase: "unavailable", snapshot: null, lastReadId: 0, read: null, command: idleCommand() };
}

/** No transport, timer, permission derivation, optimistic financial mutation
 * or automatic retry. Only the caller's matching canonical result can win. */
export function reduceAppointmentQuery<T extends object>(state: AppointmentQueryState<T>, action: AppointmentQueryAction<T>): AppointmentQueryState<T> {
  if (action.type === "select") {
    const scope = action.scope || null, queryKey = scope === null ? null : action.queryKey;
    if (scope === state.scope && queryKey === state.queryKey) return state;
    return { ...createAppointmentQueryState<T>(), scope, queryKey, epoch: state.epoch + 1 };
  }
  if (action.epoch !== state.epoch || state.scope === null) return state;
  switch (action.type) {
    case "read_started":
      if (!positive(action.requestId) || action.requestId <= state.lastReadId || state.command.status === "pending") return state;
      return { ...state, phase: "loading", issue: undefined, lastReadId: action.requestId,
        read: { requestId: action.requestId, reconcile: action.reconcile === true } };
    case "read_succeeded":
      if (state.read?.requestId !== action.requestId) return state;
      return { ...state, phase: "ready", snapshot: action.value, issue: undefined, read: null,
        command: state.read.reconcile ? idleCommand() : state.command };
    case "read_failed":
      if (state.read?.requestId !== action.requestId) return state;
      return { ...state, phase: "error", issue: action.kind, read: null };
    case "command_started":
      if (state.phase !== "ready" || state.snapshot === null || state.command.status === "pending" || state.command.fenced
        || !id(action.commandId) || !id(action.appointmentId) || !positive(action.expectedVersion)) return state;
      return { ...state, read: null, command: { status: "pending", id: action.commandId, appointmentId: action.appointmentId,
        expectedVersion: action.expectedVersion, fenced: false } };
    case "command_succeeded":
      if (state.command.status !== "pending" || state.command.id !== action.commandId) return state;
      return { ...state, phase: "ready", snapshot: action.value, issue: undefined, command: idleCommand() };
    case "command_failed": {
      if (state.command.status !== "pending" || state.command.id !== action.commandId) return state;
      const uncertain = action.kind === "network" || action.kind === "invalid_response", conflict = action.kind === "conflict";
      return { ...state, command: { ...state.command, status: conflict ? "conflict" : uncertain ? "uncertain" : "error",
        fenced: conflict || uncertain, issue: action.kind } };
    }
  }
}
