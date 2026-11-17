/** @vitest-environment jsdom */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { createDashboardApi, type MerchantProfile, type Product } from "../../api-client.js";
import type { ServiceProfessionalDTO } from "../../api/endpoints/service-attendance.js";
import { ApiContext } from "../../hooks/useApi.js";
import { ServiceAttendancePage } from "./ServiceAttendancePage.js";

const me: MerchantProfile = { id: "merchant-a", user_id: "operator-a", name: "A", role: "OWNER", businessMode: "services", businessModeSelectionState: "selected" };
const professional = (id = "professional-a", merchantId = me.id): ServiceProfessionalDTO => ({ id, merchantId, publicName: merchantId === me.id ? "Ana" : "Bruno", publicProfile: {}, timeZone: "America/Sao_Paulo", isActive: true, isPublished: true, version: 7, services: [], createdAt: "2026-11-17T04:00:00Z", updatedAt: "2026-11-17T04:00:00Z" });
const service: Product = { id: "service-a", merchantId: me.id, name: "Consulta", type: "service", isActive: true, variants: [], createdAt: "2026-11-17T04:00:00Z", updatedAt: "2026-11-17T04:00:00Z" };
interface Call { path: string; method: string; body: Record<string, unknown> }
const mounts: Array<{ root: Root; host: HTMLDivElement }> = [];
afterEach(async () => { for (const { root, host } of mounts.splice(0)) { await act(async () => root.unmount()); host.remove(); } });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }

async function fixture(options: { refresh?: ReturnType<typeof deferred<Response>>; refreshFails?: boolean; post?: ReturnType<typeof deferred<Response>> } = {}) {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); window.history.replaceState(null, "", "/#service-attendance?tab=professionals");
  const calls: Call[] = []; let rows = [professional()], ownerReads = 0;
  const api = createDashboardApi({ baseUrl: "https://api.example.test", fetchImpl: (async (input, init) => {
    const path = new URL(String(input)).pathname, method = init?.method ?? "GET", body = init?.body ? JSON.parse(String(init.body)) : {}; calls.push({ path, method, body });
    if (path.endsWith("/categories")) return Response.json([]);
    if (path.endsWith("/service-business-policy")) return Response.json({ status: "unconfigured", version: 0, policy: null });
    if (path.endsWith("/products")) return Response.json({ products: [service], total: 1 });
    if (path.endsWith("/service-professionals") && method === "GET") {
      if (!path.includes("/merchant-a/")) return Response.json({ items: [professional("professional-b", "merchant-b")], nextCursor: null });
      ownerReads++;
      if (ownerReads > 1 && options.refresh) return options.refresh.promise;
      if (ownerReads > 1 && options.refreshFails) return Response.json({ detail: "unavailable" }, { status: 503 });
      return Response.json({ items: rows, nextCursor: null });
    }
    if (path.endsWith("/service-professionals") && method === "POST") {
      if (options.post) return options.post.promise;
      const row = { ...professional("professional-new"), ...body, version: 1, services: (body.productIds as string[]).map(productId => ({ id: "link-" + productId, productId, version: 1 })) } as ServiceProfessionalDTO;
      rows = [...rows, row]; return Response.json(row);
    }
    if (path.endsWith("/deactivate") && method === "POST") {
      const id = path.split("/").at(-2)!, before = rows.find(row => row.id === id)!;
      const row = { ...before, isActive: false, isPublished: false, version: before.version + 1 };
      rows = rows.map(value => value.id === id ? row : value); return Response.json(row, { status: 201 });
    }
    throw new Error("Unexpected request " + method + " " + path);
  }) as typeof fetch });
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host); mounts.push({ root, host });
  const render = async (current: MerchantProfile) => { await act(async () => root.render(<ApiContext.Provider value={api}><ServiceAttendancePage me={current} /></ApiContext.Provider>)); };
  await render(me); return { host, calls, render, rows: () => rows };
}
function button(label: string) { return Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find(node => node.textContent?.trim() === label)!; }
async function click(label: string) { await act(async () => button(label).click()); }
async function enter(label: string, value: string) { await act(async () => {
  const node = Array.from(document.querySelectorAll<HTMLLabelElement>("label")).find(row => row.textContent?.trim() === label)!;
  const field = document.getElementById(node.htmlFor) as HTMLInputElement;
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field, value); field.dispatchEvent(new Event("input", { bubbles: true }));
}); }
async function openAndFill() {
  const opener = button("Novo profissional"); await act(async () => { opener.focus(); opener.click(); });
  await enter("Nome público", "Beatriz"); await enter("Fuso horário", "America/Sao_Paulo");
  const serviceLabel = Array.from(document.querySelectorAll<HTMLLabelElement>("label")).find(row => row.textContent?.trim() === "Vincular Consulta")!;
  await act(async () => (document.getElementById(serviceLabel.htmlFor) as HTMLButtonElement).click());
  return opener;
}

