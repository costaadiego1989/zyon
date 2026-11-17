/** @vitest-environment jsdom */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { createDashboardApi, type MerchantProfile } from "../../api-client.js";
import type { CreateCategoryInput, UpdateCategoryInput } from "../../api/endpoints/catalog.js";
import { ApiContext } from "../../hooks/useApi.js";
import { CategoryForm } from "../categories/components/CategoryForm.js";
import { ServiceAttendancePage } from "./ServiceAttendancePage.js";

const me: MerchantProfile = { id: "merchant-a", user_id: "operator-a", name: "A", role: "OWNER", businessMode: "services", businessModeSelectionState: "selected" };
const category = (id = "category-a", name = "Consultas") => ({ id, name, slug: id, parent_id: null, description: "", image_url: "", is_active: true, sort_order: 0, product_count: 0, created_at: "2026-11-17T06:00:00Z", updated_at: "2026-11-17T06:00:00Z" });
interface Call { path: string; method: string; body: Record<string, unknown> }
const mounts: Array<{ root: Root; host: HTMLDivElement }> = [];
afterEach(async () => { for (const { root, host } of mounts.splice(0)) { await act(async () => root.unmount()); host.remove(); } });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }

async function fixture(options: { refresh?: ReturnType<typeof deferred<Response>>; refreshFails?: boolean; post?: ReturnType<typeof deferred<Response>> } = {}) {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); window.history.replaceState(null, "", "/#service-attendance?tab=categories");
  const calls: Call[] = []; let rows = [category()], ownerReads = 0;
  const api = createDashboardApi({ baseUrl: "https://api.example.test", fetchImpl: (async (input, init) => {
    const path = new URL(String(input)).pathname, method = init?.method ?? "GET", body = init?.body ? JSON.parse(String(init.body)) : {}; calls.push({ path, method, body });
    if (path.endsWith("/service-professionals")) return Response.json({ items: [], nextCursor: null });
    if (path.endsWith("/service-business-policy")) return Response.json({ status: "unconfigured", version: 0, policy: null });
    if (path.endsWith("/categories") && method === "GET") {
      if (!path.includes("/merchant-a/")) return Response.json([category("category-b", "Outro contexto")]);
      ownerReads++;
      if (ownerReads > 1 && options.refresh) return options.refresh.promise;
      if (ownerReads > 1 && options.refreshFails) return Response.json({ detail: "unavailable" }, { status: 503 });
      return Response.json(rows);
    }
    if (path.endsWith("/categories") && method === "POST") {
      if (options.post) return options.post.promise;
      const row = { ...category("category-new", String(body.name)), slug: String(body.slug) };
      rows = [...rows, row]; return Response.json(row, { status: 201 });
    }
    if (path.includes("/categories/") && method === "DELETE") { rows = rows.filter(row => row.id !== path.split("/").at(-1)); return Response.json({ deleted: true }); }
    throw new Error("Unexpected request " + method + " " + path);
  }) as typeof fetch });
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host); mounts.push({ root, host });
  const render = async (current: MerchantProfile) => { await act(async () => root.render(<ApiContext.Provider value={api}><ServiceAttendancePage me={current} /></ApiContext.Provider>)); };
  const renderProductForm = async (onSave: (value: CreateCategoryInput | UpdateCategoryInput) => void) => { await act(async () => root.render(<ApiContext.Provider value={api}><CategoryForm mode="create" category={null} parentOptions={[]} saving={false} onSave={onSave} onCancel={() => {}} /></ApiContext.Provider>)); };
  await render(me); return { host, calls, render, renderProductForm, rows: () => rows };
}
function button(label: string) { return Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find(node => node.textContent?.trim() === label)!; }
async function click(label: string) { await act(async () => button(label).click()); }
async function enterName(value: string) { await act(async () => {
  const label = Array.from(document.querySelectorAll<HTMLLabelElement>("label")).find(row => row.textContent?.trim() === "Nome da categoria")!;
  const field = document.getElementById(label.htmlFor) as HTMLInputElement;
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field, value); field.dispatchEvent(new Event("input", { bubbles: true }));
}); }
async function openAndFill() { const opener = button("Nova categoria"); await act(async () => { opener.focus(); opener.click(); }); await enterName("Avaliações"); return opener; }

