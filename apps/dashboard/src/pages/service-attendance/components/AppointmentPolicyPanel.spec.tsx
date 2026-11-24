/** @vitest-environment jsdom */
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { createDashboardApi, type MerchantProfile } from "../../../api-client.js";
import type { ServiceBusinessPolicyDTO, ServiceBusinessPolicyUpdate } from "../../../api/endpoints/service-attendance.js";
import { ApiContext } from "../../../hooks/useApi.js";
import { ServiceAttendancePage } from "../ServiceAttendancePage.js";

const owner: MerchantProfile = { id: "merchant-a", user_id: "owner-a", name: "Clínica", role: "OWNER", businessMode: "services", businessModeSelectionState: "selected" };
const saved = (online = true): ServiceBusinessPolicyDTO => ({ status: "configured", version: 3,
  policy: { paymentMode: online ? "online" : "at_attendance", holdEnabled: true, holdMinutes: 8, admissionsEnabled: true } });
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); });

async function fixture(initial: ServiceBusinessPolicyDTO = saved(), profile = owner) {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  window.history.replaceState(null, "", "/#service-attendance?tab=settings");
  const policies = new Map([[owner.id, structuredClone(initial)], ["merchant-b", saved(false)]]);
  const calls: Array<{ path: string; method: string; body: unknown }> = [];
  let authenticatedMerchantId = profile.id;
  let failure = 0, loseAcknowledgement = false, hold = false, release: (() => void) | undefined;
  const fetcher: typeof fetch = async (input, init) => {
    const path = new URL(String(input)).pathname, method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ path, method, body });
    if (path.endsWith("/service-professionals")) return Response.json({ items: [], nextCursor: null });
    if (path.endsWith("/categories")) return Response.json([]);
    if (!path.endsWith("/service-business-policy")) throw Error("unexpected_policy_request");
    const merchantId = authenticatedMerchantId, current = policies.get(merchantId)!;
    if (method === "GET") return Response.json(current);
    if (failure) return Response.json({ message: "private_internal_detail" }, { status: failure });
    if (hold) { hold = false; await new Promise<void>(done => { release = done; }); }
    if (body.expectedVersion !== current.version) return Response.json({ code: "service_policy_version_conflict" }, { status: 409 });
    const { expectedVersion, ...configuration } = body as ServiceBusinessPolicyUpdate;
    const next: ServiceBusinessPolicyDTO = { status: "configured", version: expectedVersion + 1, policy: configuration };
    policies.set(merchantId, next);
    if (loseAcknowledgement) { loseAcknowledgement = false; throw new TypeError("synthetic_ack_lost"); }
    return Response.json(next);
  };
  const api = createDashboardApi({ baseUrl: "https://api.example.test", fetchImpl: fetcher });
  const host = document.createElement("div"); document.body.append(host); let root = createRoot(host);
  const render = (me: MerchantProfile | null) => {
    authenticatedMerchantId = me?.id ?? "";
    return act(async () => root.render(<ApiContext.Provider value={api}><ServiceAttendancePage me={me} /></ApiContext.Provider>));
  };
  const reload = async () => {
    await act(async () => root.unmount());
    root = createRoot(host);
    await render(profile);
  };
  cleanups.push(async () => { release?.(); await act(async () => root.unmount()); host.remove(); });
  await render(profile);
  return { host, calls, render, reload, policies, fail: (status: number) => { failure = status; }, loseAck: () => { loseAcknowledgement = true; },
    holdPut: () => { hold = true; }, release: () => act(async () => { release?.(); release = undefined; }) };
}
function control<T extends HTMLElement>(host: HTMLElement, text: string): T {
  const label = Array.from(host.querySelectorAll("label")).find(item => item.textContent?.trim() === text)!;
  return host.querySelector<T>(`[id="${label.htmlFor}"]`)!;
}
const button = (host: HTMLElement, text: string) => Array.from(host.querySelectorAll<HTMLButtonElement>("button")).find(item => item.textContent?.trim() === text)!;
const click = (element: HTMLElement) => act(async () => element.click());
async function select(host: HTMLElement, label: string, value: string) {
  const field = control<HTMLSelectElement>(host, label);
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(field, value); field.dispatchEvent(new Event("change", { bubbles: true })); });
}

