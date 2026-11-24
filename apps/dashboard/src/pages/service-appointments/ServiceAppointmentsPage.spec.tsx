/** @vitest-environment jsdom */
import React, { act } from "react";
import { describe, expect, it, vi } from "vitest";
import { ServiceAppointmentsPage } from "./ServiceAppointmentsPage.js";
import { detailFixture } from "../service-attendance/components/appointment-detail.test-fixture.js";
import { manualMe, manualDetail, manualButton, manualClick, manualEnter, manualSelect } from "../service-attendance/components/manual-appointment.test-fixture.js";
import type { AppointmentDetailProps } from "../service-attendance/components/useAppointmentDetail.js";

async function pageFixture() {
  let initial = true;
  function Page(props: AppointmentDetailProps) { if (initial) { initial = false; window.history.replaceState(null, "", "/#service-appointments?fromDate=2030-01-01&toDate=2030-01-03"); } return <ServiceAppointmentsPage me={props.me} />; }
  const f = await detailFixture(Page, { handle: request => {
    if (request.method !== "GET" || !request.path.endsWith("/service-appointments")) return undefined;
    const next = request.query.has("cursor"), record = { ...manualDetail("at_attendance"), id: next ? "appointment-b" : "appointment-a", merchantId: /\/merchants\/([^/]+)/.exec(request.path)?.[1] ?? "merchant-a", history: undefined, historyPartial: undefined, asOf: undefined };
    return Response.json({ items: [record], totalCount: 10, nextCursor: next ? null : "next_page", countsByStatus: { pending: 0, scheduled: 10, in_service: 0, completed: 0, no_show: 0, cancelled: 0 }, asOf: "2030-01-01T12:00Z", timeZone: "America/Sao_Paulo" });
  } });
  return { ...f, pages: () => f.requests.filter(row => row.method === "GET" && row.path.endsWith("/service-appointments")) };
}
describe("T103 actual appointment page composition", () => {
  it("keeps canonical totals/IDs in list and Kanban without refetching on presentation changes", async () => { const f = await pageFixture(); expect(document.body.textContent).toContain("1 de 10 agendamentos nesta página"); expect(document.querySelector('[data-appointment-id="appointment-a"]')).not.toBeNull(); const count = f.pages().length; await manualClick("Lista"); expect(document.querySelector('[data-appointment-id="appointment-a"]')).not.toBeNull(); expect(f.pages()).toHaveLength(count); expect(f.commands()).toEqual([]); });
  it("applies canonical filters and period and resets pagination rather than changing board IDs in memory", async () => { const f = await pageFixture(); await manualSelect("Etapa do atendimento", "scheduled"); await manualEnter("De", "2030-01-02"); await manualEnter("Até", "2030-01-03"); await manualClick("Aplicar filtros"); expect(Object.fromEntries(f.pages().at(-1)!.query)).toMatchObject({ fromDate: "2030-01-02", toDate: "2030-01-03", status: "scheduled" }); expect(f.pages().at(-1)!.query.has("cursor")).toBe(false); expect(f.commands()).toEqual([]); });
  it("uses the exact server cursor and first-page read while preserving the total", async () => { const f = await pageFixture(); await manualClick("Próxima página"); expect(f.pages().at(-1)!.query.get("cursor")).toBe("next_page"); expect(document.querySelector('[data-appointment-id="appointment-b"]')).not.toBeNull(); expect(document.body.textContent).toContain("1 de 10"); await manualClick("Primeira página"); expect(f.pages().at(-1)!.query.has("cursor")).toBe(false); });
  it("Ver detalhes opens the real canonical detail/summary drawer", async () => { const f = await pageFixture(); await manualClick("Lista"); await manualClick("Ver detalhes"); await act(async () => { await vi.dynamicImportSettled(); }); expect(document.querySelector('[role="dialog"]')?.textContent).toContain("Detalhes do agendamento"); expect(f.requests.some(row => row.path.endsWith("/appointment-a/operation-summary"))).toBe(true); expect(f.commands()).toEqual([]); });
  it("manual booking opens the actual T79 form without an automatic command", async () => { const f = await pageFixture(); await manualClick("Novo agendamento"); await act(async () => { await vi.dynamicImportSettled(); }); expect(document.querySelector('[role="dialog"]')?.textContent).toContain("Nome do contato"); expect(f.commands()).toEqual([]); expect(f.requests.some(row => row.method === "POST" && row.path.endsWith("/manual"))).toBe(false); });
  it("history link follows existing shipment plan restrictions", async () => { const f = await pageFixture(); await f.render({ ...manualMe, plan: "API" }); expect(document.querySelector('a[href="#shipments"]')).toBeNull(); await f.render({ ...manualMe, plan: "BOTH" }); expect(document.querySelector('a[href="#shipments"]')).not.toBeNull(); });
  it.each([{ ...manualMe, role: "STAFF" as const }, { ...manualMe, businessMode: "products" as const }, null])("denies service page reads and controls outside the service-management scope %j", async me => { const f = await pageFixture(); const before = f.pages().length; await f.render(me); expect(manualButton("Novo agendamento")).toBeUndefined(); expect(document.querySelector('[data-appointment-id]')).toBeNull(); expect(f.pages()).toHaveLength(before); });
});
