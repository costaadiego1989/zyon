/** @vitest-environment jsdom */
import React, { act } from "react";
import { describe, expect, it } from "vitest";
import { AppointmentDetailDrawer } from "./AppointmentDetailDrawer.js";
import { useAppointmentDetail, type AppointmentDetailProps } from "./useAppointmentDetail.js";
import { detailFixture, operationPolicies } from "./appointment-detail.test-fixture.js";
import { manualButton, manualClick, manualEnter, manualSelect, manualMe } from "./manual-appointment.test-fixture.js";

function deferred() { let resolve!: (value: Response) => void; const promise = new Promise<Response>(done => { resolve = done; }); return { promise, resolve }; }
const policyResponse = (hash = "a".repeat(64)) => Response.json({ ...operationPolicies(), hash });
const professionals = () => Response.json({ items: ["professional-a", "professional-b"].map(id => ({ id, merchantId: "merchant-a", publicName: id,
  publicProfile: {}, version: 7, timeZone: "America/Sao_Paulo", isActive: true, isPublished: true,
  services: [{ id: `link-${id}`, productId: "service-a", version: 1 }], createdAt: "2026-01-01T00:00Z", updatedAt: "2026-01-01T00:00Z" })), nextCursor: null });

describe("T80 destination edits during the canonical policy read", () => {
  it.each(["professional-a", "professional-b"])("keeps the pending policy read when selecting %s and changing dates", async professionalId => {
    const pending = deferred();
    const f = await detailFixture(AppointmentDetailDrawer, { handle: row => row.path.endsWith("/operation-policy") ? pending.promise
      : row.path.endsWith("/service-professionals") ? professionals() : undefined });
    await manualClick("Remarcar");
    expect(manualButton("Consultar novas datas").disabled).toBe(true);
    await manualSelect("Novo profissional", professionalId);
    await manualEnter("Consultar de", "2030-01-03");
    await manualEnter("Consultar at\u00e9", "2030-01-03");
    expect(f.requests.filter(row => row.path.endsWith("/operation-policy"))).toHaveLength(1);
    expect(manualButton("Consultar novas datas").disabled).toBe(true);
    await act(async () => pending.resolve(policyResponse()));
    expect(document.body.textContent).toContain(operationPolicies().policies[0].text);
    expect(manualButton("Consultar novas datas").disabled).toBe(false);
    await manualClick("Consultar novas datas");
    const reads = f.requests.filter(row => row.path.endsWith("/service-availability/dates"));
    expect(reads).toHaveLength(1);
    expect(Object.fromEntries(reads[0].query)).toMatchObject({ professionalId, fromDate: "2030-01-03", toDate: "2030-01-03" });
    expect(manualButton("Conferir remarca\u00e7\u00e3o").disabled).toBe(true);
    expect(document.body.querySelector('option[value="2030-01-03"]')).not.toBeNull();
    expect(f.commands()).toEqual([]);
  });

  it.each(["selected ID ABA", "merchant ABA", "close/reopen"])("still fences an old pending policy after %s", async context => {
    const pending = [deferred(), deferred()]; let calls = 0, latest!: ReturnType<typeof useAppointmentDetail>;
    function Probe(props: AppointmentDetailProps) { latest = useAppointmentDetail(props); return <div />; }
    const f = await detailFixture(Probe, { handle: row => row.path.endsWith("/operation-policy") ? pending[calls++].promise : undefined });
    let oldRead!: Promise<void>, currentRead!: Promise<void>;
    await act(async () => { oldRead = latest.openReschedule(); });
    await act(async () => latest.update({ professionalId: "professional-a", fromDate: "2030-01-03", toDate: "2030-01-03" }));
    if (context === "selected ID ABA") { await f.select("appointment-b"); await f.select("appointment-a"); }
    else if (context === "merchant ABA") { await f.render({ ...manualMe, id: "merchant-b", user_id: "owner-b" }); await f.render(manualMe); }
    else { await f.render(manualMe, false); await f.render(manualMe, true); }
    await act(async () => { currentRead = latest.openReschedule(); });
    expect(calls).toBe(2);
    await act(async () => { pending[0].resolve(policyResponse()); await oldRead; });
    expect(latest.policies).toBeNull();
    expect(latest.reading).toBe(true);
    await act(async () => { pending[1].resolve(policyResponse("c".repeat(64))); await currentRead; });
    expect(latest.policies?.hash).toBe("c".repeat(64));
    expect(latest.reading).toBe(false);
    expect(f.commands()).toEqual([]);
  });

  it("cannot let a pending policy replace the state of a pending financial command", async () => {
    const policy = deferred(), receipt = deferred(); let latest!: ReturnType<typeof useAppointmentDetail>;
    function Probe(props: AppointmentDetailProps) { latest = useAppointmentDetail(props); return <div />; }
    const f = await detailFixture(Probe, { handle: row => row.path.endsWith("/operation-policy") ? policy.promise
      : row.path.endsWith("/attendance-receipts") ? receipt.promise : undefined });
    let policyRead!: Promise<void>, command!: Promise<void>;
    await act(async () => { policyRead = latest.openReschedule(); });
    await act(async () => { latest.openReceipt("balance-a"); latest.update({ paymentMethod: "Pix presencial", accepted: true }); command = latest.receipt(); });
    expect(latest.status).toBe("submitting");
    await act(async () => { policy.resolve(policyResponse()); await policyRead; });
    expect(latest.policies).toBeNull();
    expect(latest.mode).toBe("receipt");
    expect(latest.status).toBe("submitting");
    expect(latest.locked).toBe(true);
    expect(f.commands()).toHaveLength(1);
    await act(async () => { receipt.resolve(Response.json({}, { status: 503 })); await command; });
    expect(latest.status).toBe("uncertain");
    expect(f.commands()).toHaveLength(1);
  });
});
