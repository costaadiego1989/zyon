/** @vitest-environment jsdom */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { createDashboardApi, type MerchantProfile } from "../../api-client.js";
import { ApiContext } from "../../hooks/useApi.js";
import { ServiceAttendancePage } from "./ServiceAttendancePage.js";

const me: MerchantProfile = { id: "merchant-a", user_id: "owner-a", name: "A", role: "OWNER", businessMode: "services", businessModeSelectionState: "selected" };
const professional = { id: "professional-a", merchantId: me.id, publicName: "Ana", publicProfile: {}, isActive: true, isPublished: true, timeZone: "America/Sao_Paulo", version: 2, services: [] };
const grade = { professionalId: professional.id, version: 2, timeZone: "America/Sao_Paulo", rows: [{ id: "row-a", merchantId: me.id, professionalId: professional.id, weekday: 1, startMinute: 480, endMinute: 720, timeZone: "America/Sao_Paulo", validFrom: null, validUntil: null, isActive: true, version: 2, createdAt: "2026-11-17T00:00:00.000Z", updatedAt: "2026-11-17T00:00:00.000Z" }], exceptions: [], nextCursor: null };
const mounts: Array<{ root: Root; host: HTMLDivElement }> = [];
afterEach(async () => { for (const { root, host } of mounts.splice(0)) { await act(async () => root.unmount()); host.remove(); } });
async function fixture(options: { tab?: string; current?: MerchantProfile; read?: () => Promise<Response> | Response } = {}) {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  window.history.replaceState(null, "", `/#service-attendance?tab=${options.tab ?? "professionals"}`);
  const calls: Array<{ path: string; method: string }> = [];
  const api = createDashboardApi({ baseUrl: "https://api.example.test", fetchImpl: (async (input, init) => {
    const path = new URL(String(input)).pathname; calls.push({ path, method: init?.method ?? "GET" });
    if (path.endsWith("/service-professionals")) return Response.json({ items: [professional, { ...professional, id: "professional-b", publicName: "Beatriz" }], nextCursor: null });
    if (path.endsWith("/categories")) return Response.json([{ id: "category-a", name: "Saúde", is_active: true, product_count: 2 }]);
    if (path.endsWith("/service-business-policy")) return Response.json({ status: "configured", version: 1, policy: { holdEnabled: false, holdMinutes: null, paymentMode: "at_attendance", admissionsEnabled: false } });
    if (path.endsWith("/availability")) return options.read?.() ?? Response.json(grade);
    throw new Error("unexpected_request");
  }) as typeof fetch });
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host); mounts.push({ root, host });
  await act(async () => root.render(<ApiContext.Provider value={api}><ServiceAttendancePage me={options.current ?? me} /></ApiContext.Provider>));
  return { host, calls };
}
const button = (host: HTMLElement, label: string) => Array.from(host.querySelectorAll<HTMLButtonElement>("button")).find(item => item.textContent?.trim() === label)!;
async function selectProfessional(host: HTMLElement, id = professional.id) { await act(async () => {
  const select = host.querySelector<HTMLSelectElement>('select[aria-label="Profissional"]')!;
  Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(select, id); select.dispatchEvent(new Event("change", { bubbles: true }));
}); }

describe("T75 real read-only panel composition", () => {
  it("composes actual professional names, zones and publication without a second management hook or write", async () => {
    const f = await fixture(); expect(f.host.querySelector('[role="tabpanel"]')?.textContent).toContain("Ana"); expect(f.host.textContent).toContain("America/Sao_Paulo");
    expect(f.calls.filter(call => call.path.endsWith("/service-professionals"))).toHaveLength(1); expect(f.calls.every(call => call.method === "GET")).toBe(true);
  });
  it("shows the actual category snapshot without client-created capacity and with category management", async () => {
    const f = await fixture({ tab: "categories" }); expect(f.host.querySelector('[role="tabpanel"]')?.textContent).toContain("Saúde");
    expect(f.host.textContent).toContain("Ofertas vinculadas: 2"); expect(f.host.textContent).not.toMatch(/capacidade: 2/); expect(button(f.host, "Nova categoria")).toBeDefined();
  });
  it("presents financial policy choices separately from a payment or booking result", async () => {
    const f = await fixture({ tab: "settings" }); expect(f.host.textContent).toContain("Pagamento no atendimento"); expect(f.host.textContent).toContain("Novos agendamentos: desativados");
    expect(f.calls.some(call => /appointments|payments/.test(call.path))).toBe(false);
  });
  it("navigates from Agenda to the existing grade reader without inventing an empty appointments list", async () => {
    const f = await fixture({ tab: "agenda" }); await act(async () => button(f.host, "Consultar grade cadastrada").click());
    expect(button(f.host, "Disponibilidade").getAttribute("aria-selected")).toBe("true"); expect(f.host.textContent).not.toContain("Nenhum agendamento");
    expect(f.calls.some(call => call.path.includes("appointments"))).toBe(false);
  });
  it("performs the real scoped grade read after the normal professional/select and button gestures", async () => {
    const f = await fixture({ tab: "availability" }); await selectProfessional(f.host); await act(async () => button(f.host, "Consultar grade").click());
    expect(f.calls.at(-1)).toEqual({ path: "/v1/merchants/merchant-a/service-professionals/professional-a/availability", method: "GET" });
    expect(f.host.textContent).toContain("Segunda-feira"); expect(f.host.textContent).toContain("08:00–12:00");
  });
  it("declares no schedule only after the actual API has returned empty recurring rows and exceptions", async () => {
    const f = await fixture({ tab: "availability", read: () => Response.json({ ...grade, rows: [], exceptions: [] }) });
    expect(f.host.textContent).not.toContain("Nenhum horário cadastrado"); await selectProfessional(f.host); await act(async () => button(f.host, "Consultar grade").click());
    expect(f.host.textContent).toContain("Nenhum horário cadastrado");
  });
  it("shows an actual read error rather than a fabricated empty grade", async () => {
    const f = await fixture({ tab: "availability", read: () => Response.json({}, { status: 503 }) }); await selectProfessional(f.host); await act(async () => button(f.host, "Consultar grade").click());
    expect(f.host.querySelector('[role="tabpanel"] [role="alert"]')?.textContent).toContain("Não foi possível consultar a grade"); expect(f.host.textContent).not.toContain("Nenhum horário cadastrado");
  });
  it("does not publish an old selected professional response after the selection changes", async () => {
    let release!: (response: Response) => void;
    const pending = new Promise<Response>(done => { release = done; });
    const f = await fixture({ tab: "availability", read: () => pending }); await selectProfessional(f.host); await act(async () => button(f.host, "Consultar grade").click());
    await selectProfessional(f.host, "professional-b"); await act(async () => release(Response.json(grade)));
    expect(f.host.textContent).not.toContain("08:00–12:00");
  });
  it.each([{ ...me, role: "STAFF" as const }, { ...me, businessMode: "products" as const }])("denies default panel context %j before management/configuration reads", async current => {
    const f = await fixture({ current, tab: "availability" }); expect(f.host.textContent).toContain("Atendimento indisponível para esta conta"); expect(f.calls).toEqual([]);
  });
});
