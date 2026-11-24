import React, { act, type ComponentType } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach } from "vitest";
import { createDashboardApi, type MerchantProfile, type Product } from "../../../api-client.js";
import { ApiContext } from "../../../hooks/useApi.js";
import { useServiceAttendancePage } from "../useServiceAttendancePage.js";

export const manualMe: MerchantProfile = { id: "merchant-a", user_id: "owner-a", role: "OWNER", name: "Synthetic services", businessMode: "services", businessModeSelectionState: "selected" };
export interface ManualTestRequest { path: string; method: string; query: URLSearchParams; body: any; headers: Headers }
export interface ManualTestProps { me: MerchantProfile | null; vm: ReturnType<typeof useServiceAttendancePage>; open: boolean; onClose: () => void }
const mounts: Array<{ root: Root; host: HTMLDivElement }> = [];
afterEach(async () => { for (const mount of mounts.splice(0)) { await act(async () => mount.root.unmount()); mount.host.remove(); } window.history.replaceState(null, "", "/"); });
export const manualDetail = (mode: "online" | "at_attendance" = "online") => ({ id: "appointment-a", merchantId: "merchant-a", professionalId: "professional-a", professionalName: "Ana", productId: "service-a", serviceName: "Consulta", categoryId: null, variantId: "variant-a",
  startsAt: "2030-01-02T13:00:00.000Z", endsAt: "2030-01-02T13:30:00.000Z", timeZone: "America/Sao_Paulo", durationMinutes: 30,
  priceInCents: 5000, currency: "BRL", policyVersion: 3, operationalStatus: mode === "online" ? "pending" : "scheduled", origin: "manual", version: 1,
  customer: { name: "Maria" }, payments: mode === "online" ? [] : [{ id: "balance-a", mode: "at_attendance", status: "pending", amountCents: 5000, currency: "BRL", version: 1, requiresRegularization: false, receivedAt: null }],
  history: [], historyPartial: false, asOf: "2030-01-01T12:00:00.000Z" });
export function manualReceipt(mode: "online" | "at_attendance" = "online") { const value = manualDetail(mode); return { replayed: false, professionalVersion: 7,
  availabilityExceptionId: null, appointment: { id: value.id, merchantId: value.merchantId, professionalId: value.professionalId, productId: value.productId, variantId: value.variantId, version: 1, operationalStatus: value.operationalStatus } }; }