describe("T77 actual category Page composition and product form compatibility", () => {
  it("keeps a category editor busy during post-save refresh, then shows canonical data feedback and focus", async () => {
    const refresh = deferred<Response>(), f = await fixture({ refresh }), opener = await openAndFill();
    const dialog = document.querySelector('[role="dialog"]'); await click("Criar categoria");
    expect(document.querySelector('[role="dialog"]')).toBe(dialog); expect(button("Criar categoria").disabled).toBe(true);
    expect(f.host.textContent).toContain("Atualizando atendimento"); expect(f.host.textContent).not.toContain("Categoria salva.");
    expect(f.calls.filter(call => call.method === "POST")).toEqual([{ path: "/v1/merchants/merchant-a/categories", method: "POST", body: { name: "Avaliações", slug: "avaliacoes", description: "", imageUrl: "" } }]);
    await act(async () => refresh.resolve(Response.json(f.rows())));
    expect(document.querySelector('[role="dialog"]')).toBeNull(); expect(f.host.textContent).toContain("Avaliações"); expect(f.host.textContent).toContain("Categoria salva."); expect(document.activeElement).toBe(opener);
    expect(f.calls.some(call => /appointments|payments|users/.test(call.path))).toBe(false);
  });

  it("keeps successful category creation distinct from a failed reload without resending or losing focus", async () => {
    const f = await fixture({ refreshFails: true }), opener = await openAndFill(); await click("Criar categoria");
    expect(f.rows().find(row => row.id === "category-new")?.name).toBe("Avaliações"); expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(f.host.textContent).toContain("Categoria salva."); expect(f.host.textContent).toContain("Não foi possível atualizar o atendimento"); expect(f.host.textContent).not.toContain("Avaliações");
    expect(document.activeElement).toBe(opener); expect(f.calls.filter(call => call.method === "POST")).toHaveLength(1);
  });

  it("masks the old category editor and ignores its late creation after the authenticated company changes", async () => {
    const post = deferred<Response>(), f = await fixture({ post }); await openAndFill(); await click("Criar categoria");
    await f.render({ ...me, id: "merchant-b", user_id: "operator-b" }); expect(document.querySelector('[role="dialog"]')).toBeNull(); expect(f.host.textContent).toContain("Outro contexto");
    await act(async () => post.resolve(Response.json(category("category-new", "Avaliações"), { status: 201 })));
    expect(f.host.textContent).not.toContain("Avaliações"); expect(f.host.textContent).not.toContain("Categoria salva.");
    expect(f.calls.filter(call => call.method === "POST").map(call => call.path)).toEqual(["/v1/merchants/merchant-a/categories"]);
    expect(f.calls.filter(call => call.method === "GET" && call.path === "/v1/merchants/merchant-a/categories")).toHaveLength(1);
  });

  it("deletes through confirmation and returns focus to the current new-category control when the old opener disappears", async () => {
    const f = await fixture(), trigger = button("Excluir Consultas"); await act(async () => { trigger.focus(); trigger.click(); }); await click("Excluir categoria");
    expect(f.rows()).toEqual([]); expect(trigger.isConnected).toBe(false); expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(f.host.textContent).toContain("Categoria excluída."); expect(f.host.textContent).toContain("Nenhuma categoria cadastrada"); expect(document.activeElement).toBe(button("Nova categoria"));
    expect(f.calls.filter(call => call.method === "DELETE")).toEqual([{ path: "/v1/merchants/merchant-a/categories/category-a", method: "DELETE", body: {} }]);
  });

  it("preserves the default product CategoryForm copy and original category payload", async () => {
    const f = await fixture(); let saved: CreateCategoryInput | UpdateCategoryInput | null = null;
    await f.renderProductForm(value => { saved = value; }); expect(document.body.textContent).toContain("Agrupe produtos"); expect(document.body.textContent).not.toContain("Agrupe serviços");
    expect(document.querySelector<HTMLInputElement>('input[placeholder="Ex.: Camisetas"]')).not.toBeNull(); await enterName("Camisetas"); await click("Criar categoria");
    expect(saved).toEqual({ name: "Camisetas", slug: "camisetas", description: "", image_url: "", parent_id: undefined }); expect(f.calls.filter(call => call.method !== "GET")).toEqual([]);
  });

  it("discards a pending focused category read on tenant change without refetching unrelated old-context resources", async () => {
    const refresh = deferred<Response>(), f = await fixture({ refresh }); await openAndFill(); await click("Criar categoria");
    await f.render({ ...me, id: "merchant-b", user_id: "operator-b" }); expect(document.querySelector('[role="dialog"]')).toBeNull(); expect(f.host.textContent).toContain("Outro contexto");
    await act(async () => refresh.resolve(Response.json(f.rows())));
    expect(f.host.textContent).not.toContain("Avaliações"); expect(f.host.textContent).not.toContain("Categoria salva.");
    expect(f.calls.filter(call => call.method === "GET" && call.path === "/v1/merchants/merchant-a/service-professionals")).toHaveLength(1);
    expect(f.calls.filter(call => call.method === "GET" && call.path === "/v1/merchants/me/service-business-policy")).toHaveLength(2);
    expect(f.calls.filter(call => call.method === "GET" && call.path === "/v1/merchants/merchant-a/categories")).toHaveLength(2);
    expect(f.calls.filter(call => call.method === "POST").map(call => call.path)).toEqual(["/v1/merchants/merchant-a/categories"]);
  });
});
