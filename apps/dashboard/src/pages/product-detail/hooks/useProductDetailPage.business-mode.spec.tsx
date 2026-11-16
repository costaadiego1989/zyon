/** @vitest-environment jsdom */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createDashboardApi, type MerchantProfile, type Product } from "../../../api-client.js";
import { ApiContext } from "../../../hooks/useApi.js";
import { ProductDetailPage } from "../ProductDetailPage.js";
import { useProductDetailPage } from "./useProductDetailPage.js";

vi.mock("../../../hooks/useErrorReporter.js", () => ({ reportError: vi.fn() }));
vi.mock("../../../components/Toast.js", () => ({ showToast: vi.fn() }));

const mounts: Array<{ root: Root; host: HTMLDivElement }> = [];
afterEach(async () => { for (const { root, host } of mounts.splice(0)) { await act(async () => root.unmount()); host.remove(); } });
const profile = (mode?: MerchantProfile["businessMode"], id = "merchant-a"): MerchantProfile => ({ id, user_id: "owner", name: id, role: "OWNER", businessMode: mode });

function product(type: string, name = "Item histórico"): Product {
  return { id: "historical", merchantId: "merchant-a", type, name, description: "Descrição preservada", metadata: type === "service" ? { serviceType: "presencial" } : {}, isActive: true,
    createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z", variants: [{ id: "old-variant", sku: "original", attributes: {}, isActive: true, basePriceInCents: 1234, currency: "BRL", taxPercent: 0, stockQuantity: 3, stockReserved: 0, media: [], weightGrams: 100 }] };
}

async function fixture(me: MerchantProfile, existing?: Product, hookOnly = false) {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const writes: Array<{ path: string; method: string; body: Record<string, unknown> }> = [], records: Product[] = [];
  let release: (() => void) | undefined, holdCreate = false, vm!: ReturnType<typeof useProductDetailPage>, saved = 0;
  const api = createDashboardApi({ baseUrl: "http://fixture.test", fetchImpl: async (input, init) => {
    const path = new URL(String(input)).pathname, method = init?.method ?? "GET";
    if (path.endsWith("/categories")) return Response.json([]);
    if (path.endsWith("/billing/subscription")) return Response.json({ plan: "starter", features: {} });
    if (path.endsWith("/promotion")) return Response.json({ promotions: [] });
    if (path.endsWith("/advanced-rules")) return Response.json({ rules: [] });
    if (path.endsWith("/products/historical") && existing) return Response.json(existing);
    if (path.endsWith("/products") && method === "POST") {
      const body = JSON.parse(String(init?.body)); writes.push({ path, method, body });
      if (holdCreate) await new Promise<void>(resolve => { release = resolve; });
      const created = { ...product(String(body.type), body.name), id: "created-" + writes.length, merchantId: path.split("/")[3], description: body.description, metadata: body.metadata,
        variants: body.variants.map((variant: object, index: number) => ({ ...product("physical").variants[0], ...variant, id: "variant-" + index })) };
      records.push(created); return Response.json(created, { status: 201 });
    }
    throw new Error("unexpected_fixture_request:" + method + ":" + path);
  } });
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host); mounts.push({ root, host });
  function Probe({ current }: { current: MerchantProfile }) { vm = useProductDetailPage({ me: current, productId: existing?.id ?? null }); return null; }
  const render = async (current: MerchantProfile) => { await act(async () => root.render(<ApiContext.Provider value={api}>{hookOnly ? <Probe current={current} /> : <ProductDetailPage apiBaseUrl="http://fixture.test" me={current} productId={existing?.id ?? null} onSaved={() => { saved++; }} />}</ApiContext.Provider>)); };
  await render(me);
  return { host, render, writes, records, vm: () => vm, saved: () => saved, hold: () => { holdCreate = true; }, release: async () => { await act(async () => release?.()); } };
}

