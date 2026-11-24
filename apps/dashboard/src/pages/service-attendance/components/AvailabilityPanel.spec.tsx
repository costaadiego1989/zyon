/** @vitest-environment jsdom */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { createDashboardApi, type MerchantProfile, type Product } from "../../../api-client.js";
import type { ServiceProfessionalAvailabilityDTO, ServiceAvailabilityExceptionDTO } from "../../../api/endpoints/service-attendance.js";
import { ApiContext } from "../../../hooks/useApi.js";
import { useServiceAttendancePage } from "../useServiceAttendancePage.js";
import { AvailabilityPanel } from "./AvailabilityPanel.js";

const me: MerchantProfile = { id: "merchant-a", user_id: "owner-a", name: "Local", role: "OWNER", businessMode: "services", businessModeSelectionState: "selected" };
const stamp = "2026-11-17T00:00:00.000Z";
const originalGrade = (): ServiceProfessionalAvailabilityDTO => ({ professionalId: "professional-a", version: 7, timeZone: "America/Manaus", rows: [{ id: "row-a", merchantId: me.id, professionalId: "professional-a", weekday: 1, startMinute: 540, endMinute: 720, validFrom: "2027-01-01T00:00:00.000Z", validUntil: null, timeZone: "America/Manaus", isActive: true, version: 7, createdAt: stamp, updatedAt: stamp }], exceptions: [], nextCursor: null });
interface Request { path: string; method: string; body: Record<string, unknown> }
const mounts: Array<{ root: Root; host: HTMLDivElement }> = [];
afterEach(async () => { for (const { root, host } of mounts.splice(0)) { await act(async () => root.unmount()); host.remove(); } window.history.replaceState(null, "", "/"); });
async function fixture(options: { me?: MerchantProfile | null; newWrite?: true; handle?: (request: Request) => Response | Promise<Response> | undefined } = {}) {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); window.history.replaceState(null, "", "/#service-attendance?tab=availability&professionalId=professional-a&fromDate=2027-01-04&toDate=2027-01-04");
  let grade = originalGrade(); let exceptions: ServiceAvailabilityExceptionDTO[] = []; const requests: Request[] = [];
  // Explicit new-write controls use Brasilia. The default historical Manaus
  // reader fixture and its canonical preview/instant assertions stay intact.
  if (options.newWrite) grade = { ...grade, timeZone: "America/Sao_Paulo", rows: grade.rows.map(row => ({ ...row, timeZone: "America/Sao_Paulo" })) };
  const api = createDashboardApi({ baseUrl: "https://api.example.test", fetchImpl: (async (input, init) => {
    const path = new URL(String(input)).pathname, request = { path, method: init?.method ?? "GET", body: init?.body ? JSON.parse(String(init.body)) : {} }; requests.push(request);
    const custom = options.handle?.(request); if (custom !== undefined) return custom;
    if (path.endsWith("/categories")) return Response.json([]);
    if (path.endsWith("/service-business-policy")) return Response.json({ status: "unconfigured", version: 0, policy: null });
    if (path.endsWith("/service-professionals")) return Response.json({ items: [{ id: "professional-a", merchantId: me.id, publicName: "Ana", publicProfile: {}, timeZone: grade.timeZone, isActive: true, isPublished: true, version: grade.version, services: [{ id: "link-a", productId: "service-a", version: 1 }], createdAt: stamp, updatedAt: stamp }], nextCursor: null });
    if (path.endsWith("/availability") && request.method === "GET") return Response.json(grade);
    if (path.endsWith("/availability") && request.method === "PUT") {
      grade = { ...grade, version: grade.version + 1, timeZone: String(request.body.timeZone), rows: (request.body.rows as Array<Record<string, unknown>>).map((row, index) => ({ ...row, id: "saved-" + index, merchantId: me.id, professionalId: grade.professionalId, timeZone: request.body.timeZone, isActive: true, version: grade.version + 1, createdAt: stamp, updatedAt: stamp })) as ServiceProfessionalAvailabilityDTO["rows"] }; return Response.json(grade);
    }
    if (path.endsWith("/availability-exceptions") && request.method === "POST") {
      const row = { ...request.body, id: "exception-new", merchantId: me.id, professionalId: grade.professionalId, actorId: me.user_id, version: 1, createdAt: stamp, updatedAt: stamp } as unknown as ServiceAvailabilityExceptionDTO;
      exceptions = [...exceptions, row]; grade = { ...grade, version: grade.version + 1, exceptions: exceptions.filter(item => item.isActive) }; return Response.json({ professionalId: grade.professionalId, version: grade.version, exception: row });
    }
    if (path.includes("/availability-exceptions/") && request.method === "PATCH") {
      const id = path.split("/").at(-1)!, before = exceptions.find(row => row.id === id)!;
      const row = { ...before, ...request.body, version: before.version + 1 } as ServiceAvailabilityExceptionDTO;
      exceptions = exceptions.map(item => item.id === id ? row : item); grade = { ...grade, version: grade.version + 1, exceptions: exceptions.filter(item => item.isActive) };
      return Response.json({ professionalId: grade.professionalId, version: grade.version, exception: row });
    }
    if (path.endsWith("/products")) return Response.json({ products: [{ id: "service-a", merchantId: me.id, name: "Consulta", type: "service", isActive: true, metadata: { serviceSchedule: { timeZone: "America/Sao_Paulo", durationMinutes: 30, slots: [] } }, createdAt: stamp, updatedAt: stamp, variants: [{ id: "variant-a", sku: "consulta", attributes: {}, isActive: true, basePriceInCents: 5000, currency: "BRL", taxPercent: 0, stockQuantity: 0, stockReserved: 0, media: [] }] } satisfies Product], total: 1 });
    if (path.endsWith("/service-availability/dates")) return Response.json({ status: "ready", professionalVersion: grade.version, policyVersion: null, timeZone: "America/Manaus", durationMinutes: 30, asOf: stamp, dates: ["2027-01-04"] });
    if (path.endsWith("/service-availability/slots")) return Response.json({ status: "ready", professionalVersion: grade.version, policyVersion: null, timeZone: "America/Manaus", durationMinutes: 30, asOf: stamp, dates: ["2027-01-04"], slots: [{ date: "2027-01-04", startTime: "09:30", startsAt: "2027-01-04T13:30:00.000Z", endsAt: "2027-01-04T14:00:00.000Z", timeZone: "America/Manaus", durationMinutes: 30 }] });
    throw new Error("Unexpected request " + request.method + " " + path);
  }) as typeof fetch });
  function Probe({ current }: { current: MerchantProfile | null }) { const vm = useServiceAttendancePage({ me: current }); return <AvailabilityPanel me={current} vm={vm} />; }
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host); mounts.push({ root, host });
  const render = async (current: MerchantProfile | null) => { await act(async () => root.render(<ApiContext.Provider value={api}><Probe current={current} /></ApiContext.Provider>)); };
  await render(options.me === undefined ? me : options.me); return { host, requests, render, grade: () => grade, exceptionHistory: () => exceptions };
}
const button = (name: string) => Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find(item => item.textContent?.trim() === name || item.getAttribute("aria-label") === name)!;
const input = (name: string) => { const label = Array.from(document.querySelectorAll<HTMLLabelElement>("label")).find(item => item.textContent?.trim() === name)!; return document.getElementById(label.htmlFor) as HTMLInputElement; };
async function click(name: string) { await act(async () => button(name).click()); }
async function enter(name: string, value: string) { await act(async () => { const field = input(name); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field, value); field.dispatchEvent(new Event("input", { bubbles: true })); }); }
const writes = (f: Awaited<ReturnType<typeof fixture>>) => f.requests.filter(request => request.method !== "GET");

