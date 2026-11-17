/** @vitest-environment jsdom */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { createDashboardApi, type MerchantProfile, type Product } from "../../../api-client.js";
import { ApiContext } from "../../../hooks/useApi.js";
import { useServiceAttendancePage } from "../useServiceAttendancePage.js";
import { ProfessionalsPanel } from "./ProfessionalsPanel.js";
import type { ServiceProfessionalDTO } from "../../../api/endpoints/service-attendance.js";

const me: MerchantProfile = { id: "merchant-a", user_id: "operator-a", name: "A", role: "OWNER", businessMode: "services", businessModeSelectionState: "selected" };
const professional = (id = "professional-a", merchantId = me.id): ServiceProfessionalDTO => ({ id, merchantId, publicName: merchantId === me.id ? "Ana" : "Bruno", publicProfile: { description: "Perfil original", specialties: ["Coluna"] }, timeZone: "America/Sao_Paulo", isActive: true, isPublished: true, version: 7, services: [{ id: "link-a", productId: "service-a", version: 2 }, { id: "link-hidden", productId: "outside-page", version: 3 }], createdAt: "2026-11-16T12:00:00.000Z", updatedAt: "2026-11-16T12:00:00.000Z" });
const product = (id: string, type = "service", merchantId = me.id): Product => ({ id, merchantId, name: id === "service-a" ? "Consulta" : id, type, isActive: true, createdAt: "2026-11-16T12:00:00Z", updatedAt: "2026-11-16T12:00:00Z", variants: [{ id: id + "-variant", sku: id, attributes: {}, isActive: true, basePriceInCents: 5000, taxPercent: 0, currency: "BRL", stockQuantity: 0, stockReserved: 0, media: [] }] });
interface Request { path: string; query: URLSearchParams; method: string; body: Record<string, unknown>; key: string | null }
const roots: Array<{ root: Root; host: HTMLDivElement }> = [];
afterEach(async () => { for (const { root, host } of roots.splice(0)) { await act(async () => root.unmount()); host.remove(); } window.history.replaceState(null, "", "/#service-attendance?tab=professionals"); });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
async function fixture(options: { current?: MerchantProfile | null; records?: ServiceProfessionalDTO[]; handle?: (request: Request) => Response | Promise<Response> | undefined } = {}) {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); window.history.replaceState(null, "", "/#service-attendance?tab=professionals");
  let records = options.records ?? [professional()]; const requests: Request[] = [];
  const api = createDashboardApi({ baseUrl: "https://api.example.test", fetchImpl: (async (input, init) => {
    const url = new URL(String(input)), r: Request = { path: url.pathname, query: url.searchParams, method: init?.method ?? "GET", body: init?.body ? JSON.parse(String(init.body)) : {}, key: new Headers(init?.headers).get("Idempotency-Key") }; requests.push(r);
    const handled = options.handle?.(r); if (handled !== undefined) return handled;
    if (r.path.endsWith("/categories")) return Response.json([]);
    if (r.path.endsWith("/service-business-policy")) return Response.json({ status: "unconfigured", version: 0, policy: null });
    if (r.path.endsWith("/products")) return Response.json({ products: [product("service-a"), product("physical-a", "physical")], total: 2 });
    if (r.path.endsWith("/service-professionals") && r.method === "GET") {
      const merchantId = r.path.split("/")[3];
      return Response.json({ items: merchantId === me.id ? records : [professional("professional-b", merchantId)], nextCursor: null });
    }
    if (r.path.endsWith("/service-professionals") && r.method === "POST") {
      const row = { ...professional("professional-new"), ...r.body, version: 1, services: (r.body.productIds as string[]).map((productId, i) => ({ id: "new-link-" + i, productId, version: 1 })) } as ServiceProfessionalDTO;
      records = [...records, row]; return Response.json(row);
    }
    const id = r.path.endsWith("/deactivate") ? r.path.split("/").at(-2)! : r.path.split("/").at(-1)!;
    if (r.method === "PATCH" || r.path.endsWith("/deactivate")) {
      const before = records.find(row => row.id === id)!;
      const row = { ...before, ...r.body, ...(r.path.endsWith("/deactivate") ? { isActive: false, isPublished: false } : {}), version: before.version + 1,
        services: r.body.productIds === undefined ? before.services : (r.body.productIds as string[]).map((productId, i) => ({ id: "saved-link-" + i, productId, version: 1 })) } as ServiceProfessionalDTO;
      records = records.map(item => item.id === id ? row : item); return Response.json(row);
    }
    throw new Error("Unexpected request " + r.path);
  }) as typeof fetch });
  function Probe({ current }: { current: MerchantProfile | null }) { const vm = useServiceAttendancePage({ me: current }); return <ProfessionalsPanel me={current} vm={vm} />; }
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host); roots.push({ root, host });
  const render = async (current: MerchantProfile | null) => { await act(async () => root.render(<ApiContext.Provider value={api}><Probe current={current} /></ApiContext.Provider>)); };
  await render(options.current === undefined ? me : options.current);
  return { host, requests, render, records: () => records };
}
const named = (label: string) => Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find(button => button.textContent?.trim() === label || button.getAttribute("aria-label") === label)!;
const field = (label: string) => { const node = Array.from(document.querySelectorAll<HTMLLabelElement>("label")).find(item => item.textContent?.trim() === label)!; return document.getElementById(node.htmlFor) as HTMLInputElement | HTMLTextAreaElement; };
const toggle = (label: string) => { const node = Array.from(document.querySelectorAll<HTMLLabelElement>("label")).find(item => item.textContent?.trim() === label)!; return document.getElementById(node.htmlFor) as HTMLButtonElement; };
const serviceToggle = (name: string) => {
  const label = Array.from(document.querySelectorAll<HTMLLabelElement>("label")).find(item => item.textContent?.trim() === "Vincular " + name);
  return label ? document.getElementById(label.htmlFor) as HTMLButtonElement | null : null;
};
async function enter(label: string, value: string) { await act(async () => { const input = field(label), proto = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })); }); }
async function click(label: string) { await act(async () => named(label).click()); }
const writes = (f: Awaited<ReturnType<typeof fixture>>) => f.requests.filter(r => r.method !== "GET");

