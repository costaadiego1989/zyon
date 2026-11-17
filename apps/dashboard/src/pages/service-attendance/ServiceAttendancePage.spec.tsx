/** @vitest-environment jsdom */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { createDashboardApi, type MerchantProfile } from "../../api-client.js";
import { ApiContext } from "../../hooks/useApi.js";
import { ServiceAttendancePage } from "./ServiceAttendancePage.js";

const me: MerchantProfile = { id: "merchant-a", user_id: "operator-a", name: "A", role: "OWNER", businessMode: "services", businessModeSelectionState: "selected" };
const mounts: Array<{ root: Root; host: HTMLDivElement }> = [];
afterEach(async () => { for (const { root, host } of mounts.splice(0)) { await act(async () => root.unmount()); host.remove(); } window.history.replaceState(null, "", "/#service-attendance"); });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
async function mount(options: { current?: MerchantProfile | null; hash?: string; professionals?: () => Response | Promise<Response> } = {}) {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  window.history.replaceState(null, "", "/" + (options.hash ?? "#service-attendance"));
  const requests: string[] = [], panels: string[] = [];
  const api = createDashboardApi({ baseUrl: "https://api.example.test", fetchImpl: (async input => {
    const path = new URL(String(input)).pathname; requests.push(path);
    if (path.endsWith("/service-professionals")) return options.professionals?.() ?? Response.json({ items: [{ id: "professional-a", publicName: "Ana", version: 7 }], nextCursor: null });
    if (path.endsWith("/categories")) return Response.json([{ id: "category-a", name: "Saúde", product_count: 2 }]);
    if (path.endsWith("/service-business-policy")) return Response.json({ status: "unconfigured", version: 0, policy: null });
    throw new Error("Unexpected request " + path);
  }) as typeof fetch });
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host); mounts.push({ root, host });
  await act(async () => root.render(<ApiContext.Provider value={api}><ServiceAttendancePage me={options.current === undefined ? me : options.current} renderPanel={(tab, vm) => {
    panels.push(tab);
    return <div data-testid="composed-panel">{tab}: {vm.loadState.data?.professionals.items.map(item => item.publicName).join(", ")}</div>;
  }} /></ApiContext.Provider>));
  return { host, requests, panels };
}
const buttons = (host: HTMLElement) => Array.from(host.querySelectorAll<HTMLButtonElement>("button"));
const named = (host: HTMLElement, label: string) => buttons(host).find(button => button.textContent?.trim() === label)!;
async function change(input: HTMLInputElement | HTMLSelectElement, value: string) {
  await act(async () => {
    const proto = input instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event(input instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
  });
}

describe("T75 source criterion cases, native browser gate still pending", () => {
  it("composes the actual service shell with named tabs and an authorized panel", async () => {
    const f = await mount();
    expect(f.host.querySelector("h1")?.textContent).toBe("Atendimento");
    expect(Array.from(f.host.querySelectorAll('[role="tab"]')).map(tab => tab.textContent)).toEqual(["Agenda", "Profissionais", "Categorias", "Disponibilidade", "Configurações"]);
    expect(f.host.querySelector('[role="tabpanel"]')?.textContent).toContain("agenda: Ana");
    expect(f.requests.every(path => !path.includes("appointments"))).toBe(true);
  });

  it.each([{ ...me, businessMode: "products" as const }, { ...me, role: "STAFF" as const }, { ...me, businessModeSelectionState: "review_required" as const }, null])("does not mount a management panel or fetch configuration for denied context %j", async current => {
    const f = await mount({ current });
    expect(f.host.textContent).toContain("Atendimento indisponível para esta conta");
    expect(f.host.querySelector('[role="tablist"]')).toBeNull();
    expect(f.requests).toEqual([]); expect(f.panels).toEqual([]);
  });

  it("uses real tab click and keyboard gestures with linked tabpanel and focus", async () => {
    const f = await mount();
    await act(async () => named(f.host, "Profissionais").click());
    const current = named(f.host, "Profissionais"); current.focus();
    expect(current.getAttribute("aria-selected")).toBe("true");
    expect(f.host.querySelector('[role="tabpanel"]')?.getAttribute("aria-labelledby")).toBe(current.id);
    await act(async () => current.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })));
    expect(document.activeElement).toBe(named(f.host, "Categorias"));
    expect(named(f.host, "Categorias").getAttribute("aria-selected")).toBe("true");
    expect(f.host.querySelector('[role="tabpanel"]')?.textContent).toContain("categories: Ana");
  });

  it("restores a direct tab link and responds to a real hash navigation event", async () => {
    const f = await mount({ hash: "#service-attendance?tab=availability&professionalId=professional-a" });
    expect(named(f.host, "Disponibilidade").getAttribute("aria-selected")).toBe("true");
    await act(async () => { window.history.replaceState(null, "", "/#service-attendance?tab=settings"); window.dispatchEvent(new HashChangeEvent("hashchange")); });
    expect(named(f.host, "Configurações").getAttribute("aria-selected")).toBe("true");
  });

  it("shows actual loading without mounting panel content prematurely", async () => {
    const waiting = deferred<Response>();
    const f = await mount({ professionals: () => waiting.promise });
    expect(f.host.querySelector('[role="status"]')?.textContent).toContain("Carregando atendimento");
    expect(f.panels).toEqual([]);
    await act(async () => waiting.resolve(Response.json({ items: [], nextCursor: null })));
    expect(f.host.querySelector('[role="tabpanel"]')?.getAttribute("aria-busy")).toBe("false");
    expect(f.panels).toEqual(["agenda"]);
  });

  it("exposes a failed read and retries only through the actual retry button", async () => {
    let calls = 0;
    const f = await mount({ professionals: () => ++calls === 1 ? Response.json({}, { status: 503 }) : Response.json({ items: [], nextCursor: null }) });
    expect(f.host.textContent).toContain("Não foi possível atualizar o atendimento");
    expect(f.panels).toEqual([]);
    await act(async () => named(f.host, "Tentar novamente").click());
    expect(calls).toBe(2); expect(f.host.textContent).not.toContain("Não foi possível atualizar o atendimento");
    expect(f.panels).toEqual(["agenda"]);
  });

  it("applies actual professional/category gestures and individual date inputs through the period form", async () => {
    const f = await mount();
    await change(f.host.querySelector<HTMLSelectElement>('select[aria-label="Profissional"]')!, "professional-a");
    await change(f.host.querySelector<HTMLSelectElement>('select[aria-label="Categoria"]')!, "category-a");
    await change(f.host.querySelector<HTMLInputElement>('input[name="fromDate"]')!, "2026-11-23");
    await change(f.host.querySelector<HTMLInputElement>('input[name="toDate"]')!, "2026-11-24");
    await act(async () => named(f.host, "Aplicar período").click());
    const query = new URLSearchParams(window.location.hash.split("?")[1]);
    expect(Object.fromEntries(query)).toMatchObject({ professionalId: "professional-a", categoryId: "category-a", fromDate: "2026-11-23", toDate: "2026-11-24" });
    await act(async () => named(f.host, "Limpar período").click());
    expect(new URLSearchParams(window.location.hash.split("?")[1]).has("fromDate")).toBe(false);
    expect(f.host.querySelector<HTMLInputElement>('input[name="fromDate"]')!.value).toBe("");
  });

  it("reports an invalid date window after the actual form gesture without fabricating a calendar response", async () => {
    const f = await mount();
    await change(f.host.querySelector<HTMLInputElement>('input[name="fromDate"]')!, "2026-11-24");
    await change(f.host.querySelector<HTMLInputElement>('input[name="toDate"]')!, "2026-11-23");
    await act(async () => named(f.host, "Aplicar período").click());
    expect(f.host.querySelector('[role="alert"]')?.textContent).toContain("Informe um período válido");
    expect(new URLSearchParams(window.location.hash.split("?")[1]).has("fromDate")).toBe(false);
    expect(f.requests.some(path => path.includes("service-availability"))).toBe(false);
  });
});
