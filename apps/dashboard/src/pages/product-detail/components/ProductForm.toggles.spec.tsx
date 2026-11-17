/** @vitest-environment jsdom */
import React, { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { ProductForm, type ProductFormProps } from "./ProductForm.js";
import { ProductBlockEditor } from "./ProductBlockEditor.js";
import type { ProductMetadata } from "../ProductDetailPage.js";
import type { FoodOptionGroupDraft } from "../hooks/useProductForm.js";
import type { ProductContentBlock } from "../../../api/endpoints/product-content.js";
import { ApiContext } from "../../../hooks/useApi.js";
import { createDashboardApi } from "../../../api-client.js";

const mounts: Array<{ root: Root; host: HTMLDivElement }> = [];
afterEach(async () => {
  for (const { root, host } of mounts.splice(0)) { await act(async () => root.unmount()); host.remove(); }
});

async function mount(children: React.ReactNode) {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host); mounts.push({ root, host });
  await act(async () => root.render(children));
  return host;
}

function labelledSwitch(host: HTMLElement, name: string) {
  const label = Array.from(host.querySelectorAll<HTMLLabelElement>("label[for]")).find(item => item.textContent?.trim() === name);
  expect(label, name).toBeTruthy();
  const button = document.getElementById(label!.htmlFor) as HTMLButtonElement;
  expect(host.contains(button)).toBe(true); expect(button.getAttribute("role")).toBe("switch"); expect(button.type).toBe("button");
  return { button, label: label! };
}

const foodGroup = (id: string, name: string, minimum = 0): FoodOptionGroupDraft => ({
  id, name, selectionType: "multiple", required: minimum > 0, minSelections: minimum, maxSelections: 3,
  items: [{ id: id + "-one", name: "Primeiro", priceModifierInCents: 100 }, { id: id + "-two", name: "Segundo", priceModifierInCents: 250 }, { id: id + "-three", name: "Terceiro", priceModifierInCents: 0 }],
});

async function formFixture(options: { type?: ProductFormProps["productType"]; editing?: boolean; disabled?: boolean; metadata?: ProductMetadata; groups?: FoodOptionGroupDraft[]; errors?: Record<string, string> } = {}) {
  let snapshot!: { active: boolean; metadata: ProductMetadata; groups: FoodOptionGroupDraft[] }, submitted = 0;
  function Probe() {
    const [active, setActive] = useState(true), [metadata, setMetadata] = useState<ProductMetadata>(options.metadata ?? {});
    const [groups, setGroups] = useState(options.groups ?? []);
    snapshot = { active, metadata, groups };
    return <form onSubmit={event => { event.preventDefault(); submitted++; }}><fieldset disabled={options.disabled}>
      <ProductForm businessMode={options.type === "service" ? "services" : "products"} name="Item preservado" onNameChange={() => {}}
        description="Descrição preservada" onDescriptionChange={() => {}} productType={options.type ?? "physical"} onProductTypeChange={() => {}}
        metadata={metadata} onMetadataChange={setMetadata} categoryId="category" onCategoryIdChange={() => {}}
        isActive={active} onIsActiveChange={setActive} isEditing={options.editing ?? true} categories={[]}
        onCreateCategory={async name => ({ id: "created-category", name })} generatingDesc={false} onGenerateDescription={() => {}}
        formErrors={options.errors ?? {}} optionGroups={groups} onOptionGroupsChange={setGroups} />
    </fieldset></form>;
  }
  const host = await mount(<Probe />);
  return { host, state: () => snapshot, submitted: () => submitted };
}