describe("T76 cache criterion cases, not yet executed", () => {
  it("lists canonical public name timezone and state without loading a login or appointment endpoint", async () => {
    const f = await fixture();
    expect(f.host.textContent).toContain("Ana"); expect(f.host.textContent).toContain("America/Sao_Paulo"); expect(f.host.textContent).toContain("Publicado");
    expect(f.requests.some(r => /auth|users|appointments/.test(r.path))).toBe(false);
    expect(f.requests.some(r => r.path.endsWith("/products"))).toBe(false);
  });
  it.each([{ ...me, role: "STAFF" as const }, { ...me, businessMode: "products" as const }, null])("denies management context %j before catalog and write requests", async current => {
    const f = await fixture({ current }); expect(f.host.textContent).toContain("Sem permissão para gerenciar profissionais"); expect(f.requests).toEqual([]);
  });
  it("creates through actual form and service toggle gestures with only public fields", async () => {
    const f = await fixture(); await click("Novo profissional"); await enter("Nome público", "Beatriz"); await enter("Fuso horário", "America/Sao_Paulo");
    await act(async () => serviceToggle("Consulta")!.click());
    await click("Salvar profissional");
    expect(writes(f)).toHaveLength(1); expect(writes(f)[0]).toMatchObject({ path: "/v1/merchants/merchant-a/service-professionals", method: "POST", body: { publicName: "Beatriz", publicProfile: { description: "", specialties: [] }, timeZone: "America/Sao_Paulo", isActive: true, isPublished: false, productIds: ["service-a"] } });
    expect(Object.keys(writes(f)[0].body).sort()).toEqual(["isActive", "isPublished", "productIds", "publicName", "publicProfile", "timeZone"].sort());
    expect(f.records().find(row => row.id === "professional-new")?.publicName).toBe("Beatriz"); expect(document.querySelector('[role="dialog"]')).toBeNull();
  });
  it("edits a public name with CAS while preserving off-page links and unchanged public profile", async () => {
    const f = await fixture(); await click("Editar Ana"); await enter("Nome público", "Ana Silva"); await click("Salvar profissional");
    expect(writes(f)[0].body).toEqual({ publicName: "Ana Silva", timeZone: "America/Sao_Paulo", isActive: true, isPublished: true, expectedVersion: 7 });
    expect(f.records()[0].services.map(link => link.productId)).toEqual(["service-a", "outside-page"]); expect(f.host.textContent).toContain("Ana Silva");
  });
  it("changes one real service association without dropping another link outside the loaded catalog page", async () => {
    const f = await fixture(); await click("Editar Ana"); expect(document.body.textContent).toContain("outside-page");
    await act(async () => serviceToggle("Consulta")!.click()); await click("Salvar profissional");
    expect(writes(f)[0].body).toMatchObject({ expectedVersion: 7, productIds: ["outside-page"] }); expect(f.records()[0].services.map(link => link.productId)).toEqual(["outside-page"]);
  });
  it("continues an actual catalog cursor after a page with no service instead of claiming a false empty result", async () => {
    const f = await fixture({ handle: r => r.path.endsWith("/products") ? Response.json(r.query.get("cursor") ? { products: [product("service-b")], total: 2 } : { products: [product("physical-a", "physical")], total: 2, nextCursor: "catalog-cursor" }) : undefined });
    await click("Novo profissional"); expect(document.body.textContent).toContain("Nenhum serviço nesta página"); expect(document.body.textContent).not.toContain("Nenhum serviço cadastrado");
    await click("Carregar mais itens do catálogo"); expect(serviceToggle("service-b")).not.toBeNull();
    expect(f.requests.filter(r => r.path.endsWith("/products")).map(r => Object.fromEntries(r.query))).toEqual([{ status: "all", limit: "25" }, { status: "all", limit: "25", cursor: "catalog-cursor" }]);
  });
  it("validates an invalid timezone after the submit gesture without sending a mutation", async () => {
    const f = await fixture(); await click("Novo profissional"); await enter("Nome público", "Ana"); await enter("Fuso horário", "invalid/timezone"); await click("Salvar profissional");
    expect(document.body.textContent).toContain("Informe um fuso horário IANA válido."); expect(writes(f)).toEqual([]);
  });
  it("explains deactivation impact without inventing appointment counts and supports cancellation", async () => {
    const f = await fixture(); await click("Desativar Ana");
    expect(document.body.textContent).toContain("O profissional deixará de aparecer para novos agendamentos.");
    expect(document.body.textContent).toContain("Os agendamentos já confirmados serão mantidos, assim como o histórico de atendimentos.");
    expect(document.body.textContent).not.toMatch(/\d+ agendamentos afetados/); await click("Cancelar"); expect(writes(f)).toEqual([]); expect(f.records()[0].isActive).toBe(true);
  });
  it("deactivates only through the canonical command and waits for the real result", async () => {
    const result = deferred<Response>(); const f = await fixture({ handle: r => r.path.endsWith("/deactivate") ? result.promise : undefined });
    await click("Desativar Ana"); await click("Desativar profissional"); expect(f.records()[0].isActive).toBe(true); expect(named("Desativar profissional").disabled).toBe(true);
    await act(async () => result.resolve(Response.json({ ...professional(), isActive: false, isPublished: false, version: 8 })));
    expect(writes(f).map(r => ({ path: r.path, body: r.body }))).toEqual([{ path: "/v1/merchants/merchant-a/service-professionals/professional-a/deactivate", body: { expectedVersion: 7 } }]);
    expect(document.querySelector('[role="dialog"]')).toBeNull(); expect(f.requests.some(r => /appointments|payments|users/.test(r.path))).toBe(false);
  });
  it("reflects the returned deactivation snapshot while retaining the professional identity and service links", async () => {
    const f = await fixture(); const before = structuredClone(f.records()[0]);
    await click("Desativar Ana"); await click("Desativar profissional");
    expect(f.records()[0]).toMatchObject({ id: before.id, merchantId: before.merchantId, isActive: false, isPublished: false, version: before.version + 1, services: before.services });
    expect(f.host.textContent).toContain("Inativo");
    expect(f.host.querySelector(`[data-professional-id="${before.id}"]`)?.textContent).toContain("Ana");
    expect(writes(f).map(r => r.method)).toEqual(["POST"]);
  });
  it("preserves the draft and old real snapshot on conflict without pretending the edit succeeded", async () => {
    const f = await fixture({ handle: r => r.method === "PATCH" ? Response.json({ message: "service_professional_stale" }, { status: 409 }) : undefined });
    await click("Editar Ana"); await enter("Nome público", "Meu rascunho"); await click("Salvar profissional");
    expect(field("Nome público").value).toBe("Meu rascunho"); expect(document.body.textContent).toContain("Seu rascunho foi preservado"); expect(f.records()[0].publicName).toBe("Ana"); expect(writes(f)).toHaveLength(1);
  });
  it("surfaces a real foreign/not-found denial and does not create a replacement professional", async () => {
    const f = await fixture({ handle: r => r.method === "PATCH" ? Response.json({ message: "service_professional_not_found" }, { status: 404 }) : undefined });
    await click("Editar Ana"); await enter("Nome público", "Rascunho"); await click("Salvar profissional");
    expect(document.body.textContent).toContain("Não foi possível localizar este profissional"); expect(field("Nome público").value).toBe("Rascunho"); expect(writes(f).map(r => r.method)).toEqual(["PATCH"]);
  });
  it("retains an uncertain result and never automatically resends the professional mutation", async () => {
    const f = await fixture({ handle: r => { if (r.method !== "GET") throw new Error("network unavailable"); return undefined; } });
    await click("Editar Ana"); await enter("Nome público", "Rascunho"); await click("Salvar profissional");
    expect(document.body.textContent).toContain("Não foi possível confirmar o resultado"); expect(writes(f)).toHaveLength(1); expect(field("Nome público").value).toBe("Rascunho");
  });
  it("rejects a cross-tenant catalog response before exposing choices or accepting links", async () => {
    const f = await fixture({ handle: r => r.path.endsWith("/products") ? Response.json({ products: [product("foreign-service", "service", "foreign")], total: 1 }) : undefined });
    await click("Novo profissional"); expect(document.body.textContent).toContain("Não foi possível carregar os serviços"); expect(serviceToggle("foreign-service")).toBeNull(); expect(writes(f)).toEqual([]);
  });
  it("masks an old editor and ignores its pending catalog result after the authenticated company changes", async () => {
    const pending = deferred<Response>(); const f = await fixture({ handle: r => r.path.endsWith("/products") ? pending.promise : undefined });
    await click("Editar Ana"); await f.render({ ...me, id: "merchant-b", user_id: "operator-b" }); expect(document.querySelector('[role="dialog"]')).toBeNull();
    await act(async () => pending.resolve(Response.json({ products: [product("private-old-service")], total: 1 })));
    expect(document.body.textContent).not.toContain("private-old-service"); expect(f.host.textContent).toContain("Bruno"); expect(writes(f)).toEqual([]);
  });
  it("admits a new current-company gesture while an old-company command remains pending and ignores its late result", async () => {
    const pending = deferred<Response>(); let currentB = professional("professional-b", "merchant-b");
    const f = await fixture({ handle: r => {
      if (r.method === "PATCH" && r.path.includes("merchant-a/")) return pending.promise;
      if (r.method === "PATCH" && r.path.includes("merchant-b/")) { currentB = { ...currentB, publicName: String(r.body.publicName), version: 8 }; return Response.json(currentB); }
      if (r.method === "GET" && r.path.endsWith("merchant-b/service-professionals")) return Response.json({ items: [currentB], nextCursor: null });
      if (r.path.endsWith("merchant-b/products")) return Response.json({ products: [product("service-b", "service", "merchant-b")], total: 1 });
    } });
    await click("Editar Ana"); await enter("Nome público", "Old pending draft"); await click("Salvar profissional");
    await f.render({ ...me, id: "merchant-b", user_id: "operator-b" }); await click("Editar Bruno"); await enter("Nome público", "Bruno atualizado"); await click("Salvar profissional");
    expect(writes(f).map(r => r.path)).toEqual(["/v1/merchants/merchant-a/service-professionals/professional-a", "/v1/merchants/merchant-b/service-professionals/professional-b"]);
    expect(f.host.textContent).toContain("Bruno atualizado");
    await act(async () => pending.resolve(Response.json({ ...professional(), publicName: "Old late result", version: 8 })));
    expect(f.host.textContent).not.toContain("Old late result"); expect(f.host.textContent).toContain("Bruno atualizado");
  });
  it("reads the next real professional page without a fabricated total or duplicated first-page records", async () => {
    const f = await fixture({ handle: r => r.method === "GET" && r.path.endsWith("/service-professionals") ? Response.json(r.query.get("cursor") ? { items: [{ ...professional("professional-b"), publicName: "Beatriz" }], nextCursor: null } : { items: [professional()], nextCursor: "professional-a" }) : undefined });
    await click("Carregar mais profissionais"); expect(f.host.textContent).toContain("Ana"); expect(f.host.textContent).toContain("Beatriz"); expect(f.host.querySelectorAll('[data-professional-id="professional-a"]')).toHaveLength(1);
    expect(f.requests.filter(r => r.query.has("cursor")).map(r => Object.fromEntries(r.query))).toEqual([{ limit: "25", cursor: "professional-a" }]);
  });
  it("lets the operator retry a failed catalog page explicitly with the same cursor", async () => {
    let reads = 0; const f = await fixture({ handle: r => r.path.endsWith("/products") ? (++reads === 1 ? Response.json({}, { status: 503 }) : Response.json({ products: [product("service-a")], total: 1 })) : undefined });
    await click("Novo profissional"); expect(document.body.textContent).toContain("Não foi possível carregar os serviços"); await click("Tentar carregar serviços");
    expect(reads).toBe(2); expect(serviceToggle("Consulta")).not.toBeNull(); expect(writes(f)).toEqual([]);
  });
  it("serializes two save gestures and keeps the original displayed record while the mutation is pending", async () => {
    const pending = deferred<Response>(); const f = await fixture({ handle: r => r.method === "PATCH" ? pending.promise : undefined });
    await click("Editar Ana"); await enter("Nome público", "Changed"); await act(async () => { named("Salvar profissional").click(); named("Salvar profissional").click(); });
    expect(writes(f)).toHaveLength(1); expect(f.host.textContent).toContain("Ana"); expect(named("Salvar profissional").disabled).toBe(true);
    await act(async () => pending.resolve(Response.json({ ...professional(), publicName: "Changed", version: 8 })));
  });
  it("reactivates an existing professional without republishing it or creating a login", async () => {
    const f = await fixture({ records: [{ ...professional(), isActive: false, isPublished: false }] }); await click("Editar Ana");
    expect(toggle("Reativar profissional").getAttribute("role")).toBe("switch"); expect(toggle("Reativar profissional").getAttribute("aria-checked")).toBe("false"); expect(toggle("Publicado para clientes").disabled).toBe(true);
    await act(async () => toggle("Reativar profissional").click());
    expect(toggle("Reativar profissional").getAttribute("aria-checked")).toBe("true"); expect(toggle("Publicado para clientes").getAttribute("aria-checked")).toBe("false");
    await click("Salvar profissional");
    expect(writes(f)[0]).toMatchObject({ method: "PATCH", body: { isActive: true, isPublished: false, expectedVersion: 7 } }); expect(f.records()[0].isActive).toBe(true); expect(f.records()[0].isPublished).toBe(false); expect(f.requests.some(r => /auth|users/.test(r.path))).toBe(false);
  });
  it("edits public presentation and publication through actual fields without sending client price or capacity", async () => {
    const f = await fixture(); await click("Editar Ana"); await enter("Apresentação pública", "Novo perfil");
    expect(toggle("Publicado para clientes").getAttribute("role")).toBe("switch"); expect(toggle("Publicado para clientes").getAttribute("aria-checked")).toBe("true");
    await act(async () => toggle("Publicado para clientes").click());
    expect(toggle("Publicado para clientes").getAttribute("aria-checked")).toBe("false");
    await click("Salvar profissional");
    expect(writes(f)[0].body).toMatchObject({ publicProfile: { description: "Novo perfil", specialties: ["Coluna"] }, isPublished: false, expectedVersion: 7 });
    expect(writes(f)[0].body).not.toHaveProperty("priceInCents"); expect(writes(f)[0].body).not.toHaveProperty("capacity"); expect(writes(f)[0].body).not.toHaveProperty("productIds");
  });
});
