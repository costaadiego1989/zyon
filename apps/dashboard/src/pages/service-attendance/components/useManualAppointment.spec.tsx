/** @vitest-environment jsdom */
import React, { act } from "react";
import { describe, expect, it } from "vitest";
import { useManualAppointment } from "./useManualAppointment.js";
import { SESSION_EXPIRED_EVENT } from "../../../api/http/client.js";
import { manualFixture, manualMe, type ManualTestProps } from "./manual-appointment.test-fixture.js";

describe("T79 manual controller context and read epochs", () => {
  it("retained callbacks from a previous merchant cannot read customers or submit for a new scope", async () => {
    let latest!: ReturnType<typeof useManualAppointment>;
    function Probe(props: ManualTestProps) { latest = useManualAppointment(props); return <div>{latest.status}</div>; }
    const f = await manualFixture(Probe), old = latest;
    await f.render({ ...manualMe, id: "merchant-b", user_id: "owner-b" }); const before = f.requests.length;
    await act(async () => { await old.loadCustomers(); await old.submit(); await old.retry(); }); expect(f.requests).toHaveLength(before); expect(f.writes()).toEqual([]);
  });
  it("SESSION_EXPIRED_EVENT fences retained read and write callbacks even before props are cleared", async () => {
    let latest!: ReturnType<typeof useManualAppointment>;
    function Probe(props: ManualTestProps) { latest = useManualAppointment(props); return <div>{latest.status}</div>; }
    const f = await manualFixture(Probe), old = latest; await act(async () => window.dispatchEvent(new CustomEvent(SESSION_EXPIRED_EVENT))); const before = f.requests.length;
    await act(async () => { await old.loadCustomers(); await old.submit(); await old.retry(); await old.reconcileDetail(); }); expect(f.requests).toHaveLength(before); expect(latest.status).toBe("unauthorized"); expect(latest.customers).toEqual([]);
  });
  it("a late customer read from a previous authenticated context cannot expose old private choices", async () => {
    let release!: (value: Response) => void, latest!: ReturnType<typeof useManualAppointment>;
    const deferred = new Promise<Response>(resolve => { release = resolve; });
    function Probe(props: ManualTestProps) { latest = useManualAppointment(props); return <div>{latest.customers.map(row => row.id).join(",")}</div>; }
    const f = await manualFixture(Probe, { handle: value => value.path.endsWith("/customers") ? deferred : undefined });
    let pending!: Promise<void>; await act(async () => { pending = latest.loadCustomers(); }); await f.render({ ...manualMe, id: "merchant-b", user_id: "owner-b" });
    await act(async () => { release(Response.json({ data: [{ id: "old-private-buyer", profile: { fullName: "Old private name" }, first_seen_at: "2026-01-01T00:00Z", last_seen_at: "2026-01-02T00:00Z" }], next_cursor: null, has_more: false })); await pending; });
    expect(latest.customers).toEqual([]); expect(f.host.textContent).not.toContain("old-private-buyer"); expect(f.writes()).toEqual([]);
  });
  it("unmount invalidates retained callbacks before any later HTTP request", async () => {
    let latest!: ReturnType<typeof useManualAppointment>;
    function Probe(props: ManualTestProps) { latest = useManualAppointment(props); return <div />; }
    const f = await manualFixture(Probe), old = latest; await act(async () => f.root.unmount()); const before = f.requests.length;
    await act(async () => { await old.loadCustomers(); await old.submit(); await old.retry(); }); expect(f.requests).toHaveLength(before);
  });
  it("a late calendar result cannot repopulate the choices after changing the professional selector", async () => {
    let release!: (value: Response) => void, latest!: ReturnType<typeof useManualAppointment>;
    const deferred = new Promise<Response>(resolve => { release = resolve; });
    function Probe(props: ManualTestProps) { latest = useManualAppointment(props); return <div />; }
    const f = await manualFixture(Probe, { handle: value => value.path.endsWith("/service-availability/dates") ? deferred : undefined });
    await act(async () => latest.update({ productId: "service-a" })); await act(async () => latest.update({ professionalId: "professional-a" }));
    let pending!: Promise<void>; await act(async () => { pending = latest.loadDates(); }); await act(async () => latest.update({ professionalId: "" }));
    await act(async () => { release(Response.json({ status: "ready", professionalVersion: 7, policyVersion: 3, timeZone: "America/Sao_Paulo", durationMinutes: 30, asOf: "2030-01-01T12:00:00Z", dates: ["2030-01-02"] })); await pending; });
    expect(latest.draft.professionalId).toBe(""); expect(latest.dates).toBeNull(); expect(latest.slots).toBeNull(); expect(f.writes()).toEqual([]);
  });
  it("a customer denial clears PII and fences retained callbacks without a replacement command", async () => {
    let latest!: ReturnType<typeof useManualAppointment>;
    function Probe(props: ManualTestProps) { latest = useManualAppointment(props); return <div />; }
    const f = await manualFixture(Probe, { handle: value => value.path.endsWith("/customers") ? Response.json({ code: "tenant_mismatch_query" }, { status: 403 }) : undefined });
    const old = latest; await act(async () => latest.update({ name: "Private contact", phone: "21999990000" })); await act(async () => latest.loadCustomers());
    const count = f.requests.length; await act(async () => { await old.loadCustomers(); await old.submit(); await old.retry(); });
    expect(latest.status).toBe("forbidden"); expect(latest.draft.name).toBe(""); expect(latest.customers).toEqual([]); expect(f.requests).toHaveLength(count); expect(f.writes()).toEqual([]);
  });
});
