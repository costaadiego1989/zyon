/** @vitest-environment jsdom */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDashboardApi } from "../../../api-client.js";
import { ApiContext } from "../../../hooks/useApi.js";
import type { AdvancedRule } from "../../checkout-settings/lib/draft.js";
import { PromotionSection, type PromotionSectionProps } from "./PromotionSection.js";

const policy = vi.hoisted(() => ({ enabled: undefined as boolean | undefined, messages: [] as Array<{ kind: string; message: string }> }));
vi.mock("../../../hooks/api/usePlanFeatures.js", () => ({ usePlanFeatures: () => ({ hasFeature: (key: string) => key === "advancedRules" && policy.enabled === true }) }));
vi.mock("../../../components/Toast.js", () => ({ showToast: (kind: string, message: string) => policy.messages.push({ kind, message }) }));
vi.mock("../../../hooks/useErrorReporter.js", () => ({ reportError: () => {} }));

const mounts: Array<{ root: Root; host: HTMLDivElement }> = [];
beforeEach(() => { policy.enabled = undefined; policy.messages.length = 0; });
afterEach(async () => { for (const { root, host } of mounts.splice(0)) { await act(async () => root.unmount()); host.remove(); } });

function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: Error) => void;
  const promise = new Promise<T>((accept, fail) => { resolve = accept; reject = fail; });
  return { promise, resolve, reject };
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const rule = (name = "Regra atual"): AdvancedRule => ({ id: name, name, conditions: [{ field: "cart_total", operator: ">", value: 100 }], action: { type: "offer_discount", params: { percent: 5 } }, enabled: true, priority: 1 });

async function fixture(options: { enabled?: boolean; productId?: string | null; rules?: AdvancedRule[]; advanced?: (method: string, path: string, body: unknown) => Promise<Response> } = {}) {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  policy.enabled = options.enabled;
  const requests: Array<{ method: string; path: string; body: unknown }> = [];
  let savedRules = options.rules ?? [], savedPromotion: Record<string, unknown> | null = null;
  const api = createDashboardApi({ baseUrl: "http://127.0.0.1:5187/v1", fetchImpl: (async (input, init) => {
    const path = new URL(String(input)).pathname, method = init?.method ?? "GET", body = init?.body ? JSON.parse(String(init.body)) : null;
    requests.push({ method, path, body });
    if (path.endsWith("/advanced-rules")) {
      if (options.advanced) return options.advanced(method, path, body);
      if (method === "PUT") savedRules = body.rules;
      return json({ rules: savedRules });
    }
    if (path.endsWith("/promotion")) {
      if (method === "GET") return json({ promotions: savedPromotion ? [savedPromotion] : [] });
      savedPromotion = { id: "promotion", ...body }; return json(savedPromotion);
    }
    throw new Error("unexpected_component_request:" + method + ":" + path);
  }) as typeof fetch });
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host); mounts.push({ root, host });
  const pending: Array<Parameters<NonNullable<PromotionSectionProps["onPendingRulesChange"]>>[0]> = [];
  let props: PromotionSectionProps = { merchantId: "merchant-a", productId: options.productId === undefined ? "product-a" : options.productId, variantSkus: ["sku-preserved"], onPendingRulesChange: next => { pending.push(next); } };
  const render = async (changes: Partial<PromotionSectionProps> = {}) => {
    props = { ...props, ...changes };
    await act(async () => root.render(<ApiContext.Provider value={api}><PromotionSection {...props} /></ApiContext.Provider>));
  };
  await render();
  return { host, requests, pending, render, rules: () => savedRules, promotion: () => savedPromotion };
}
function button(host: HTMLElement, text: string) {
  const found = Array.from(host.querySelectorAll<HTMLButtonElement>("button")).find(item => item.textContent?.trim() === text);
  expect(found, text).toBeTruthy(); return found!;
}
async function expand(host: HTMLElement) {
  const toggle = host.querySelector<HTMLButtonElement>('[role="switch"]'); expect(toggle).toBeTruthy();
  if (toggle!.getAttribute("aria-checked") !== "true") await act(async () => toggle!.click());
}
async function toggleRule(host: HTMLElement) {
  const toggle = host.querySelector<HTMLButtonElement>('.cfg-rule-card [role="switch"]'); expect(toggle).toBeTruthy();
  await act(async () => toggle!.click());
}
async function fillLabel(name: string, value: string) {
  const label = Array.from(document.querySelectorAll<HTMLLabelElement>("label[for]")).find(item => item.textContent === name);
  expect(label, name).toBeTruthy(); const input = document.getElementById(label!.htmlFor) as HTMLInputElement;
  expect(input).toBeTruthy();
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })); });
}

