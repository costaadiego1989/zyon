/** @vitest-environment jsdom */
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { createDashboardApi } from "../../api-client.js";
import { ApiContext } from "../../hooks/useApi.js";
import { useStoreSettingsPage } from "./useStoreSettingsPage.js";
vi.mock("../../hooks/useErrorReporter.js", () => ({ reportError: vi.fn() }));

async function fixture(mode: "products" | "services" = "services") {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  let businessMode = mode;
  let stored = { company: { description: "Public company", email: "public@example.test", serviceNames: ["Consulta inicial"] }, policies: { terms: "Public terms" }, unrelated: "preserved" };
  let failSave = false, confirmNames = true;
  const writes: Record<string, any>[] = [];
  const api = createDashboardApi({ baseUrl: "http://local.test", fetchImpl: async (input, init) => {
    const path = new URL(String(input)).pathname;
    if (path.endsWith("/merchants/me/store-settings")) {
      if (init?.method === "PUT") {
        const body = JSON.parse(String(init.body)); writes.push(body);
        if (failSave) return Response.json({ message: "synthetic_save_failure" }, { status: 500 });
        stored = { ...stored, ...body, company: { ...stored.company, ...body.company }, policies: { ...stored.policies, ...body.policies } };
      }
      return Response.json(confirmNames ? stored : { ...stored, company: { ...stored.company, serviceNames: [] } });
    }
    if (path.endsWith("/merchants/me/theme")) return Response.json({});
    if (path.endsWith("/merchants/me")) return Response.json({ id: "own", user_id: "owner", name: "Empresa", role: "owner", businessMode });
    throw new Error("unexpected_fixture_request:" + path);
  } });
  let vm!: ReturnType<typeof useStoreSettingsPage>;
  function Probe() { vm = useStoreSettingsPage(); return null; }
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  await act(async () => root.render(createElement(ApiContext.Provider, { value: api }, createElement(Probe))));
  return { vm: () => vm, writes, stored: () => stored, concurrentEmail: () => { stored.company.email = "concurrent@example.test"; },
    fail: (value: boolean) => { failSave = value; }, confirm: (value: boolean) => { confirmNames = value; }, mode: (value: typeof mode) => { businessMode = value; },
    close: async () => { await act(async () => root.unmount()); host.remove(); } };
}

it("T97 hook loads, patches only changed names, preserves concurrent fields, reloads and clears", async () => {
  const f = await fixture(); try {
    expect(f.vm().state.businessMode).toBe("services"); expect(f.vm().state.company.serviceNames).toEqual(["Consulta inicial"]);
    f.concurrentEmail();
    await act(async () => f.vm().setCompany({ ...f.vm().state.company, serviceNames: ["Consulta pública", "Retorno"] }));
    await act(async () => f.vm().handleSave());
    expect(f.writes.at(-1)).toEqual({ company: { serviceNames: ["Consulta pública", "Retorno"] } }); expect(f.stored().company.email).toBe("concurrent@example.test"); expect(f.stored().unrelated).toBe("preserved"); expect(f.vm().state.saveResult).toBe("success");
    await act(async () => f.vm().reload()); expect(f.vm().state.company.serviceNames).toEqual(["Consulta pública", "Retorno"]);
    await act(async () => { f.vm().setActiveTab("policies"); f.vm().setPolicies({ ...f.vm().state.policies, terms: "New terms" }); });
    await act(async () => f.vm().handleSave()); expect(f.writes.at(-1)).toEqual({ policies: { terms: "New terms" } });
    await act(async () => { f.vm().setActiveTab("company"); f.vm().setCompany({ ...f.vm().state.company, serviceNames: [] }); });
    await act(async () => f.vm().handleSave()); expect(f.writes.at(-1)).toEqual({ company: { serviceNames: [] } });
    await act(async () => f.vm().reload()); expect(f.vm().state.company.serviceNames).toEqual([]);
  } finally { await f.close(); }
});
it("T97 hook keeps the draft and retries an unconfirmed or failed write", async () => {
  const f = await fixture(); try {
    await act(async () => f.vm().setCompany({ ...f.vm().state.company, serviceNames: ["Draft retained"] }));
    f.fail(true); await act(async () => f.vm().handleSave()); expect(f.vm().state.saveResult).toBe("error"); expect(f.vm().state.company.serviceNames).toEqual(["Draft retained"]); expect(f.stored().company.serviceNames).toEqual(["Consulta inicial"]);
    f.fail(false); f.confirm(false); await act(async () => f.vm().handleSave()); expect(f.vm().state.saveResult).toBe("error"); expect(f.vm().state.company.serviceNames).toEqual(["Draft retained"]);
    f.confirm(true); await act(async () => f.vm().handleSave()); expect(f.writes.at(-1)).toEqual({ company: { serviceNames: ["Draft retained"] } }); expect(f.vm().state.saveResult).toBe("success");
  } finally { await f.close(); }
});
it("T97 hook excludes historical names in products and after a canonical mode reload", async () => {
  const f = await fixture(); try {
    f.mode("products"); await act(async () => f.vm().reload()); expect(f.vm().state.businessMode).toBe("products"); expect(f.vm().state.company.serviceNames).toEqual([]);
    await act(async () => f.vm().setCompany({ ...f.vm().state.company, serviceNames: ["Forged hidden draft"], description: "New public description" }));
    await act(async () => f.vm().handleSave()); expect(f.writes.at(-1)).toEqual({ company: { description: "New public description" } }); expect(f.stored().company.serviceNames).toEqual(["Consulta inicial"]);
    f.mode("services"); await act(async () => f.vm().reload()); expect(f.vm().state.company.serviceNames).toEqual(["Consulta inicial"]);
  } finally { await f.close(); }
});
it("T97 hook validates unique trimmed names and100/160 limits before transport", async () => {
  const f = await fixture(); try {
    for (const serviceNames of [[""], ["  "], ["A", "Ａ"], ["Consulta", " consulta "], ["a".repeat(161)], Array.from({ length: 101 }, (_, index) => "Name " + index)]) {
      await act(async () => f.vm().setCompany({ ...f.vm().state.company, serviceNames })); await act(async () => f.vm().handleSave()); expect(f.writes).toHaveLength(0); expect(f.vm().state.saveResult).toBe("error");
    }
    const hundred = Array.from({ length: 100 }, (_, index) => String(index).padStart(3, "0") + "a".repeat(157));
    await act(async () => f.vm().setCompany({ ...f.vm().state.company, serviceNames: hundred })); await act(async () => f.vm().handleSave()); expect(f.writes.at(-1)).toEqual({ company: { serviceNames: hundred } }); expect(f.vm().state.saveResult).toBe("success");
  } finally { await f.close(); }
});