describe("T78 administrative availability gestures", () => {
  it("requires consultation and renders the canonical timezone and recurring interval", async () => {
    const f = await fixture(); expect(button("Editar grade").disabled).toBe(true); await click("Consultar grade");
    expect(f.host.textContent).toContain("America/Manaus"); expect(f.host.textContent).toContain("09:00–12:00"); expect(button("Criar grade em Brasília").disabled).toBe(false); expect(button("Editar grade")).toBeUndefined(); expect(writes(f)).toEqual([]);
  });
  it.each([{ ...me, role: "STAFF" as const }, { ...me, businessMode: "products" as const }, null])("denies management without requesting a grade %j", async current => {
    const f = await fixture({ me: current }); expect(f.host.textContent).toContain("Sem permissão para gerenciar horários"); expect(f.requests).toEqual([]);
  });
  it("edits recurring wall time with CAS and existing validity intact, then focuses actual canonical feedback", async () => {
    const f = await fixture({ newWrite: true }); await click("Consultar grade"); await click("Editar grade"); await enter("Início da faixa 1", "10:00"); await click("Salvar grade");
    expect(writes(f).map(request => request.body)).toEqual([{ expectedVersion: 7, timeZone: "America/Sao_Paulo", rows: [{ weekday: 1, startMinute: 600, endMinute: 720, validFrom: "2027-01-01T00:00:00.000Z", validUntil: null }] }]);
    expect(f.grade().rows[0].startMinute).toBe(600); expect(f.host.textContent).toContain("10:00–12:00"); expect(f.host.textContent).toContain("Grade salva."); expect(document.activeElement?.textContent).toBe("Grade salva.");
  });
  it("blocks an invalid wall time after submit without a calendar write or editable timezone", async () => {
    const f = await fixture({ newWrite: true }); await click("Consultar grade"); await click("Editar grade"); await enter("Início da faixa 1", "Invalid/Time"); await click("Salvar grade");
    expect(writes(f)).toEqual([]); expect(input("Início da faixa 1").value).toBe("Invalid/Time"); expect(f.host.querySelector('[role="alert"]')).not.toBeNull();
  });
  it.each(["Novo horário avulso", "Novo bloqueio"])("creates the selected exception with explicit professional-zone instants: %s", async action => {
    const f = await fixture({ newWrite: true }); await click("Consultar grade"); await click(action); await enter("Início da exceção", "2027-01-04T10:00"); await enter("Fim da exceção", "2027-01-04T11:00"); await click("Salvar exceção");
    expect(writes(f)).toHaveLength(1); expect(writes(f)[0]).toMatchObject({ method: "POST", body: { expectedVersion: 7, kind: action === "Novo bloqueio" ? "block" : "one_off", startsAt: "2027-01-04T13:00:00.000Z", endsAt: "2027-01-04T14:00:00.000Z", timeZone: "America/Sao_Paulo", reason: "", isActive: true } });
    expect(f.grade().exceptions).toHaveLength(1); expect(f.host.textContent).toContain("Exceção salva.");
  });
  it("keeps the draft after a confirmed-appointment conflict and never issues a cancellation or automatic retry", async () => {
    const f = await fixture({ newWrite: true, handle: request => request.method === "POST" && request.path.endsWith("/availability-exceptions") ? Response.json({ code: "availability_appointment_conflict", detail: "availability_appointment_conflict" }, { status: 409 }) : undefined });
    await click("Consultar grade"); await click("Novo bloqueio"); await enter("Início da exceção", "2027-01-04T09:00"); await enter("Fim da exceção", "2027-01-04T10:00"); await click("Salvar exceção");
    expect(input("Início da exceção").value).toBe("2027-01-04T09:00"); expect(button("Salvar exceção").disabled).toBe(true); expect(f.grade().exceptions).toEqual([]); expect(writes(f)).toHaveLength(1); expect(f.requests.some(request => /cancel|appointment/.test(request.path))).toBe(false);
  });
  it("keeps a persisted write and failed canonical reread as separate visible facts", async () => {
    let saved = false; const f = await fixture({ newWrite: true, handle: request => { if (request.method === "PUT") saved = true; return saved && request.method === "GET" && request.path.endsWith("/availability") ? Response.json({}, { status: 503 }) : undefined; } });
    await click("Consultar grade"); await click("Editar grade"); await enter("Início da faixa 1", "10:00"); await click("Salvar grade");
    expect(f.grade().rows[0].startMinute).toBe(600); expect(f.host.textContent).toContain("A alteração foi recebida, mas a grade não pôde ser conferida"); expect(f.host.textContent).not.toContain("Grade salva."); expect(button("Editar grade").disabled).toBe(true);
  });
  it("does not calculate slots locally and displays only the canonical preview response", async () => {
    const f = await fixture(); await click("Consultar grade"); await click("Consultar serviços vinculados");
    await act(async () => { const select = document.querySelector<HTMLSelectElement>('[aria-label="Oferta para preview"]')!; select.value = "variant-a"; select.dispatchEvent(new Event("change", { bubbles: true })); });
    await click("Consultar datas disponíveis"); await click("04/01/2027");
    expect(f.host.textContent).toContain("09:30"); expect(f.host.textContent).toContain("30 min"); expect(f.requests.filter(request => request.path.endsWith("/service-availability/slots"))).toHaveLength(1); expect(writes(f)).toEqual([]);
  });
  it("edits a known exception through its real id and current professional CAS version", async () => {
    const f = await fixture({ newWrite: true }); await click("Consultar grade"); await click("Novo horário avulso"); await enter("Início da exceção", "2027-01-04T10:00"); await enter("Fim da exceção", "2027-01-04T11:00"); await click("Salvar exceção");
    await click("Editar horário avulso 1"); await enter("Fim da exceção", "2027-01-04T12:00"); await click("Salvar exceção");
    expect(writes(f)[1]).toMatchObject({ method: "PATCH", path: "/v1/merchants/merchant-a/service-professionals/professional-a/availability-exceptions/exception-new", body: { expectedVersion: 8, startsAt: "2027-01-04T13:00:00.000Z", endsAt: "2027-01-04T15:00:00.000Z", timeZone: "America/Sao_Paulo", kind: "one_off", isActive: true } });
    expect(f.exceptionHistory()).toHaveLength(1); expect(f.grade().exceptions[0].endsAt).toBe("2027-01-04T15:00:00.000Z");
  });
  it("confirms removal without rewriting the historical exception interval or sending an appointment command", async () => {
    const f = await fixture({ newWrite: true }); await click("Consultar grade"); await click("Novo bloqueio"); await enter("Início da exceção", "2027-01-04T10:00"); await enter("Fim da exceção", "2027-01-04T11:00"); await click("Salvar exceção");
    const original = structuredClone(f.exceptionHistory()[0]); await click("Desativar bloqueio 1"); await click("Confirmar desativação");
    expect(writes(f)[1].body).toEqual({ expectedVersion: 8, kind: original.kind, startsAt: original.startsAt, endsAt: original.endsAt, timeZone: original.timeZone, reason: original.reason, isActive: false });
    expect(f.exceptionHistory()).toHaveLength(1); expect(f.exceptionHistory()[0]).toMatchObject({ id: original.id, startsAt: original.startsAt, endsAt: original.endsAt, isActive: false }); expect(f.grade().exceptions).toEqual([]); expect(f.requests.some(request => /appointment|cancel/.test(request.path))).toBe(false); expect(f.host.textContent).toContain("Exceção desativada.");
  });
  it("does not resend a server-error command during explicit read-only reconciliation", async () => {
    const f = await fixture({ newWrite: true, handle: request => request.method !== "GET" ? Response.json({}, { status: 500 }) : undefined });
    await click("Consultar grade"); await click("Editar grade"); await enter("Início da faixa 1", "10:00"); await click("Salvar grade"); expect(writes(f)).toHaveLength(1); expect(button("Salvar grade").disabled).toBe(true);
    await click("Recarregar e revisar"); expect(writes(f)).toHaveLength(1); expect(f.grade().version).toBe(7); expect(button("Editar grade").disabled).toBe(false); expect(f.host.textContent).toContain("Reabra a edição para revisar");
  });
  it("blocks a second Save gesture before the render of the first command", async () => {
    const f = await fixture({ newWrite: true }); await click("Consultar grade"); await click("Editar grade"); await enter("Início da faixa 1", "10:00");
    await act(async () => { button("Salvar grade").click(); button("Salvar grade").click(); });
    expect(writes(f)).toHaveLength(1); expect(f.grade().version).toBe(8); expect(f.grade().rows[0].startMinute).toBe(600);
  });
  it("hides a prior preview when its real service choice is cleared", async () => {
    const f = await fixture(); await click("Consultar grade"); await click("Consultar serviços vinculados"); const select = () => document.querySelector<HTMLSelectElement>('[aria-label="Oferta para preview"]')!;
    await act(async () => { select().value = "variant-a"; select().dispatchEvent(new Event("change", { bubbles: true })); }); await click("Consultar datas disponíveis"); await click("04/01/2027"); expect(f.host.textContent).toContain("09:30");
    await act(async () => { select().value = ""; select().dispatchEvent(new Event("change", { bubbles: true })); });
    expect(button("Consultar datas disponíveis").disabled).toBe(true); expect(f.host.textContent).not.toContain("09:30"); expect(writes(f)).toEqual([]);
  });

  it("distinguishes an actual empty canonical preview from a failed read", async () => {
    let fail = false; const f = await fixture({ handle: request => request.path.endsWith("/service-availability/dates") ? fail ? Response.json({}, { status: 503 }) : Response.json({ status: "empty", professionalVersion: 7, policyVersion: null, timeZone: "America/Manaus", durationMinutes: 30, asOf: stamp, dates: [] }) : undefined });
    await click("Consultar grade"); await click("Consultar serviços vinculados"); await act(async () => { const select = document.querySelector<HTMLSelectElement>('[aria-label="Oferta para preview"]')!; select.value = "variant-a"; select.dispatchEvent(new Event("change", { bubbles: true })); });
    await click("Consultar datas disponíveis"); expect(f.host.textContent).toContain("Nenhum horário disponível no período consultado.");
    fail = true; await click("Consultar datas disponíveis"); expect(f.host.textContent).toContain("Não foi possível consultar a disponibilidade."); expect(f.host.textContent).not.toContain("Nenhum horário disponível no período consultado."); expect(writes(f)).toEqual([]);
  });

});