/** UI/SDK transport fixture only. No real API, auth, persistence or payment proof. */
export async function manualFixture(Component: ComponentType<ManualTestProps>, options: { me?: MerchantProfile | null; mode?: "online" | "at_attendance"; admissions?: boolean; handle?: (request: ManualTestRequest) => Response | Promise<Response> | undefined } = {}) {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); window.history.replaceState(null, "", "/#service-attendance?tab=agenda&fromDate=2030-01-01&toDate=2030-01-03");
  const requests: ManualTestRequest[] = [], mode = options.mode ?? "online";
  let currentMe = options.me === undefined ? manualMe : options.me, visible = true;
  const api = createDashboardApi({ baseUrl: "https://api.example.test", fetchImpl: (async (input, init) => {
    const url = new URL(String(input)), request = { path: url.pathname, query: url.searchParams, method: init?.method ?? "GET", body: init?.body ? JSON.parse(String(init.body)) : undefined, headers: new Headers(init?.headers) }; requests.push(request);
    const custom = options.handle?.(request); if (custom !== undefined) return custom;
    const merchantId = /\/merchants\/([^/]+)\//.exec(url.pathname)?.[1] ?? currentMe?.id ?? manualMe.id;
    if (url.pathname.endsWith("/categories")) return Response.json([]);
    if (url.pathname.endsWith("/service-business-policy")) return Response.json({ status: "configured", version: 3, policy: { paymentMode: mode, holdEnabled: false, holdMinutes: null, admissionsEnabled: options.admissions !== false } });
    if (url.pathname.endsWith("/service-professionals")) return Response.json({ items: [{ id: "professional-a", merchantId, publicName: "Ana", publicProfile: {}, version: 7, timeZone: "America/Sao_Paulo", isActive: true, isPublished: true, services: [{ id: "link-a", productId: "service-a", version: 1 }], createdAt: "2026-01-01T00:00Z", updatedAt: "2026-01-01T00:00Z" }], nextCursor: null });
    if (url.pathname.endsWith("/products")) return Response.json({ products: [{ id: "service-a", merchantId, name: "Consulta", type: "service", isActive: true,
      metadata: { serviceSchedule: { timeZone: "America/Sao_Paulo", durationMinutes: 30, slots: [] } }, createdAt: "2026-01-01T00:00Z", updatedAt: "2026-01-01T00:00Z", variants: [{ id: "variant-a", sku: "consulta", attributes: {}, isActive: true, basePriceInCents: 5000, currency: "BRL", taxPercent: 0, stockQuantity: 0, stockReserved: 0, media: [] }] } satisfies Product], total: 1 });
    if (url.pathname.endsWith("/customers")) return Response.json({ data: [{ id: "buyer-a", profile: { fullName: "Cliente cadastrado", email: "known@example.test" }, first_seen_at: "2026-01-01T00:00Z", last_seen_at: "2026-01-02T00:00Z" }], next_cursor: null, has_more: false });
    const calendar = { status: "ready", professionalVersion: 7, policyVersion: 3, timeZone: "America/Sao_Paulo", durationMinutes: 30, asOf: "2030-01-01T12:00:00.000Z", dates: ["2030-01-02"] };
    if (url.pathname.endsWith("/service-availability/dates")) return Response.json(calendar);
    if (url.pathname.endsWith("/service-availability/slots")) return Response.json({ ...calendar, slots: [{ date: "2030-01-02", startTime: "10:00", startsAt: "2030-01-02T13:00:00.000Z", endsAt: "2030-01-02T13:30:00.000Z", timeZone: "America/Sao_Paulo", durationMinutes: 30 }] });
    if (url.pathname.endsWith("/service-appointments/manual")) return Response.json(manualReceipt(mode), { status: 201 });
    if (url.pathname.endsWith("/service-appointments/appointment-a")) return Response.json(manualDetail(mode));
    throw Error("Unexpected UI fixture request " + request.method + " " + request.path);
  }) as typeof fetch });
  function Probe({ me, open }: { me: MerchantProfile | null; open: boolean }) { const vm = useServiceAttendancePage({ me }); return <Component me={me} vm={vm} open={open} onClose={() => { visible = false; void render(currentMe, false); }} />; }
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host); mounts.push({ root, host });
  async function render(me: MerchantProfile | null = currentMe, open = visible) { currentMe = me; visible = open; await act(async () => root.render(<ApiContext.Provider value={api}><Probe me={me} open={open} /></ApiContext.Provider>)); }
  await render(); return { host, root, api, requests, render, writes: () => requests.filter(value => value.method !== "GET"), details: () => requests.filter(value => /\/service-appointments\/appointment-a$/.test(value.path)) };
}
export const manualButton = (name: string) => Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find(value => value.textContent?.trim() === name || value.getAttribute("aria-label") === name
  || Array.from(document.querySelectorAll<HTMLLabelElement>("label")).some(label => label.htmlFor === value.id && label.textContent?.trim() === name))!;
export const manualField = (name: string) => { const label = Array.from(document.querySelectorAll<HTMLLabelElement>("label")).find(value => value.textContent?.trim() === name)!; return document.getElementById(label.htmlFor) as HTMLInputElement; };
export async function manualClick(name: string) { await act(async () => manualButton(name).click()); }
export async function manualEnter(name: string, value: string) { await act(async () => { const field = manualField(name); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field, value); field.dispatchEvent(new Event("input", { bubbles: true })); }); }
export async function manualSelect(name: string, value: string) { await act(async () => { const field = manualField(name) as unknown as HTMLSelectElement; field.value = value; field.dispatchEvent(new Event("change", { bubbles: true })); }); }
export async function manualRegularSelection() { await manualSelect("Serviço", "service-a"); await manualSelect("Profissional", "professional-a"); await manualClick("Consultar datas"); await manualSelect("Data disponível", "2030-01-02"); await manualSelect("Horário disponível", "2030-01-02T13:00:00.000Z"); }
export async function manualContact() { await manualEnter("Nome do contato", "Maria"); await manualEnter("Telefone", "21999990000"); }