describe("CAT-05 advanced-rules entitlement in the offer editor", () => {
  for (const enabled of [false, undefined]) {
    it(`keeps ${enabled === false ? "Starter" : "unknown entitlement"} locked without an advanced request and saves a basic promotion`, async () => {
      const f = await fixture({ enabled }); await expand(f.host);
      expect(f.host.textContent).toContain("Disponível no plano Growth+.");
      expect(f.host.querySelector(".cfg-rules-list")).toBeNull();
      const percent = f.host.querySelector<HTMLInputElement>('input[placeholder="10"]'); expect(percent).toBeTruthy();
      await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(percent, "12"); percent!.dispatchEvent(new Event("input", { bubbles: true })); });
      await act(async () => button(f.host, "Salvar promoção").click());
      expect(f.promotion()).toMatchObject({ id: "promotion", isActive: true, discountType: "percent", discountValue: 12 });
      expect(f.promotion()?.startsAt).toEqual(expect.any(String)); expect(f.promotion()?.endsAt).toEqual(expect.any(String));
      expect(f.requests.filter(item => item.path.endsWith("/advanced-rules"))).toEqual([]);
      expect(f.requests.find(item => item.method === "POST")?.body).toEqual({ isActive: true, discountType: "percent", discountValue: 12, startsAt: f.promotion()?.startsAt, endsAt: f.promotion()?.endsAt });
      expect(policy.messages).toEqual([{ kind: "success", message: "Promoção criada" }]);
    });
  }

  it("loads enabled rules and persists a real rule toggle with its unchanged SKU scope", async () => {
    const original = rule(); const f = await fixture({ enabled: true, rules: [original] });
    expect(f.host.textContent).toContain(original.name); await toggleRule(f.host);
    expect(f.rules()).toEqual([{ ...original, enabled: false }]);
    expect(f.requests.filter(item => item.path.endsWith("/advanced-rules"))).toEqual([
      { method: "GET", path: "/v1/merchants/merchant-a/products/product-a/advanced-rules", body: null },
      { method: "PUT", path: "/v1/merchants/merchant-a/products/product-a/advanced-rules", body: { rules: [{ ...original, enabled: false }], productSkus: ["sku-preserved"] } },
    ]);
    expect(f.host.querySelector('.cfg-rule-card [role="switch"]')?.getAttribute("aria-checked")).toBe("false");
  });

  it("loads on entitlement grant and clears the old rule editor on loss and regrant", async () => {
    const f = await fixture({ enabled: false, rules: [rule()] }); await expand(f.host);
    policy.enabled = true; await f.render(); expect(f.host.textContent).toContain("Regra atual");
    await act(async () => f.host.querySelector<HTMLButtonElement>('[aria-label="Editar regra"]')!.click());
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("Editar regra");
    policy.enabled = false; await f.render(); expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(f.host.textContent).toContain("Disponível no plano Growth+."); expect(f.host.textContent).not.toContain("Regra atual");
    policy.enabled = true; await f.render(); expect(f.host.textContent).toContain("Regra atual"); expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(f.requests.filter(item => item.path.endsWith("/advanced-rules")).map(item => item.method)).toEqual(["GET", "GET"]);
  });

  for (const change of ["product", "merchant", "permission"] as const) {
    for (const outcome of ["success", "failure"] as const) {
      it(`ignores a delayed advanced ${outcome} after a ${change} change`, async () => {
        const old = deferred<Response>(); let reads = 0;
        const f = await fixture({ enabled: true, advanced: async () => ++reads === 1 ? old.promise : json({ rules: [rule("Regra nova")] }) });
        if (change === "permission") policy.enabled = false;
        await f.render(change === "product" ? { productId: "product-b" } : change === "merchant" ? { merchantId: "merchant-b" } : {});
        await act(async () => { if (outcome === "success") old.resolve(json({ rules: [rule("Regra antiga")] })); else old.reject(new Error("old_context_failed")); });
        expect(f.host.textContent).not.toContain("Regra antiga"); expect(policy.messages.filter(item => item.kind === "error")).toEqual([]);
        if (change === "permission") { await expand(f.host); expect(f.host.textContent).toContain("Disponível no plano Growth+."); expect(reads).toBe(1); }
        else { expect(f.host.textContent).toContain("Regra nova"); expect(reads).toBe(2); }
      });
    }
  }

  for (const change of ["product", "merchant", "permission"] as const) {
    it(`does not recover or report an old failed rule save after a ${change} change`, async () => {
      const saving = deferred<Response>();
      const f = await fixture({ enabled: true, advanced: async method => method === "PUT" ? saving.promise : json({ rules: [rule()] }) });
      await toggleRule(f.host);
      if (change === "permission") policy.enabled = false;
      await f.render(change === "product" ? { productId: "product-b" } : change === "merchant" ? { merchantId: "merchant-b" } : {});
      const before = f.requests.filter(item => item.path.endsWith("/advanced-rules"));
      await act(async () => saving.resolve(json({ error: "failed" }, 503)));
      expect(f.requests.filter(item => item.path.endsWith("/advanced-rules"))).toEqual(before);
      expect(policy.messages).toEqual([]);
      if (change !== "permission") expect(f.host.querySelector('.cfg-rule-card [role="switch"]')?.getAttribute("aria-checked")).toBe("true");
    });
  }

  it("keeps supported save failure recovery and restores the authoritative rule", async () => {
    const original = rule(); let reads = 0;
    const f = await fixture({ enabled: true, advanced: async method => method === "PUT" ? json({ error: "failed" }, 503) : (reads++, json({ rules: [original] })) });
    await toggleRule(f.host);
    expect(reads).toBe(2); expect(f.host.querySelector('.cfg-rule-card [role="switch"]')?.getAttribute("aria-checked")).toBe("true");
    expect(policy.messages).toEqual([{ kind: "error", message: "Regras avançadas indisponíveis no momento" }]);
  });

  it("clears deferred advanced configuration when a draft loses its entitlement", async () => {
    const f = await fixture({ enabled: true, productId: null }); await expand(f.host);
    await act(async () => button(f.host, "Adicionar regra").click());
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    await fillLabel("Nome", "Regra no rascunho"); await fillLabel("Valor da condição 1", "100"); await fillLabel("Desconto (%)", "7");
    await act(async () => button(document.querySelector<HTMLElement>('[role="dialog"]')!, "Aplicar ao rascunho").click());
    expect(f.pending.at(-1)).toMatchObject({ rules: [{ name: "Regra no rascunho", conditions: [{ field: "cart_total", operator: ">", value: "100" }], action: { type: "offer_discount", params: { percent: 7 } } }], productSkus: ["sku-preserved"] });
    await act(async () => f.host.querySelector<HTMLButtonElement>('[aria-label="Editar regra"]')!.click());
    policy.enabled = false; await f.render();
    expect(document.querySelector('[role="dialog"]')).toBeNull(); expect(f.pending.at(-1)).toBeNull();
    expect(f.requests.filter(item => item.path.endsWith("/advanced-rules"))).toEqual([]);
  });
});