describe("T81 real policy controls", () => {
  it("starts a new business with collection off, no automatic save and an explicit hold choice", async () => {
    const f = await fixture({ status: "unconfigured", version: 0, policy: null });
    expect(control(f.host, "Cobrança online").getAttribute("aria-checked")).toBe("false");
    expect(control<HTMLSelectElement>(f.host, "Reserva temporária").value).toBe("");
    expect(f.calls.every(row => row.method === "GET")).toBe(true);
    await select(f.host, "Reserva temporária", "off"); await click(button(f.host, "Salvar política"));
    expect(f.policies.get(owner.id)).toEqual({ status: "configured", version: 1,
      policy: { paymentMode: "at_attendance", holdEnabled: false, holdMinutes: null, admissionsEnabled: false } });
    expect(f.host.textContent).toContain("Configuração salva");
  });
  it("switches online collection off while preserving the existing balance policy, hold and admission", async () => {
    const f = await fixture(); expect(control(f.host, "Cobrança online").getAttribute("aria-checked")).toBe("true");
    await click(control(f.host, "Cobrança online")); await click(button(f.host, "Salvar política"));
    expect(f.calls.filter(row => row.method === "PUT")).toEqual([{ path: "/v1/merchants/me/service-business-policy", method: "PUT",
      body: { expectedVersion: 3, paymentMode: "at_attendance", holdEnabled: true, holdMinutes: 8, admissionsEnabled: true } }]);
    expect(f.host.textContent).toContain("Pagamento no atendimento"); expect(f.calls.some(row => /checkout|payment-intent/.test(row.path))).toBe(false);
    await f.reload(); expect(control(f.host, "Cobrança online").getAttribute("aria-checked")).toBe("false");
  });
  it("activates checkout policy only after the explicit toggle and save", async () => {
    const f = await fixture(saved(false)); await click(control(f.host, "Cobrança online"));
    expect(f.policies.get(owner.id)).toEqual(saved(false)); await click(button(f.host, "Salvar política"));
    expect(f.policies.get(owner.id)).toEqual({ ...saved(true), version: 4 });
    expect(f.host.textContent).toContain("Pagamento on-line"); expect(f.calls.some(row => /checkout|payment-intent/.test(row.path))).toBe(false);
  });
  for (const status of [400, 403, 409]) it(`a ${status} response preserves the draft and saved configuration`, async () => {
    const f = await fixture(); await click(control(f.host, "Cobrança online")); f.fail(status); await click(button(f.host, "Salvar política"));
    expect(control(f.host, "Cobrança online").getAttribute("aria-checked")).toBe("false"); expect(f.policies.get(owner.id)).toEqual(saved());
    expect(f.host.textContent).not.toContain("Configuração salva"); expect(f.host.textContent).not.toContain("private_internal_detail");
    expect(f.host.querySelector('[role="alert"]')).not.toBeNull(); expect(f.calls.filter(row => row.method === "PUT")).toHaveLength(1);
  });
  it("reconciles a lost save acknowledgement by reading, without repeating the policy write", async () => {
    const f = await fixture(); await click(control(f.host, "Cobrança online")); f.loseAck(); await click(button(f.host, "Salvar política"));
    expect(f.host.textContent).not.toContain("Configuração salva"); expect(button(f.host, "Salvar política").disabled).toBe(true);
    await click(button(f.host, "Recarregar política"));
    expect(control(f.host, "Cobrança online").getAttribute("aria-checked")).toBe("false");
    expect(button(f.host, "Salvar política").disabled).toBe(true); expect(f.calls.filter(row => row.method === "PUT")).toHaveLength(1);
    expect(f.policies.get(owner.id)).toEqual({ ...saved(false), version: 4 });
  });
  it("does not apply a completed save from the previous merchant to the current merchant", async () => {
    const f = await fixture(); await click(control(f.host, "Cobrança online")); f.holdPut(); await click(button(f.host, "Salvar política"));
    await f.render({ ...owner, id: "merchant-b", user_id: "owner-b" }); await click(button(f.host, "Configurações")); await f.release();
    expect(control(f.host, "Cobrança online").getAttribute("aria-checked")).toBe("false");
    expect(f.host.textContent).not.toContain("Configuração salva"); expect(f.policies.get("merchant-b")).toEqual(saved(false));
  });
  for (const me of [{ ...owner, role: "STAFF" as const }, { ...owner, businessMode: "products" as const }])
    it(`denies policy controls and configuration reads for ${me.role}/${me.businessMode}`, async () => {
      const f = await fixture(saved(), me); expect(f.host.querySelector('[role="switch"]')).toBeNull(); expect(f.calls).toEqual([]);
    });
});
