import { describe, expect, it } from "vitest";
import { createAppointmentQueryState, reduceAppointmentQuery, type AppointmentQueryState } from "./appointment-query-state.js";

const snapshot = (version = 3) => ({ appointments: [{ id: "appointment-a", version, paymentFacts: [{ status: "pending" }] }], serverMetadata: { count: 71, cursor: "opaque-next" } });
type Snapshot = ReturnType<typeof snapshot>;
function selected() { return reduceAppointmentQuery(createAppointmentQueryState<Snapshot>(), { type: "select", scope: "merchant-a:owner-a", queryKey: "range-a|professional-a|service-a|America/Sao_Paulo|page-a" }); }
function loaded() {
  const initial = selected(), reading = reduceAppointmentQuery(initial, { type: "read_started", epoch: initial.epoch, requestId: 1 });
  return reduceAppointmentQuery(reading, { type: "read_succeeded", epoch: reading.epoch, requestId: 1, value: snapshot() });
}
function command(state: AppointmentQueryState<Snapshot>, id = "command-a", version = 3) {
  return reduceAppointmentQuery(state, { type: "command_started", epoch: state.epoch, commandId: id, appointmentId: "appointment-a", expectedVersion: version });
}

describe("T102 opaque appointment query state", () => {
  it("starts unavailable and never fabricates an empty/paid appointment result", () => {
    expect(createAppointmentQueryState<Snapshot>()).toMatchObject({ phase: "unavailable", snapshot: null, scope: null, queryKey: null, read: null });
  });
  it("retains supplied server metadata verbatim rather than deriving totals from the loaded rows", () => {
    const state = loaded(); expect(state.snapshot).toEqual(snapshot()); expect(state.snapshot?.serverMetadata.count).toBe(71);
  });
  it("drops an old filter/page/timezone response instead of applying it to another query", () => {
    const first = reduceAppointmentQuery(selected(), { type: "read_started", epoch: 1, requestId: 1 });
    const next = reduceAppointmentQuery(first, { type: "select", scope: first.scope, queryKey: "range-b|professional-b|service-b|America/Manaus|page-b" });
    expect(next.snapshot).toBeNull(); expect(reduceAppointmentQuery(next, { type: "read_succeeded", epoch: first.epoch, requestId: 1, value: snapshot() })).toBe(next);
  });
  for (const scope of ["merchant-b:owner-a", "merchant-a:owner-b", null])
    it(`drops pending data after changing scope to ${String(scope)}`, () => {
      const reading = reduceAppointmentQuery(loaded(), { type: "read_started", epoch: 1, requestId: 2 });
      const next = reduceAppointmentQuery(reading, { type: "select", scope, queryKey: "same-query" });
      expect(next.snapshot).toBeNull(); expect(reduceAppointmentQuery(next, { type: "read_succeeded", epoch: reading.epoch, requestId: 2, value: snapshot(99) })).toBe(next);
    });
  it("ignores an older read after a newer response settled", () => {
    let state = loaded(); state = reduceAppointmentQuery(state, { type: "read_started", epoch: state.epoch, requestId: 2 });
    state = reduceAppointmentQuery(state, { type: "read_started", epoch: state.epoch, requestId: 3 });
    state = reduceAppointmentQuery(state, { type: "read_succeeded", epoch: state.epoch, requestId: 3, value: snapshot(4) });
    expect(reduceAppointmentQuery(state, { type: "read_succeeded", epoch: state.epoch, requestId: 2, value: snapshot(2) })).toBe(state);
  });
  it("retains the exact prior snapshot on a failed refresh", () => {
    const ready = loaded(), reading = reduceAppointmentQuery(ready, { type: "read_started", epoch: ready.epoch, requestId: 2 });
    const failed = reduceAppointmentQuery(reading, { type: "read_failed", epoch: reading.epoch, requestId: 2, kind: "network" });
    expect(failed.phase).toBe("error"); expect(failed.snapshot).toBe(ready.snapshot); expect(failed.issue).toBe("network");
  });
  for (const kind of ["conflict", "network", "invalid_response"] as const)
    it(`preserves appointment/version/finance and fences another command after ${kind}`, () => {
      const before = loaded(), pending = command(before), failed = reduceAppointmentQuery(pending, { type: "command_failed", epoch: pending.epoch, commandId: "command-a", kind });
      expect(failed.snapshot).toBe(before.snapshot); expect(failed.command).toMatchObject({ expectedVersion: 3, appointmentId: "appointment-a", fenced: true });
      expect(command(failed, "command-b")).toBe(failed);
    });
  it("retains a correctable rejection without automatically retrying or changing the expectedVersion", () => {
    const before = loaded(), pending = command(before), failed = reduceAppointmentQuery(pending, { type: "command_failed", epoch: pending.epoch, commandId: "command-a", kind: "invalid" });
    expect(failed.snapshot).toBe(before.snapshot); expect(failed.command).toMatchObject({ status: "error", expectedVersion: 3, fenced: false });
    expect(command(failed, "explicit-new-command").command).toMatchObject({ status: "pending", id: "explicit-new-command", expectedVersion: 3 });
  });
  for (const version of [0, -1, 1.5]) it(`refuses invalid expectedVersion ${version}`, () => {
    const state = loaded(); expect(command(state, "invalid-version", version)).toBe(state);
  });
  it("serializes command tracking and applies only the matching server result", () => {
    const pending = command(loaded()); expect(command(pending, "command-b")).toBe(pending);
    expect(reduceAppointmentQuery(pending, { type: "command_succeeded", epoch: pending.epoch, commandId: "wrong-command", value: snapshot(88) })).toBe(pending);
    const done = reduceAppointmentQuery(pending, { type: "command_succeeded", epoch: pending.epoch, commandId: "command-a", value: snapshot(4) });
    expect(done.snapshot).toEqual(snapshot(4)); expect(done.command.status).toBe("idle");
    expect(reduceAppointmentQuery(done, { type: "read_succeeded", epoch: done.epoch, requestId: 1, value: snapshot(2) })).toBe(done);
  });
  it("does not release an uncertain-command fence on an incidental read", () => {
    const pending = command(loaded()); let state = reduceAppointmentQuery(pending, { type: "command_failed", epoch: pending.epoch, commandId: "command-a", kind: "network" });
    state = reduceAppointmentQuery(state, { type: "read_started", epoch: state.epoch, requestId: 2 });
    state = reduceAppointmentQuery(state, { type: "read_succeeded", epoch: state.epoch, requestId: 2, value: snapshot(4) });
    expect(state.command.fenced).toBe(true);
    state = reduceAppointmentQuery(state, { type: "read_started", epoch: state.epoch, requestId: 3, reconcile: true });
    state = reduceAppointmentQuery(state, { type: "read_succeeded", epoch: state.epoch, requestId: 3, value: snapshot(4) });
    expect(state.command).toMatchObject({ status: "idle", fenced: false });
  });
  it("ignores a previous user's pending command result", () => {
    const pending = command(loaded()), next = reduceAppointmentQuery(pending, { type: "select", scope: "merchant-b:owner-b", queryKey: "new-query" });
    expect(reduceAppointmentQuery(next, { type: "command_succeeded", epoch: pending.epoch, commandId: "command-a", value: snapshot(90) })).toBe(next);
    expect(next.snapshot).toBeNull();
  });
});
