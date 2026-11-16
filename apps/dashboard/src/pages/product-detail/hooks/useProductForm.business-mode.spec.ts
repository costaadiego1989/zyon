/** @vitest-environment jsdom */
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it } from "vitest";
import { useProductForm } from "./useProductForm.js";
import type { ProductType } from "../ProductDetailPage.js";

async function fixture(initialType: ProductType) {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  let form!: ReturnType<typeof useProductForm>;
  function Probe({ type }: { type: ProductType }) { form = useProductForm("", "", type); return null; }
  const render = async (type: ProductType) => { await act(async () => root.render(createElement(Probe, { type }))); };
  await render(initialType);
  return { form: () => form, render, close: async () => { await act(async () => root.unmount()); host.remove(); } };
}

it("CAT-02 services use service on the first render and explicit reset clears the draft without changing its type", async () => {
  const f = await fixture("service"); try {
    expect(f.form().productType).toBe("service");
    await act(async () => { f.form().setName("Consulta"); f.form().setDescription("Rascunho"); f.form().setMetadata({ serviceType: "remoto", remoteLink: "https://example.test/meeting" }); f.form().setCategoryId("old"); f.form().setIsActive(false); });
    await act(async () => f.form().reset());
    expect({ type: f.form().productType, name: f.form().name, description: f.form().description, metadata: f.form().metadata, categoryId: f.form().categoryId, isActive: f.form().isActive, optionGroups: f.form().optionGroups })
      .toEqual({ type: "service", name: "", description: "", metadata: {}, categoryId: "", isActive: true, optionGroups: [] });
  } finally { await f.close(); }
});

it("CAT-02 loading another historical type preserves its data until an explicit new-form reset", async () => {
  const f = await fixture("service"); try {
    await act(async () => f.form().loadProduct({ name: "E-book histórico", description: "Preservar", type: "digital", metadata: { downloadUrl: "https://example.test/file" }, categoryId: "history", isActive: false }));
    expect({ type: f.form().productType, name: f.form().name, metadata: f.form().metadata, category: f.form().categoryId, active: f.form().isActive })
      .toEqual({ type: "digital", name: "E-book histórico", metadata: { downloadUrl: "https://example.test/file" }, category: "history", active: false });
    await act(async () => f.form().reset()); expect(f.form().productType).toBe("service"); expect(f.form().metadata).toEqual({});
  } finally { await f.close(); }
});

it("CAT-02 reset uses the current creation default without coercing an already loaded item on rerender", async () => {
  const f = await fixture("service"); try {
    await act(async () => f.form().loadProduct({ name: "Serviço histórico", type: "service", metadata: { serviceType: "presencial" }, isActive: true }));
    await f.render("physical"); expect(f.form().productType).toBe("service"); expect(f.form().name).toBe("Serviço histórico");
    await act(async () => f.form().reset()); expect(f.form().productType).toBe("physical"); expect(f.form().name).toBe("");
  } finally { await f.close(); }
});

it("CAT-02 product creation keeps physical as its reset default after a digital draft", async () => {
  const f = await fixture("physical"); try {
    expect(f.form().productType).toBe("physical");
    await act(async () => f.form().setProductType("digital")); await act(async () => f.form().reset());
    expect(f.form().productType).toBe("physical"); expect(f.form().metadata).toEqual({});
  } finally { await f.close(); }
});
