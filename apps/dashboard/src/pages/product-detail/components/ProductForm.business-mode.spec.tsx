/** @vitest-environment jsdom */
import React, { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { ProductForm, type ProductFormProps } from "./ProductForm.js";

const mounts: Array<{ root: Root; host: HTMLDivElement }> = [];
afterEach(async () => {
  for (const { root, host } of mounts.splice(0)) { await act(async () => root.unmount()); host.remove(); }
});

async function fixture(mode: ProductFormProps["businessMode"], type: ProductFormProps["productType"] = "physical", editing = false) {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host); mounts.push({ root, host });
  const changes: string[] = [];
  function Probe() {
    const [productType, setType] = useState(type);
    return <ProductForm businessMode={mode} name="Item preservado" onNameChange={() => {}} description="Descrição original" onDescriptionChange={() => {}}
      productType={productType} onProductTypeChange={next => { changes.push(next); setType(next); }} metadata={{ serviceType: "presencial" }} onMetadataChange={() => {}}
      categoryId="" onCategoryIdChange={() => {}} isActive isEditing={editing} onIsActiveChange={() => {}} categories={[]}
      onCreateCategory={async name => ({ id: "category", name })} generatingDesc={false} onGenerateDescription={() => {}}
      formErrors={{}} optionGroups={[]} onOptionGroupsChange={() => {}} />;
  }
  await act(async () => root.render(<Probe />));
  return { host, changes, types: () => Array.from(host.querySelectorAll<HTMLButtonElement>("button[aria-pressed]")) };
}

describe("CAT-01 catalog type controls", () => {
  it("offers only physical, digital and food and keeps their selection gestures", async () => {
    const f = await fixture("products");
    expect(f.types().map(button => button.textContent)).toEqual(["Físico", "Digital", "Alimentação"]);
    expect(f.types().map(button => button.getAttribute("aria-pressed"))).toEqual(["true", "false", "false"]);
    await act(async () => f.types()[1].click());
    expect(f.changes).toEqual(["digital"]); expect(f.types()[1].getAttribute("aria-pressed")).toBe("true");
    expect(f.host.textContent).toContain("Informações do download");
    await act(async () => f.types()[2].click());
    expect(f.changes).toEqual(["digital", "food"]); expect(f.types()[2].getAttribute("aria-pressed")).toBe("true");
    expect(f.host.textContent).not.toContain("Agendamento do serviço");
  });

  it("opens service fields directly without offering another business type", async () => {
    const f = await fixture("services", "service");
    expect(f.types()).toHaveLength(0); expect(f.host.textContent).toContain("Agendamento do serviço");
    expect(f.host.textContent).not.toContain("Tipo de produto"); expect(f.changes).toEqual([]);
  });

  it("does not offer a type while the canonical mode is unavailable", async () => {
    const f = await fixture(null);
    expect(f.types()).toHaveLength(0); expect(f.host.querySelector('[role="alert"]')?.textContent).toContain("Confirme a modalidade");
    expect(f.changes).toEqual([]);
  });

  it("keeps a historical service visible without a service choice or silent conversion in products", async () => {
    const f = await fixture("products", "service", true);
    expect(f.types()).toHaveLength(0); expect(f.host.textContent).toContain("Tipo atual: Serviço");
    expect(f.host.textContent).toContain("Agendamento do serviço");
    expect(f.host.querySelector<HTMLInputElement>('input[placeholder="Ex: Consulta inicial"]')?.value).toBe("Item preservado");
    expect(f.changes).toEqual([]);
  });

  it("keeps a historical food item visible in services without selecting service for it", async () => {
    const f = await fixture("services", "food", true);
    expect(f.types()).toHaveLength(0); expect(f.host.textContent).toContain("Tipo atual: Alimentação");
    expect(f.host.textContent).not.toContain("Agendamento do serviço"); expect(f.changes).toEqual([]);
  });
});
