/** @vitest-environment jsdom */
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { createDashboardApi } from "../../api-client.js";
import { ApiContext } from "../../hooks/useApi.js";
import { useStoreSettingsPage } from "./useStoreSettingsPage.js";

vi.mock("../../hooks/useErrorReporter.js", () => ({ reportError: vi.fn() }));

it("T15", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  let stored = { company: { description: "Apresentação pública", email: "comercial@example.test", address: { city: "Cidade" } }, policies: { terms: "Termos" }, budget: { enabled: false }, concurrent: "preservado" };
  const writes: Record<string, any>[] = [], loading: boolean[] = [];
  let failSave = false, failLoad = false, nameWrites = 0;
  const fetchImpl: typeof fetch = async (input, init) => {
    const path = new URL(String(input)).pathname;
    if (path.endsWith("/merchants/me/store-settings")) {
      if (init?.method === "PUT") {
        const body = JSON.parse(String(init.body)); writes.push(body);
        if (failSave) return Response.json({ message: "synthetic_save_failure" }, { status: 500 });
        stored = { ...stored, ...body, company: { ...stored.company, ...body.company }, policies: { ...stored.policies, ...body.policies } };
      } else if (failLoad) return Response.json({ message: "synthetic_read_failure" }, { status: 500 });
      return Response.json(stored);
    }
    if (path.endsWith("/merchants/me/theme")) return Response.json({});
    if (path.endsWith("/merchants/me/name")) { nameWrites++; return Response.json({ name: "Empresa" }); }
    if (path.endsWith("/merchants/me")) return Response.json({ id: "own", name: "Empresa", user_id: "owner", role: "owner" });
    throw new Error("unexpected_fixture_request:" + path);
  };
  const api = createDashboardApi({ baseUrl: "http://local.test", fetchImpl });
  let vm!: ReturnType<typeof useStoreSettingsPage>;
  function Probe() { vm = useStoreSettingsPage(); loading.push(vm.state.loading); return null; }
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  try {
    await act(async () => { root.render(createElement(ApiContext.Provider, { value: api }, createElement(Probe))); });
    expect(loading).toContain(true); expect(vm.state.loading).toBe(false);
    expect(vm.state.company.description).toBe("Apresentação pública");
    stored.company.email = "concorrente@example.test";
    await act(async () => vm.setCompany({ ...vm.state.company, description: "Nova apresentação" }));
    await act(async () => vm.handleSave());
    expect(writes.at(-1)).toEqual({ company: { description: "Nova apresentação" } });
    expect(stored.company.email).toBe("concorrente@example.test"); expect(stored.concurrent).toBe("preservado");
    expect(vm.state.saveResult).toBe("success"); expect(nameWrites).toBe(0);
    await act(async () => vm.reload());
    expect(vm.state.company.description).toBe("Nova apresentação"); expect(vm.state.company.email).toBe("concorrente@example.test");

    await act(async () => vm.setCompany({ ...vm.state.company, description: "" }));
    await act(async () => vm.handleSave());
    expect(writes.at(-1)).toEqual({ company: { description: "" } });
    await act(async () => vm.reload()); expect(vm.state.company.description).toBe("");

    failSave = true;
    await act(async () => vm.setCompany({ ...vm.state.company, description: "Rascunho mantido" }));
    await act(async () => vm.handleSave());
    expect(vm.state.saveResult).toBe("error"); expect(vm.state.company.description).toBe("Rascunho mantido"); expect(stored.company.description).toBe("");
    expect(vm.state.saveError).toContain("alterações foram mantidas");
    failSave = false; await act(async () => vm.handleSave()); await act(async () => vm.reload());
    expect(vm.state.company.description).toBe("Rascunho mantido");

    stored.company.description = "Mudança concorrente";
    await act(async () => { vm.setActiveTab("policies"); vm.setPolicies({ ...vm.state.policies, terms: "Novos termos" }); });
    await act(async () => vm.handleSave()); expect(writes.at(-1)).toEqual({ policies: { terms: "Novos termos" } });
    expect(stored.company.description).toBe("Mudança concorrente");

    await act(async () => { vm.setActiveTab("company"); vm.setCompany({ ...vm.state.company, description: "a".repeat(1201) }); });
    const count = writes.length; await act(async () => vm.handleSave()); expect(writes).toHaveLength(count);
    expect(vm.state.saveError).toContain("1.200"); expect(vm.state.company.description).toHaveLength(1201);
    failLoad = true; await act(async () => vm.reload());
    expect(vm.state.loadError).toContain("Não foi possível carregar"); expect(vm.state.company.description).toHaveLength(1201);
    failLoad = false; await act(async () => vm.reload());
    expect(vm.state.loadError).toBeNull(); expect(vm.state.company.description).toBe("Mudança concorrente");

    stored.company.description = "a".repeat(1201);
    await act(async () => vm.reload());
    await act(async () => vm.setCompany({ ...vm.state.company, phone: "11999999999" }));
    await act(async () => vm.handleSave());
    expect(writes.at(-1)).toEqual({ company: { phone: "11999999999" } });
    expect(stored.company.description).toHaveLength(1201);
    expect(vm.state.saveResult).toBe("success");

  } finally { await act(async () => root.unmount()); host.remove(); }
});
