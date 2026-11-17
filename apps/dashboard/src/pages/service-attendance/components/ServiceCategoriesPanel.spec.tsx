/** @vitest-environment jsdom */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { createDashboardApi, type MerchantProfile, type Product } from "../../../api-client.js";
import { ApiContext } from "../../../hooks/useApi.js";
import { useServiceAttendancePage } from "../useServiceAttendancePage.js";
import { ServiceCategoriesPanel } from "./ServiceCategoriesPanel.js";

const me: MerchantProfile = { id: "merchant-a", user_id: "operator-a", name: "A", role: "OWNER", businessMode: "services", businessModeSelectionState: "selected" };
const category = (id = "category-a", extra = {}) => ({ id, name: id === "category-a" ? "Consultas" : id, slug: id, parent_id: null, description: "", image_url: "", is_active: true, sort_order: 0, product_count: 0, created_at: "2026-11-16T12:00:00Z", updated_at: "2026-11-16T12:00:00Z", ...extra });
const service = (id = "service-a", extra: Partial<Product> = {}): Product => ({ id, merchantId: me.id, name: id === "service-a" ? "Consulta inicial" : id, type: "service", isActive: true, categoryId: "category-a", metadata: { durationMinutes: 45 }, variants: [{ id: "variant-a", sku: id, attributes: {}, isActive: true, basePriceInCents: 5000, taxPercent: 0, currency: "BRL", stockQuantity: 0, stockReserved: 0, media: [] }], createdAt: "2026-11-16T12:00:00Z", updatedAt: "2026-11-16T12:00:00Z", ...extra });
interface Request { path: string; method: string; query: URLSearchParams; body: Record<string, unknown> }
const mounts: Array<{ root: Root; host: HTMLDivElement }> = [];
afterEach(async () => { for (const { root, host } of mounts.splice(0)) { await act(async () => root.unmount()); host.remove(); } });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
async function fixture(options: { current?: MerchantProfile | null; categories?: ReturnType<typeof category>[]; products?: Product[]; handle?: (r: Request) => Response | Promise<Response> | undefined } = {}) {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); window.history.replaceState(null, "", "/#service-attendance?tab=categories");
  let categories = options.categories ?? [category(), category("category-b")], products = options.products ?? [service()]; const requests: Request[] = [];
  const api = createDashboardApi({ baseUrl: "https://api.example.test", fetchImpl: (async (input, init) => {
    const url = new URL(String(input)), r: Request = { path: url.pathname, method: init?.method ?? "GET", query: url.searchParams, body: init?.body ? JSON.parse(String(init.body)) : {} }; requests.push(r);
    const handled = options.handle?.(r); if (handled !== undefined) return handled;
    if (r.path.endsWith("/service-professionals")) return Response.json({ items: [], nextCursor: null });
    if (r.path.endsWith("/service-business-policy")) return Response.json({ status: "unconfigured", version: 0, policy: null });
    if (r.path.endsWith("/categories") && r.method === "GET") return Response.json(categories);
    if (r.path.endsWith("/categories") && r.method === "POST") { const row = category("category-new", { name: r.body.name, slug: r.body.slug, parent_id: r.body.parentId ?? null }); categories = [...categories, row]; return Response.json(row); }
    if (r.path.includes("/categories/") && r.method === "PUT") { const id = r.path.split("/").at(-1)!; const row = { ...categories.find(item => item.id === id)!, ...(r.body.name !== undefined ? { name: String(r.body.name) } : {}), ...(r.body.isActive !== undefined ? { is_active: Boolean(r.body.isActive) } : {}), ...(r.body.parent_id !== undefined ? { parent_id: r.body.parent_id as null } : {}) }; categories = categories.map(item => item.id === id ? row : item); return Response.json(row); }
    if (r.path.includes("/categories/") && r.method === "DELETE") { categories = categories.filter(row => row.id !== r.path.split("/").at(-1)); return Response.json({ deleted: true }); }
    if (r.path.endsWith("/products") && r.method === "GET") return Response.json({ products, total: products.length });
    if (r.path.includes("/products/") && r.method === "GET") return Response.json(products.find(item => item.id === r.path.split("/").at(-1)));
    if (r.path.includes("/products/") && r.method === "PUT") { const id = r.path.split("/").at(-1)!; const row = { ...products.find(item => item.id === id)!, categoryId: String(r.body.categoryId) }; products = products.map(item => item.id === id ? row : item); return Response.json(row); }
    throw new Error("Unexpected request " + r.path);
  }) as typeof fetch });
  let view!: ReturnType<typeof useServiceAttendancePage>;
  function Probe({ current }: { current: MerchantProfile | null }) { const vm = useServiceAttendancePage({ me: current }); view = vm; return <ServiceCategoriesPanel me={current} vm={vm} />; }
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host); mounts.push({ root, host });
  const render = async (current: MerchantProfile | null) => { await act(async () => root.render(<ApiContext.Provider value={api}><Probe current={current} /></ApiContext.Provider>)); };
  await render(options.current === undefined ? me : options.current);
  return { host, requests, render, categories: () => categories, products: () => products, vm: () => view };
}
const button = (label: string) => Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find(row => row.textContent?.trim() === label)!;
async function click(label: string) { await act(async () => button(label).click()); }
function labelled<T extends HTMLElement>(label: string): T { const node = Array.from(document.querySelectorAll("label")).find(row => row.textContent?.trim() === label); return document.getElementById(node?.getAttribute("for") ?? "") as T; }
async function enter(label: string, value: string) { await act(async () => { const field = labelled<HTMLInputElement>(label); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field, value); field.dispatchEvent(new Event("input", { bubbles: true })); }); }
async function select(label: string, value: string) { await act(async () => { const field = document.querySelector<HTMLSelectElement>(`select[aria-label="${label}"]`)!; field.value = value; field.dispatchEvent(new Event("change", { bubbles: true })); }); }
const writes = (f: Awaited<ReturnType<typeof fixture>>) => f.requests.filter(r => r.method !== "GET");

