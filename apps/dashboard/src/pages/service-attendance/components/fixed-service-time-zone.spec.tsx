/** @vitest-environment jsdom */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { createDashboardApi, type MerchantProfile } from "../../../api-client.js";
import type { ServiceProfessionalAvailabilityDTO, ServiceAvailabilityExceptionDTO, ServiceProfessionalDTO } from "../../../api/endpoints/service-attendance.js";
import { ApiContext } from "../../../hooks/useApi.js";
import { useServiceAttendancePage } from "../useServiceAttendancePage.js";
import { ProfessionalsPanel } from "./ProfessionalsPanel.js";
import { AvailabilityPanel } from "./AvailabilityPanel.js";
import { professionalEditorDraft, professionalEditorPayload, newBrasiliaRecurringDraft, requiresNewBrasiliaGrade, canEditBrasiliaException } from "./fixed-service-time-zone.js";

const BR = "America/Sao_Paulo", stamp = "2026-11-17T00:00:00.000Z";
const me: MerchantProfile = { id: "merchant-a", user_id: "owner-a", role: "OWNER", name: "Synthetic business", businessMode: "services", businessModeSelectionState: "selected" };
const historicalGrade = (): ServiceProfessionalAvailabilityDTO => ({ professionalId: "professional-a", version: 7, timeZone: "America/Manaus",
  rows: [{ id: "row-a", merchantId: me.id, professionalId: "professional-a", weekday: 1, startMinute: 540, endMinute: 720,
    validFrom: "2027-01-01T00:00:00.000Z", validUntil: null, timeZone: "America/Manaus", isActive: true, version: 7, createdAt: stamp, updatedAt: stamp }], exceptions: [], nextCursor: null });
const professional = (zone = "America/Manaus"): ServiceProfessionalDTO => ({ id: "professional-a", merchantId: me.id, publicName: "Ana", publicProfile: {}, timeZone: zone,
  isActive: true, isPublished: true, version: 7, services: [{ id: "link-a", productId: "service-a", version: 1 }], createdAt: stamp, updatedAt: stamp });
interface Request { path: string; method: string; body: Record<string, unknown> }
const mounts: Array<{ root: Root; host: HTMLDivElement }> = [];
afterEach(async () => { for (const value of mounts.splice(0)) { await act(async () => value.root.unmount()); value.host.remove(); } window.history.replaceState(null, "", "/"); });
async function fixture(options: { panel?: "professionals" | "availability"; grade?: ServiceProfessionalAvailabilityDTO; actor?: MerchantProfile; conflict?: boolean } = {}) {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const panel = options.panel ?? "availability";
  window.history.replaceState(null, "", `/#service-attendance?tab=${panel}&professionalId=professional-a&fromDate=2027-01-04&toDate=2027-01-04`);
  let grade = structuredClone(options.grade ?? historicalGrade()); const source = structuredClone(grade), requests: Request[] = [];
  const row = () => ({ ...professional(grade.timeZone), version: grade.version });
  const api = createDashboardApi({ baseUrl: "https://api.example.test", fetchImpl: (async (input, init) => {
    const path = new URL(String(input)).pathname, request = { path, method: init?.method ?? "GET", body: init?.body ? JSON.parse(String(init.body)) : {} }; requests.push(request);
    if (path.endsWith("/categories")) return Response.json([]);
    if (path.endsWith("/service-business-policy")) return Response.json({ status: "unconfigured", version: 0, policy: null });
    if (path.endsWith("/service-professionals") && request.method === "GET") return Response.json({ items: [row()], nextCursor: null });
    if (path.endsWith("/service-professionals") && request.method === "POST") return Response.json({ ...professional(BR), ...request.body, id: "created-professional", version: 1, services: [] }, { status: 201 });
    if (path.endsWith("/service-professionals/professional-a") && request.method === "PATCH") return Response.json({ ...row(), ...request.body, version: grade.version + 1 });
    if (path.endsWith("/availability") && request.method === "GET") return Response.json(grade);
    if (options.conflict && request.method !== "GET") return Response.json({ code: "availability_appointment_conflict", detail: "availability_appointment_conflict" }, { status: 409 });
    if (path.endsWith("/availability") && request.method === "PUT") {
      grade = { ...grade, version: grade.version + 1, timeZone: String(request.body.timeZone), rows: (request.body.rows as Array<Record<string, unknown>>).map((value, index) => ({ ...value,
        id: "saved-" + index, merchantId: me.id, professionalId: grade.professionalId, timeZone: request.body.timeZone, isActive: true, version: grade.version + 1, createdAt: stamp, updatedAt: stamp })) as ServiceProfessionalAvailabilityDTO["rows"] };
      return Response.json(grade);
    }
    if (path.endsWith("/availability-exceptions") && request.method === "POST") {
      const value = { ...request.body, id: "exception-new", merchantId: me.id, professionalId: grade.professionalId, actorId: me.user_id, version: 1, createdAt: stamp, updatedAt: stamp } as unknown as ServiceAvailabilityExceptionDTO;
      grade = { ...grade, version: grade.version + 1, exceptions: [...grade.exceptions, value] }; return Response.json({ professionalId: grade.professionalId, version: grade.version, exception: value });
    }
    if (path.includes("/availability-exceptions/") && request.method === "PATCH") {
      const original = grade.exceptions.find(value => value.id === path.split("/").at(-1))!;
      const value = { ...original, ...request.body, version: original.version + 1 } as ServiceAvailabilityExceptionDTO;
      grade = { ...grade, version: grade.version + 1, exceptions: grade.exceptions.filter(item => item.id !== value.id) };
      return Response.json({ professionalId: grade.professionalId, version: grade.version, exception: value });
    }
    if (path.endsWith("/products")) return Response.json({ products: [], total: 0 });
    throw Error("Unexpected synthetic UI transport " + request.method + " " + path);
  }) as typeof fetch });
  function Probe() { const actor = options.actor ?? me, vm = useServiceAttendancePage({ me: actor }); return panel === "professionals" ? <ProfessionalsPanel me={actor} vm={vm} /> : <AvailabilityPanel me={actor} vm={vm} />; }
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host); mounts.push({ root, host });
  await act(async () => root.render(<ApiContext.Provider value={api}><Probe /></ApiContext.Provider>));
  return { host, source, grade: () => grade, writes: () => requests.filter(value => value.method !== "GET"), requests };
}
const button = (name: string) => Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find(value => value.textContent?.trim() === name || value.getAttribute("aria-label") === name)!;
const field = (name: string) => { const label = Array.from(document.querySelectorAll<HTMLLabelElement>("label")).find(value => value.textContent?.trim() === name)!; return document.getElementById(label.htmlFor) as HTMLInputElement; };
const zoneFields = () => Array.from(document.querySelectorAll<HTMLLabelElement>("label")).filter(value => /fuso/i.test(value.textContent ?? "") && Boolean(document.getElementById(value.htmlFor)?.matches("input,select,textarea")));
async function click(name: string) { await act(async () => button(name).click()); }
async function enter(name: string, value: string) { await act(async () => { const input = field(name); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })); }); }