function input(host: HTMLElement, placeholder: string) {
  const target = host.querySelector<HTMLInputElement>(`input[placeholder="${placeholder}"]`); expect(target, placeholder).toBeTruthy(); return target!;
}
async function type(target: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  await act(async () => { setter.call(target, value); target.dispatchEvent(new Event("input", { bubbles: true })); });
}
function button(host: HTMLElement, text: string) {
  const target = Array.from(host.querySelectorAll<HTMLButtonElement>("button")).find(candidate => candidate.textContent?.trim() === text);
  expect(target, text).toBeTruthy(); return target!;
}
async function fill(host: HTMLElement, service = true) {
  await type(input(host, service ? "Ex: Consulta inicial" : "Ex: Camiseta preta M"), service ? "Consulta local" : "Produto local");
  await type(input(host, "Auto-gerado do nome se vazio"), "item-local"); await type(input(host, "0,00"), "12,34");
  const weight = host.querySelector<HTMLInputElement>('input[placeholder="300"]'); if (weight) await type(weight, "100");
}

describe("T98 actual editor mode and payload", () => {
  it("creates a service from its first render with the service payload and service action labels", async () => {
    const f = await fixture(profile("services"));
    expect(f.host.querySelector("h1")?.textContent).toBe("Novo serviço"); expect(f.host.querySelectorAll("button[aria-pressed]")).toHaveLength(0);
    await fill(f.host); expect(button(f.host, "Criar serviço").disabled).toBe(false);
    await act(async () => button(f.host, "Criar serviço").click());
    expect(f.writes).toEqual([{ method: "POST", path: "/v1/merchants/merchant-a/products", body: { name: "Consulta local", type: "service", metadata: {}, variants: [{ sku: "item-local", attributes: {}, basePriceInCents: 1234, stockQuantity: 0 }] } }]);
    expect(f.records.map(record => ({ type: record.type, name: record.name }))).toEqual([{ type: "service", name: "Consulta local" }]); expect(f.saved()).toBe(1);
  });

  it.each(["physical", "digital", "food"] as const)("keeps the existing %s creation payload for a product company", async typeValue => {
    const f = await fixture(profile("products"));
    expect(f.host.querySelector("h1")?.textContent).toBe("Novo produto");
    const controls = Array.from(f.host.querySelectorAll<HTMLButtonElement>("button[aria-pressed]"));
    expect(controls.map(control => control.textContent)).toEqual(["Físico", "Digital", "Alimentação"]);
    await act(async () => controls[{ physical: 0, digital: 1, food: 2 }[typeValue]].click()); await fill(f.host, false);
    await act(async () => button(f.host, "Criar produto").click());
    expect(f.writes).toHaveLength(1); expect(f.writes[0].path).toBe("/v1/merchants/merchant-a/products");
    expect(f.writes[0].body).toMatchObject({ name: "Produto local", type: typeValue, variants: [{ sku: "item-local", basePriceInCents: 1234 }] });
    expect(f.records[0].type).toBe(typeValue);
  });

  it("blocks unresolved and review-required profiles without guessing a creation type", async () => {
    const f = await fixture(profile());
    expect(f.host.querySelector<HTMLFieldSetElement>("fieldset")?.disabled).toBe(true); expect(button(f.host, "Criar produto").disabled).toBe(true);
    expect(f.host.querySelectorAll("button[aria-pressed]")).toHaveLength(0);
    await f.render({ ...profile("services"), businessModeSelectionState: "review_required" });
    expect(f.host.querySelector<HTMLFieldSetElement>("fieldset")?.disabled).toBe(true); expect(f.host.textContent).toContain("Confirme a modalidade"); expect(f.writes).toEqual([]);
    await f.render({ ...profile(), businessMode: "hybrid" as MerchantProfile["businessMode"] });
    expect(f.host.querySelector<HTMLFieldSetElement>("fieldset")?.disabled).toBe(true); expect(f.host.querySelectorAll("button[aria-pressed]")).toHaveLength(0); expect(f.writes).toEqual([]);
    await f.render({ ...profile("products"), businessModeSelectionState: "legacy" });
    expect(f.host.querySelectorAll("button[aria-pressed]")).toHaveLength(3); expect(f.host.querySelector<HTMLFieldSetElement>("fieldset")?.disabled).toBe(false);
  });

  it("preserves an incompatible loaded record and refuses saving even if its draft type is changed programmatically", async () => {
    const historical = product("service"); const f = await fixture(profile("products"), historical, true);
    expect(f.vm().form.productType).toBe("service"); expect(f.vm().form.name).toBe(historical.name); expect(f.vm().form.metadata).toEqual(historical.metadata); expect(f.vm().canSave).toBe(false);
    await act(async () => f.vm().form.setProductType("physical")); await act(async () => f.vm().handleSave());
    expect(f.vm().form.metadata).toEqual(historical.metadata); expect(f.vm().saveErrorMsg).toContain("dados originais foram preservados"); expect(f.writes).toEqual([]); expect(historical.type).toBe("service");
  });

  it("resets the complete visible draft when the same merchant changes mode", async () => {
    const f = await fixture(profile("services")); await fill(f.host);
    await f.render(profile("products")); expect(f.host.querySelector("h1")?.textContent).toBe("Novo produto"); expect(input(f.host, "Ex: Camiseta preta M").value).toBe(""); expect(input(f.host, "Auto-gerado do nome se vazio").value).toBe("");
    expect(f.host.querySelector('button[aria-pressed="true"]')?.textContent).toBe("Físico");
    await f.render(profile("services")); expect(f.host.querySelector("h1")?.textContent).toBe("Novo serviço"); expect(input(f.host, "Ex: Consulta inicial").value).toBe(""); expect(f.writes).toEqual([]);
  });

  it("does not carry a created ID or item draft into another merchant", async () => {
    const f = await fixture(profile("services")); await fill(f.host); await act(async () => button(f.host, "Criar serviço").click());
    expect(f.host.querySelector("h1")?.textContent).toBe("Consulta local");
    await f.render(profile("services", "merchant-b")); expect(f.host.querySelector("h1")?.textContent).toBe("Novo serviço"); expect(input(f.host, "Ex: Consulta inicial").value).toBe("");
    await fill(f.host); await act(async () => button(f.host, "Criar serviço").click());
    expect(f.writes.map(write => [write.method, write.path, write.body.type])).toEqual([["POST", "/v1/merchants/merchant-a/products", "service"], ["POST", "/v1/merchants/merchant-b/products", "service"]]);
  });

  it("does not redirect or apply an old save completion after switching merchant", async () => {
    const f = await fixture(profile("services")); f.hold(); await fill(f.host); await act(async () => button(f.host, "Criar serviço").click());
    expect(f.writes).toHaveLength(1); await f.render(profile("products", "merchant-b")); window.history.replaceState(null, "", "#catalog");
    await f.release(); expect(window.location.hash).toBe("#catalog"); expect(f.saved()).toBe(0);
    expect(f.host.querySelector("h1")?.textContent).toBe("Novo produto"); expect(input(f.host, "Ex: Camiseta preta M").value).toBe(""); expect(f.writes).toHaveLength(1); expect(f.records[0].type).toBe("service");
  });

  it("refuses a forbidden draft type before sending for a service company", async () => {
    const f = await fixture(profile("services"), undefined, true);
    await act(async () => { f.vm().form.setName("Tentativa"); f.vm().form.setProductType("digital"); f.vm().variantManager.updateVariant(0, { sku: "attempt", basePriceInput: "10,00" }); });
    expect(f.vm().canSave).toBe(false); await act(async () => f.vm().handleSave()); expect(f.writes).toEqual([]); expect(f.vm().saveErrorMsg).toContain("não corresponde");
  });
});