describe("T77 service category criterion gestures", () => {
  it("lists existing categories without presenting category as capacity or fetching appointments", async () => {
    const f = await fixture(); expect(f.host.textContent).toContain("Consultas"); expect(f.host.textContent).not.toMatch(/vagas|capacidade|R\$/); expect(f.requests.some(r => /appointments|slots|payments/.test(r.path))).toBe(false);
  });
  it.each([{ ...me, role: "STAFF" as const }, { ...me, businessMode: "products" as const }, null])("denies context %j before category or catalog requests", async current => {
    const f = await fixture({ current }); expect(f.host.textContent).toContain("Sem permissão para gerenciar categorias de serviços"); expect(f.requests).toEqual([]);
  });
  it("creates from the actual reused form with the service-specific copy and canonical payload", async () => {
    const f = await fixture(); await click("Nova categoria"); expect(document.body.textContent).toContain("Agrupe serviços");
    expect(document.body.textContent).toContain("consulta-inicial"); expect(document.body.textContent).not.toContain("camisetas-infantis");
    await enter("Nome da categoria", "Avaliações"); await click("Criar categoria");
    expect(writes(f).map(r => ({ method: r.method, body: r.body }))).toEqual([{ method: "POST", body: { name: "Avaliações", slug: "avaliacoes", description: "", imageUrl: "" } }]); expect(f.categories().find(row => row.id === "category-new")?.name).toBe("Avaliações"); expect(document.body.textContent).toContain("Categoria salva.");
  });
  it("edits the reused form without changing slug or sending product capacity and price", async () => {
    const f = await fixture(); await click("Editar Consultas"); await enter("Nome da categoria", "Consultas clínicas"); await click("Salvar categoria");
    expect(writes(f)[0].body).toEqual({ name: "Consultas clínicas", parent_id: null, description: "", imageUrl: "" }); expect(f.categories()[0].name).toBe("Consultas clínicas");
  });
  it("uses an accessible toggle gesture and canonical update for category activity", async () => {
    const f = await fixture(); const toggle = labelled<HTMLButtonElement>("Categoria Consultas ativa"); expect(toggle.getAttribute("role")).toBe("switch"); expect(toggle.getAttribute("aria-checked")).toBe("true");
    await act(async () => toggle.click()); expect(writes(f)[0].body).toEqual({ isActive: false }); expect(labelled<HTMLButtonElement>("Categoria Consultas ativa").getAttribute("aria-checked")).toBe("false");
  });
  it("supports cancelling the real deletion confirmation without changing the category", async () => {
    const f = await fixture(); await click("Excluir Consultas"); expect(document.querySelector('[role="dialog"]')?.textContent).toContain("Consultas"); await click("Cancelar"); expect(writes(f)).toEqual([]); expect(f.categories()[0].id).toBe("category-a");
  });
  it("shows a useful empty category state and catalog error independently", async () => {
    const f = await fixture({ categories: [], handle: r => r.path.endsWith("/products") ? Response.json({ detail: "unavailable" }, { status: 503 }) : undefined });
    expect(f.host.textContent).toContain("Nenhuma categoria cadastrada"); await click("Consultar serviços publicados"); expect(f.host.textContent).toContain("Não foi possível consultar os serviços."); expect(writes(f)).toEqual([]);
  });
  it("follows a catalog cursor after a page with no service and does not use its total as service count", async () => {
    const f = await fixture({ handle: r => r.path.endsWith("/products") ? Response.json(r.query.get("cursor") ? { products: [service()], total: 99 } : { products: [service("physical-a", { type: "physical" })], total: 99, nextCursor: "next-page" }) : undefined });
    await click("Consultar serviços publicados"); expect(f.host.textContent).toContain("Nenhum serviço nesta página"); expect(f.host.textContent).not.toContain("99 serviços"); await click("Carregar mais itens do catálogo"); expect(f.host.textContent).toContain("Consulta inicial");
    expect(f.requests.filter(r => r.path.endsWith("/products")).map(r => Object.fromEntries(r.query))).toEqual([{ status: "active", limit: "25" }, { status: "active", limit: "25", cursor: "next-page" }]);
  });
  it("associates one published canonical service and preserves its price metadata and variants", async () => {
    const f = await fixture(); const before = f.products()[0]; await click("Consultar serviços publicados"); await select("Categoria de Consulta inicial", "category-b"); await click("Salvar categoria de Consulta inicial");
    expect(writes(f).map(r => ({ path: r.path, method: r.method, body: r.body }))).toEqual([{ path: "/v1/merchants/merchant-a/products/service-a", method: "PUT", body: { categoryId: "category-b" } }]); expect(f.products()[0]).toEqual({ ...before, categoryId: "category-b" }); expect(f.host.textContent).toContain("Vínculo de categoria salvo.");
  });
  it("preserves an existing inactive category choice instead of silently assigning another category", async () => {
    const f = await fixture({ categories: [category("category-a", { is_active: false }), category("category-b")] }); await click("Consultar serviços publicados");
    expect(document.querySelector<HTMLSelectElement>('select[aria-label="Categoria de Consulta inicial"]')?.value).toBe("category-a"); expect(button("Salvar categoria de Consulta inicial").disabled).toBe(true); expect(writes(f)).toEqual([]);
  });
  it("keeps the selected category on a real API conflict and requires explicit reconciliation", async () => {
    const f = await fixture({ handle: r => r.path.includes("/products/") && r.method === "PUT" ? Response.json({ detail: "category_not_found" }, { status: 409 }) : undefined }); await click("Consultar serviços publicados"); await select("Categoria de Consulta inicial", "category-b"); await click("Salvar categoria de Consulta inicial");
    expect(f.products()[0].categoryId).toBe("category-a"); expect(f.host.textContent).toContain("Confira os dados atuais antes de salvar novamente."); expect(writes(f)).toHaveLength(1);
  });
  it("does not duplicate a service mutation during its pending response", async () => {
    const pending = deferred<Response>(); const f = await fixture({ handle: r => r.path.includes("/products/") && r.method === "PUT" ? pending.promise : undefined }); await click("Consultar serviços publicados"); await select("Categoria de Consulta inicial", "category-b");
    await act(async () => { button("Salvar categoria de Consulta inicial").click(); button("Salvar categoria de Consulta inicial").click(); }); expect(writes(f)).toHaveLength(1); expect(f.products()[0].categoryId).toBe("category-a");
    await act(async () => pending.resolve(Response.json({ ...service(), categoryId: "category-b" }))); expect(writes(f)).toHaveLength(1);
  });
  it("masks an old catalog response after the authenticated merchant changes", async () => {
    const pending = deferred<Response>(); const f = await fixture({ handle: r => r.path.endsWith("/products") ? pending.promise : undefined }); await click("Consultar serviços publicados"); await f.render({ ...me, id: "merchant-b" });
    await act(async () => pending.resolve(Response.json({ products: [service()], total: 1 }))); expect(f.host.textContent).not.toContain("Consulta inicial"); expect(writes(f)).toEqual([]);
  });
  it("keeps the reused form open after blank-name submission without a write", async () => {
    const f = await fixture(); await click("Nova categoria"); await click("Criar categoria"); expect(document.body.textContent).toContain("Informe o nome da categoria."); expect(document.querySelector('[role="dialog"]')).not.toBeNull(); expect(writes(f)).toEqual([]);
  });
  it("checks the canonical offer before assignment and refuses one that became unpublished", async () => {
    const f = await fixture({ handle: r => r.path.includes("/products/") && r.method === "GET" ? Response.json(service("service-a", { isActive: false })) : undefined });
    await click("Consultar serviços publicados"); await select("Categoria de Consulta inicial", "category-b"); await click("Salvar categoria de Consulta inicial"); expect(writes(f)).toEqual([]); expect(f.products()[0].categoryId).toBe("category-a"); expect(f.host.textContent).toContain("Não foi possível salvar.");
  });
  it("does not write after context changes during the required canonical offer read", async () => {
    const pending = deferred<Response>(); const f = await fixture({ handle: r => r.path.includes("/products/") && r.method === "GET" ? pending.promise : undefined });
    await click("Consultar serviços publicados"); await select("Categoria de Consulta inicial", "category-b"); await click("Salvar categoria de Consulta inicial"); await f.render({ ...me, id: "merchant-b" });
    await act(async () => pending.resolve(Response.json(service()))); expect(writes(f)).toEqual([]); expect(f.host.textContent).not.toContain("Vínculo de categoria salvo.");
  });
  it("blocks an uncertain mutation until explicit read reconciliation and does not automatically resend", async () => {
    const f = await fixture({ handle: r => { if (r.path.includes("/products/") && r.method === "PUT") throw new TypeError("connection_closed"); return undefined; } });
    await click("Consultar serviços publicados"); await select("Categoria de Consulta inicial", "category-b"); await click("Salvar categoria de Consulta inicial");
    expect(f.host.textContent).toContain("Não foi possível confirmar o resultado."); expect(button("Salvar categoria de Consulta inicial").disabled).toBe(true); expect(writes(f)).toHaveLength(1);
    await click("Atualizar dados e vínculos"); expect(writes(f)).toHaveLength(1); expect(document.querySelector<HTMLSelectElement>('select[aria-label="Categoria de Consulta inicial"]')?.value).toBe("category-a");
    await select("Categoria de Consulta inicial", "category-b"); expect(button("Salvar categoria de Consulta inicial").disabled).toBe(false); await click("Salvar categoria de Consulta inicial"); expect(writes(f)).toHaveLength(2); expect(writes(f).map(r => r.body)).toEqual([{ categoryId: "category-b" }, { categoryId: "category-b" }]);
  });

  it("preserves the selected category and write fence when explicit reconciliation fails", async () => {
    let attempted = false;
    const f = await fixture({ handle: r => {
      if (r.path.includes("/products/") && r.method === "PUT") { attempted = true; throw new TypeError("connection_closed"); }
      if (attempted && r.path.endsWith("/categories") && r.method === "GET") return Response.json({ detail: "unavailable" }, { status: 503 });
      return undefined;
    } });
    await click("Consultar serviços publicados"); await select("Categoria de Consulta inicial", "category-b"); await click("Salvar categoria de Consulta inicial");
    await click("Atualizar dados e vínculos"); expect(writes(f)).toHaveLength(1);
    expect(document.querySelector<HTMLSelectElement>('select[aria-label="Categoria de Consulta inicial"]')?.value).toBe("category-b");
    expect(button("Salvar categoria de Consulta inicial").disabled).toBe(true); expect(f.host.textContent).toContain("Não foi possível confirmar o resultado."); expect(f.products()[0].categoryId).toBe("category-a");
  });

  it("reconciles category data and consulted offers while preserving the actual unrelated professional and policy snapshot", async () => {
    let changed = false;
    const f = await fixture({ handle: r => {
      if (r.path.includes("/categories/") && r.method === "PUT") changed = true;
      if (changed && r.method === "GET" && (r.path.endsWith("/service-professionals") || r.path.endsWith("/service-business-policy"))) return Response.json({}, { status: 503 });
      return undefined;
    } });
    await click("Consultar serviços publicados"); const before = f.vm().loadState.data!, offer = structuredClone(f.products()[0]), start = f.requests.length;
    await act(async () => labelled<HTMLButtonElement>("Categoria Consultas ativa").click());
    expect(f.vm().loadState.status).toBe("ready"); expect(f.vm().loadState.data?.categories[0].is_active).toBe(false);
    expect(f.vm().loadState.data?.professionals).toEqual(before.professionals); expect(f.vm().loadState.data?.policy).toEqual(before.policy); expect(f.products()[0]).toEqual(offer);
    expect(document.body.textContent).toContain("Consultas (inativa)"); expect(document.querySelector<HTMLSelectElement>('select[aria-label="Categoria de Consulta inicial"]')?.value).toBe("category-a");
    const reads = f.requests.slice(start).filter(r => r.method === "GET"); expect(reads.map(r => r.path)).toEqual(["/v1/merchants/merchant-a/categories", "/v1/merchants/merchant-a/products"]);
  });

  it("keeps the draft and uncertain fence when categories reconcile but the required canonical offer read fails", async () => {
    let attempted = false;
    const f = await fixture({ handle: r => {
      if (r.path.includes("/products/") && r.method === "PUT") { attempted = true; throw new TypeError("connection_closed"); }
      if (attempted && r.path.endsWith("/products") && r.method === "GET") return Response.json({}, { status: 503 });
      return undefined;
    } });
    await click("Consultar serviços publicados"); await select("Categoria de Consulta inicial", "category-b"); await click("Salvar categoria de Consulta inicial"); await click("Atualizar dados e vínculos");
    expect(f.vm().command.status).toBe("uncertain"); expect(writes(f)).toHaveLength(1); expect(f.products()[0].categoryId).toBe("category-a");
    expect(document.querySelector<HTMLSelectElement>('select[aria-label="Categoria de Consulta inicial"]')?.value).toBe("category-b"); expect(button("Salvar categoria de Consulta inicial").disabled).toBe(true);
    expect(f.host.textContent).toContain("Não foi possível consultar os serviços.");
  });

  it("blocks category editing during a canonical offer read and resumes only after that read settles", async () => {
    const pending = deferred<Response>(), f = await fixture({ handle: r => r.path.endsWith("/products") && r.method === "GET" ? pending.promise : undefined });
    await click("Consultar serviços publicados"); expect(button("Nova categoria").disabled).toBe(true); expect(button("Editar Consultas").disabled).toBe(true); expect(labelled<HTMLButtonElement>("Categoria Consultas ativa").disabled).toBe(true);
    await click("Nova categoria"); expect(document.querySelector('[role="dialog"]')).toBeNull(); expect(writes(f)).toEqual([]);
    await act(async () => pending.resolve(Response.json({ products: [service()], total: 1 })));
    expect(button("Nova categoria").disabled).toBe(false); await click("Nova categoria"); expect(document.querySelector('[role="dialog"]')?.textContent).toContain("Nome da categoria"); expect(writes(f)).toEqual([]);
  });

  it("fully reconciles a professional issue from the categories panel and cannot clear a later issue when the old offer read settles", async () => {
    const pending = deferred<Response>(); let version = 7, updates = 0;
    const professional = () => ({ id: "professional-a", merchantId: me.id, publicName: "Ana", publicProfile: {}, timeZone: "America/Sao_Paulo", isActive: true, isPublished: true, version, services: [], createdAt: "2026-11-16T12:00:00Z", updatedAt: "2026-11-16T12:00:00Z" });
    const f = await fixture({ handle: r => {
      if (r.path.endsWith("/service-professionals") && r.method === "GET") return Response.json({ items: [professional()], nextCursor: null });
      if (r.path.endsWith("/service-business-policy") && r.method === "GET") return Response.json({ status: "configured", version: updates ? 2 : 1, policy: { holdEnabled: false, holdMinutes: null, paymentMode: "at_attendance", admissionsEnabled: false } });
      if (r.path.endsWith("/service-professionals/professional-a") && r.method === "PATCH") { updates++; version++; return Response.json({ detail: "service_professional_stale" }, { status: 409 }); }
      if (r.path.endsWith("/products") && r.method === "GET") return pending.promise;
      return undefined;
    } });
    await act(async () => { await f.vm().actions.updateProfessional("professional-a", { expectedVersion: 7, publicName: "Primeiro rascunho" }); });
    await click("Atualizar dados e vínculos");
    expect(f.vm().loadState.data?.professionals.items[0].version).toBe(8); expect(f.vm().loadState.data?.policy.version).toBe(2);
    await act(async () => { await f.vm().refresh(); });
    await act(async () => { await f.vm().actions.updateProfessional("professional-a", { expectedVersion: 8, publicName: "Segundo rascunho" }); });
    expect(updates).toBe(2); expect(f.vm().command.status).toBe("conflict");
    await act(async () => pending.resolve(Response.json({ products: [service()], total: 1 })));
    expect(f.vm().command.status).toBe("conflict"); expect(f.vm().loadState.data?.professionals.items[0].version).toBe(8); expect(f.vm().loadState.data?.policy.version).toBe(2);
    let blocked: unknown; await act(async () => { blocked = await f.vm().actions.updateProfessional("professional-a", { expectedVersion: 8, publicName: "Envio bloqueado" }); });
    expect(blocked).toEqual({ status: "error", kind: "conflict" }); expect(updates).toBe(2); expect(writes(f)).toHaveLength(2);
  });
});