describe("T76 actual Page and professional panel refresh composition", () => {
  it("keeps the editor mounted through post-save refresh, then displays the canonical result, feedback and restored focus", async () => {
    const refresh = deferred<Response>(), f = await fixture({ refresh }), opener = await openAndFill();
    const dialog = document.querySelector('[role="dialog"]'); await click("Salvar profissional");
    expect(document.querySelector('[role="dialog"]')).toBe(dialog); expect(button("Salvar profissional").disabled).toBe(true);
    expect(f.host.textContent).toContain("Atualizando atendimento"); expect(f.host.textContent).toContain("Ana"); expect(f.host.textContent).not.toContain("Profissional salvo.");
    expect(f.calls.filter(call => call.method === "POST")).toEqual([{ path: "/v1/merchants/merchant-a/service-professionals", method: "POST", body: { publicName: "Beatriz", publicProfile: { description: "", specialties: [] }, timeZone: "America/Sao_Paulo", isActive: true, isPublished: false, productIds: ["service-a"] } }]);
    await act(async () => refresh.resolve(Response.json({ items: f.rows(), nextCursor: null })));
    expect(document.querySelector('[role="dialog"]')).toBeNull(); expect(f.host.textContent).toContain("Beatriz"); expect(f.host.textContent).toContain("Profissional salvo.");
    expect(document.activeElement).toBe(opener); expect(opener.isConnected).toBe(true); expect(f.calls.filter(call => call.method === "POST")).toHaveLength(1);
    expect(f.calls.some(call => /auth|users|appointments|payments/.test(call.path))).toBe(false);
  });

  it("keeps write success and failed refresh distinct without losing feedback, focus or automatically resending", async () => {
    const f = await fixture({ refreshFails: true }), opener = await openAndFill(); await click("Salvar profissional");
    expect(f.rows().find(row => row.id === "professional-new")?.publicName).toBe("Beatriz");
    expect(document.querySelector('[role="dialog"]')).toBeNull(); expect(f.host.textContent).toContain("Profissional salvo.");
    expect(f.host.textContent).toContain("Não foi possível atualizar o atendimento"); expect(f.host.textContent).not.toContain("Beatriz");
    expect(document.activeElement).toBe(opener); expect(f.calls.filter(call => call.method === "POST")).toHaveLength(1);
  });

  it("removes the prior editor and rejects its late result when the authenticated merchant changes during save", async () => {
    const post = deferred<Response>(), f = await fixture({ post }); await openAndFill(); await click("Salvar profissional");
    await f.render({ ...me, id: "merchant-b", user_id: "operator-b" }); expect(document.querySelector('[role="dialog"]')).toBeNull(); expect(f.host.textContent).toContain("Bruno");
    await act(async () => post.resolve(Response.json({ ...professional("professional-new"), publicName: "Beatriz" })));
    expect(f.host.textContent).not.toContain("Beatriz"); expect(f.host.textContent).not.toContain("Profissional salvo.");
    expect(f.calls.filter(call => call.method === "POST").map(call => call.path)).toEqual(["/v1/merchants/merchant-a/service-professionals"]);
    expect(f.calls.filter(call => call.method === "GET" && call.path === "/v1/merchants/merchant-a/service-professionals")).toHaveLength(1);
  });

  it("returns focus to Edit for the same professional when successful deactivation removes its original trigger", async () => {
    const f = await fixture(), trigger = f.host.querySelector<HTMLButtonElement>('button[aria-label="Desativar Ana"]')!;
    await act(async () => { trigger.focus(); trigger.click(); }); await click("Desativar profissional");
    expect(f.rows()[0]).toMatchObject({ id: "professional-a", isActive: false, isPublished: false, version: 8 });
    expect(trigger.isConnected).toBe(false); expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(f.host.textContent).toContain("Profissional desativado."); expect(f.host.textContent).toContain("Inativo");
    expect(document.activeElement).toBe(f.host.querySelector('button[aria-label="Editar Ana"]'));
    expect(f.calls.filter(call => call.method === "POST")).toEqual([{ path: "/v1/merchants/merchant-a/service-professionals/professional-a/deactivate", method: "POST", body: { expectedVersion: 7 } }]);
  });
});