describe("CAT-03 catalog boolean toggles", () => {
  it("changes Active with its labelled switch and preserves its exact boolean state", async () => {
    const f = await formFixture(); const control = labelledSwitch(f.host, "Ativo");
    expect(control.button.getAttribute("aria-checked")).toBe("true");
    await act(async () => control.label.click());
    expect(f.state().active).toBe(false); expect(control.button.getAttribute("aria-checked")).toBe("false");
    await act(async () => control.button.click());
    expect(f.state().active).toBe(true); expect(control.button.getAttribute("aria-checked")).toBe("true"); expect(f.submitted()).toBe(0);
  });

  it("keeps the creation default without adding an editing-only Active control", async () => {
    const f = await formFixture({ editing: false });
    expect(f.host.querySelectorAll('[role="switch"]')).toHaveLength(0); expect(f.state().active).toBe(true); expect(f.submitted()).toBe(0);
  });

  it("enables the original schedule defaults and removes only serviceSchedule when turned off", async () => {
    const original: ProductMetadata = { serviceType: "remoto", remoteLink: "https://example.test/meet", notes: "Preservar" };
    const f = await formFixture({ type: "service", metadata: original }); const control = labelledSwitch(f.host, "Exigir escolha de data e horário");
    expect(control.button.getAttribute("aria-checked")).toBe("false");
    await act(async () => control.button.click());
    expect(f.state().metadata).toEqual({ ...original, serviceSchedule: { timeZone: "America/Sao_Paulo", durationMinutes: 30, slots: [] } });
    expect(control.button.getAttribute("aria-checked")).toBe("true");
    await act(async () => control.label.click());
    expect(f.state().metadata).toEqual(original); expect(Object.hasOwn(f.state().metadata, "serviceSchedule")).toBe(false); expect(f.submitted()).toBe(0);
  });

  it("loads a saved schedule and retains validation and the old off/on reset semantics", async () => {
    const original: ProductMetadata = { serviceType: "presencial", serviceSchedule: { timeZone: "America/Manaus", durationMinutes: 45, slots: [{ id: "slot-a", date: "2030-02-04", startTime: "10:30" }] } };
    const f = await formFixture({ type: "service", metadata: original, errors: { serviceSchedule: "Revise este horário" } });
    const control = labelledSwitch(f.host, "Exigir escolha de data e horário");
    expect(control.button.getAttribute("aria-checked")).toBe("true"); expect(f.state().metadata).toEqual(original);
    expect(f.host.querySelector('[role="alert"]')?.textContent).toBe("Revise este horário");
    await act(async () => control.button.click()); await act(async () => control.button.click());
    expect(f.state().metadata).toEqual({ serviceType: "presencial", serviceSchedule: { timeZone: "America/Sao_Paulo", durationMinutes: 30, slots: [] } });
  });

  it("retains food required/minimum rules and all unrelated group and item values", async () => {
    const groups = [foodGroup("borders", "Bordas", 2), foodGroup("fillings", "Recheios")];
    const f = await formFixture({ type: "food", groups }); const control = labelledSwitch(f.host, "Obrigatório em Bordas");
    expect(control.button.getAttribute("aria-checked")).toBe("true");
    await act(async () => control.button.click());
    expect(f.state().groups).toEqual([{ ...groups[0], required: false, minSelections: 0 }, groups[1]]);
    await act(async () => control.button.click());
    expect(f.state().groups).toEqual([{ ...groups[0], required: true, minSelections: 1 }, groups[1]]); expect(f.submitted()).toBe(0);
  });

  it("gives repeated food controls unique associated ids and changes only the chosen group", async () => {
    const groups = [foodGroup("first", "Opções"), foodGroup("second", "Opções")];
    const f = await formFixture({ type: "food", groups });
    const labels = Array.from(f.host.querySelectorAll<HTMLLabelElement>("label[for]")).filter(label => label.textContent === "Obrigatório em Opções");
    expect(labels).toHaveLength(2); expect(labels[0].htmlFor).not.toBe(labels[1].htmlFor);
    await act(async () => labels[1].click());
    expect(f.state().groups).toEqual([groups[0], { ...groups[1], required: true, minSelections: 1 }]);
  });

  it.each(["service", "food"] as const)("keeps %s toggles inert inside the disabled editor", async type => {
    const group = foodGroup("group", "Escolhas"); const f = await formFixture({ type, disabled: true, groups: type === "food" ? [group] : [] });
    const before = structuredClone(f.state());
    const switches = Array.from(f.host.querySelectorAll<HTMLButtonElement>('[role="switch"]')); expect(switches).toHaveLength(2);
    await act(async () => { for (const control of switches) { expect(control.matches(":disabled")).toBe(true); control.click(); } });
    expect(f.state()).toEqual(before); expect(f.submitted()).toBe(0);
  });

  it("changes the banner cart preference while preserving the existing full block payload", async () => {
    const original: ProductContentBlock = { id: "banner", productId: "product", type: "banner", order: 2, isEnabled: true, props: { imageSrc: "", alt: "Original", caption: "Legenda", linkUrl: "https://example.test/original", ctaLabel: "Comprar" } };
    const updates: ProductContentBlock[][] = [];
    const api = createDashboardApi({ baseUrl: "http://fixture.test", fetchImpl: async () => { throw Error("unexpected_banner_fetch"); } });
    const host = await mount(<ApiContext.Provider value={api}><ProductBlockEditor initialBlocks={[original]} productId="product" merchantId="merchant" onChange={blocks => updates.push(blocks)} /></ApiContext.Provider>);
    const expand = Array.from(host.querySelectorAll<HTMLButtonElement>("button")).find(button => button.textContent?.includes("Banner")); expect(expand).toBeTruthy();
    await act(async () => expand!.click()); const control = labelledSwitch(host, "Adicionar este produto ao carrinho");
    expect(control.button.getAttribute("aria-checked")).toBe("false");
    await act(async () => control.button.click());
    expect(updates.at(-1)).toEqual([{ ...original, props: { ...original.props, ctaAction: "add_to_cart", linkUrl: undefined } }]);
    expect(control.button.getAttribute("aria-checked")).toBe("true"); expect(host.textContent).not.toContain("URL do link");
    await act(async () => control.label.click());
    expect(updates.at(-1)).toEqual([{ ...original, props: { ...original.props, ctaAction: undefined, linkUrl: undefined } }]);
    expect(host.textContent).toContain("URL do link"); expect(original.props.linkUrl).toBe("https://example.test/original");
  });

  it("keeps the banner preference and payload unchanged in read-only mode", async () => {
    const original: ProductContentBlock = { id: "banner-readonly", productId: "product", type: "banner", order: 0, isEnabled: true, props: { ctaAction: "add_to_cart", ctaLabel: "Original" } };
    const updates: ProductContentBlock[][] = [];
    const api = createDashboardApi({ baseUrl: "http://fixture.test", fetchImpl: async () => { throw Error("unexpected_banner_fetch"); } });
    const host = await mount(<ApiContext.Provider value={api}><ProductBlockEditor initialBlocks={[original]} productId="product" merchantId="merchant" readOnly onChange={blocks => updates.push(blocks)} /></ApiContext.Provider>);
    await act(async () => Array.from(host.querySelectorAll<HTMLButtonElement>("button")).find(button => button.textContent?.includes("Banner"))!.click());
    const control = labelledSwitch(host, "Adicionar este produto ao carrinho"); expect(control.button.disabled).toBe(true);
    await act(async () => control.button.click());
    expect(control.button.getAttribute("aria-checked")).toBe("true"); expect(updates).toEqual([]); expect(original.props).toEqual({ ctaAction: "add_to_cart", ctaLabel: "Original" });
  });
});