describe("T113 fixed Brasilia UI and exact historical facts", () => {
  it("new professional drafts default to Brasilia while existing profile edits preserve their stored zone", () => {
    const fresh = professionalEditorDraft(null); expect(fresh.timeZone).toBe(BR);
    expect(professionalEditorPayload({ ...fresh, publicName: "Beatriz", timeZone: "UTC" }).timeZone).toBe(BR);
    const existing = professional("America/Manaus"), before = structuredClone(existing), draft = professionalEditorDraft(existing);
    expect(professionalEditorPayload({ ...draft, publicName: "Ana Silva", timeZone: BR })).toMatchObject({ expectedVersion: 7, publicName: "Ana Silva", timeZone: "America/Manaus" });
    expect(existing).toEqual(before);
  });
  it("explicit new Brasilia grades start empty instead of copying historical wall minutes or validity", () => {
    const grade = historicalGrade(), before = structuredClone(grade); expect(requiresNewBrasiliaGrade(grade)).toBe(true);
    expect(newBrasiliaRecurringDraft()).toEqual({ timeZone: BR, rows: [] }); expect(grade).toEqual(before);
    expect(requiresNewBrasiliaGrade({ ...grade, timeZone: BR, rows: grade.rows.map(row => ({ ...row, timeZone: BR })) })).toBe(false);
    expect(requiresNewBrasiliaGrade({ ...grade, timeZone: BR })).toBe(true);
    expect(requiresNewBrasiliaGrade({ ...grade, timeZone: BR, rows: grade.rows.map(row => ({ ...row, timeZone: BR, validFrom: "2027-01-01T00:00:30.123Z" })) })).toBe(true);
  });
  it("new professional form has no timezone input and submits Brasilia without extra buyer or auth fields", async () => {
    const f = await fixture({ panel: "professionals" }); await click("Novo profissional"); expect(zoneFields()).toEqual([]);
    expect(document.body.textContent).toContain("Horário de Brasília"); await enter("Nome público", "Beatriz"); await click("Salvar profissional");
    expect(f.writes()).toHaveLength(1); expect(f.writes()[0].body).toMatchObject({ publicName: "Beatriz", timeZone: BR });
    expect(f.writes()[0].body).not.toHaveProperty("merchantId"); expect(f.writes()[0].body).not.toHaveProperty("userId");
  });
  it("historical profile zone is read-only and unchanged during an ordinary name edit", async () => {
    const f = await fixture({ panel: "professionals" }); await click("Editar Ana"); expect(zoneFields()).toEqual([]);
    expect(document.body.textContent).toContain("America/Manaus"); await enter("Nome público", "Ana Silva"); await click("Salvar profissional");
    expect(f.writes()).toHaveLength(1); expect(f.writes()[0].body).toMatchObject({ publicName: "Ana Silva", timeZone: "America/Manaus", expectedVersion: 7 });
  });
  it("a historical grade requires the explicit blank Brasilia gesture and cannot be saved empty as a silent replacement", async () => {
    const f = await fixture(); await click("Consultar grade"); expect(button("Editar grade")).toBeUndefined(); await click("Criar grade em Brasília");
    expect(zoneFields()).toEqual([]); expect(document.querySelectorAll('input[placeholder="09:00"]')).toHaveLength(0);
    await click("Salvar grade"); expect(f.writes()).toEqual([]); expect(document.body.textContent).toContain("Adicione ao menos uma faixa");
    await click("Adicionar faixa"); await enter("Início da faixa 1", "10:00"); await enter("Fim da faixa 1", "11:00"); await click("Salvar grade");
    expect(f.writes()).toHaveLength(1); expect(f.writes()[0].body).toEqual({ expectedVersion: 7, timeZone: BR, rows: [{ weekday: 1, startMinute: 600, endMinute: 660 }] });
    expect(f.source.rows[0].timeZone).toBe("America/Manaus"); expect(f.source.rows[0].startMinute).toBe(540);
  });
  it("empty historical withdrawal sends its original zone and version only after explicit confirmation", async () => {
    const f = await fixture(); await click("Consultar grade"); await click("Retirar grade recorrente"); expect(f.writes()).toEqual([]);
    await click("Confirmar retirada"); expect(f.writes()).toHaveLength(1);
    expect(f.writes()[0].body).toEqual({ expectedVersion: 7, timeZone: "America/Manaus", rows: [] }); expect(f.source.rows[0].startMinute).toBe(540);
  });
  it("failed withdrawal preserves historical facts and read-only reconciliation never resends the command", async () => {
    const f = await fixture({ conflict: true }); await click("Consultar grade"); await click("Retirar grade recorrente"); await click("Confirmar retirada");
    expect(f.writes()).toHaveLength(1); expect(f.grade()).toEqual(f.source); expect(button("Criar grade em Brasília").disabled).toBe(true);
    await click("Recarregar e revisar"); expect(f.writes()).toHaveLength(1); expect(f.grade()).toEqual(f.source);
    expect(button("Criar grade em Brasília").disabled).toBe(false); expect(button("Confirmar retirada")).toBeUndefined();
  });
  for (const kind of ["one_off", "block"] as const) it(`new ${kind} uses Brasilia even without converting the historical profile`, async () => {
    const f = await fixture(); await click("Consultar grade"); await click(kind === "block" ? "Novo bloqueio" : "Novo horário avulso");
    expect(zoneFields()).toEqual([]); expect(document.body.textContent).toContain("Horário de Brasília");
    await enter("Início da exceção", "2027-01-04T10:00"); await enter("Fim da exceção", "2027-01-04T10:30"); await click("Salvar exceção");
    expect(f.writes()).toHaveLength(1); expect(f.writes()[0].body).toEqual({ expectedVersion: 7, kind, startsAt: "2027-01-04T13:00:00.000Z",
      endsAt: "2027-01-04T13:30:00.000Z", timeZone: BR, reason: "", isActive: true }); expect(f.source.timeZone).toBe("America/Manaus");
  });
  it("historical or precise exceptions cannot be silently edited but remain exactly deactivatable", async () => {
    const value: ServiceAvailabilityExceptionDTO = { id: "historical-exception", merchantId: me.id, professionalId: "professional-a", actorId: me.user_id,
      kind: "one_off", startsAt: "2027-01-04T13:00:30.123Z", endsAt: "2027-01-04T13:30:30.123Z", timeZone: "UTC", reason: "Original reason", isActive: true, version: 3, createdAt: stamp, updatedAt: stamp };
    expect(canEditBrasiliaException(value)).toBe(false); expect(canEditBrasiliaException({ ...value, timeZone: BR })).toBe(false);
    const f = await fixture({ grade: { ...historicalGrade(), exceptions: [value] } }); await click("Consultar grade"); expect(button("Editar horário avulso 1").disabled).toBe(true);
    await click("Desativar horário avulso 1"); expect(f.writes()).toEqual([]); await click("Confirmar desativação");
    expect(f.writes()).toHaveLength(1); expect(f.writes()[0].body).toEqual({ expectedVersion: 7, kind: value.kind, startsAt: value.startsAt,
      endsAt: value.endsAt, timeZone: value.timeZone, reason: value.reason, isActive: false }); expect(f.source.exceptions[0]).toEqual(value);
  });
  it("conflict preserves the new Brasilia draft and never cancels appointments or retries automatically", async () => {
    const f = await fixture({ conflict: true }); await click("Consultar grade"); await click("Novo bloqueio");
    await enter("Início da exceção", "2027-01-04T10:00"); await enter("Fim da exceção", "2027-01-04T10:30"); await click("Salvar exceção");
    expect(field("Início da exceção").value).toBe("2027-01-04T10:00"); expect(button("Salvar exceção").disabled).toBe(true);
    expect(f.writes()).toHaveLength(1); expect(f.requests.some(value => /appointment|cancel/.test(value.path))).toBe(false);
  });
  it("Staff and product-company views cannot produce an availability or profile write", async () => {
    for (const actor of [{ ...me, role: "STAFF" as const }, { ...me, businessMode: "products" as const }]) {
      const f = await fixture({ actor }); expect(f.writes()).toEqual([]); expect(button("Criar grade em Brasília")).toBeUndefined();
    }
  });
});
