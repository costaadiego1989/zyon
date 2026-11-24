/** @vitest-environment jsdom */
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { createDashboardApi, type MerchantProfile } from "../../../api-client.js";
import type { ServiceBusinessPolicyDTO, ServiceBusinessPolicyUpdate } from "../../../api/endpoints/service-attendance.js";
import { ApiContext } from "../../../hooks/useApi.js";
import { ServiceAttendancePage } from "../ServiceAttendancePage.js";
import type { useServiceAttendancePage } from "../useServiceAttendancePage.js";
import { AppointmentPolicyPanel } from "./AppointmentPolicyPanel.js";

type VM = ReturnType<typeof useServiceAttendancePage>;
const owner: MerchantProfile = { id: "merchant-a", user_id: "owner-a", name: "A", role: "OWNER", businessMode: "services", businessModeSelectionState: "selected" };
const other = { ...owner, id: "merchant-b", user_id: "owner-b" };
const labels = { online: "Cobran\u00e7a online", hold: "Reserva tempor\u00e1ria", minutes: "Dura\u00e7\u00e3o da reserva (minutos)", save: "Salvar pol\u00edtica" };
const policy = (version: number, online = false, minutes: number | null = null): ServiceBusinessPolicyDTO => ({ status: "configured", version,
  policy: { paymentMode: online ? "online" : "at_attendance", holdEnabled: minutes !== null, holdMinutes: minutes, admissionsEnabled: true } });
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); });
function deferred() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; }
function control<T extends HTMLElement>(host: HTMLElement, text: string): T {
  const label = Array.from(host.querySelectorAll("label")).find(item => item.textContent?.trim() === text)!;
  return host.querySelector<T>(`[id="${label.htmlFor}"]`)!;
}
function button(host: HTMLElement, text: string) {
  return Array.from(host.querySelectorAll<HTMLButtonElement>("button")).find(item => item.textContent?.trim() === text)!;
}
const click = (element: HTMLElement) => act(async () => element.click());
async function chooseHold(host: HTMLElement, minutes: string) {
  await act(async () => {
    const field = control<HTMLSelectElement>(host, labels.hold);
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(field, "on");
    field.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await act(async () => {
    const field = control<HTMLInputElement>(host, labels.minutes);
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field, minutes);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function fixture() {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  window.history.replaceState(null, "", "/#service-attendance?tab=settings");
  const policies = new Map([[owner.id, policy(8)], [other.id, policy(10, false, 6)]]);
  const calls: Array<{ merchant: string; method: string; path: string; body: any }> = [];
  let merchant = owner.id, readFailure = 0, readOverride: ServiceBusinessPolicyDTO | undefined;
  let held: ReturnType<typeof deferred> | undefined, latest!: VM;
  const api = createDashboardApi({ baseUrl: "https://api.example.test", fetchImpl: (async (input, init) => {
    const path = new URL(String(input)).pathname, method = init?.method ?? "GET", capturedMerchant = merchant;
    const body = init?.body == null ? undefined : JSON.parse(String(init.body));
    calls.push({ merchant: capturedMerchant, method, path, body });
    if (path.endsWith("/service-professionals")) return Response.json({ items: [], nextCursor: null });
    if (path.endsWith("/categories")) return Response.json([]);
    if (!path.endsWith("/service-business-policy")) throw Error("unexpected_policy_request");
    if (method === "GET") return readFailure ? Response.json({ code: "read_unavailable" }, { status: readFailure }) : Response.json(readOverride ?? policies.get(capturedMerchant));
    const current = policies.get(capturedMerchant)!;
    if (body.expectedVersion !== current.version) return Response.json({ code: "service_policy_version_conflict" }, { status: 409 });
    const { expectedVersion, ...configuration } = body as ServiceBusinessPolicyUpdate;
    const saved: ServiceBusinessPolicyDTO = { status: "configured", version: expectedVersion + 1, policy: configuration };
    policies.set(capturedMerchant, saved);
    if (held) await held.promise;
    return Response.json(saved);
  }) as typeof fetch });
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  const render = (profile: MerchantProfile) => {
    merchant = profile.id;
    return act(async () => root.render(<ApiContext.Provider value={api}><ServiceAttendancePage me={profile} renderPanel={(_tab, vm) => {
      latest = vm; return <AppointmentPolicyPanel me={profile} vm={vm} />;
    }} /></ApiContext.Provider>));
  };
  cleanups.push(async () => { held?.resolve(); await act(async () => root.unmount()); host.remove(); });
  await render(owner);
  return { host, calls, policies, vm: () => latest, render,
    failRead: (status: number) => { readFailure = status; }, returnRead: (value?: ServiceBusinessPolicyDTO) => { readOverride = value; },
    holdAck: () => { held = deferred(); }, releaseAck: () => act(async () => { held?.resolve(); held = undefined; }) };
}

describe("T81 acknowledged policy remains canonical when its following read fails", () => {
  for (const status of [429, 503]) it(`retains policy9/online/hold4 and confirmation after PUT200 then GET${status}, retrying only reads`, async () => {
    const f = await fixture(); await click(control(f.host, labels.online)); await chooseHold(f.host, "4");
    f.failRead(status); await click(button(f.host, labels.save));
    expect(f.policies.get(owner.id)).toEqual(policy(9, true, 4));
    expect(f.vm().loadState).toMatchObject({ status: "error", data: { policy: policy(9, true, 4) } });
    expect(f.vm().command.status).toBe("success");
    expect(control(f.host, labels.online).getAttribute("aria-checked")).toBe("true");
    expect(control<HTMLInputElement>(f.host, labels.minutes).value).toBe("4");
    expect(f.host.textContent).toContain("Pagamento on-line");
    expect(f.host.textContent).toContain("Configura\u00e7\u00e3o salva.");
    expect(f.host.textContent).toContain("N\u00e3o foi poss\u00edvel atualizar o atendimento");
    expect(button(f.host, labels.save).disabled).toBe(true);
    const priorCalls = f.calls.length; f.failRead(0); await click(button(f.host, "Tentar novamente"));
    expect(f.calls.slice(priorCalls).every(call => call.method === "GET")).toBe(true);
    expect(f.calls.filter(call => call.method === "PUT")).toHaveLength(1);
    expect(f.vm().loadState.data?.policy).toEqual(policy(9, true, 4));
    expect(control(f.host, labels.online).getAttribute("aria-checked")).toBe("true");
    expect(f.host.textContent).toContain("Configura\u00e7\u00e3o salva.");
  });

  it("does not roll an acknowledged editor9 back to incoming8; the next explicit save uses version9", async () => {
    const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
    let server = policy(8), incoming = policy(8); const writes: ServiceBusinessPolicyUpdate[] = [];
    const render = () => act(async () => {
      const vm = { loadState: { status: "error", data: { policy: incoming } }, command: { status: "idle" },
        actions: { updatePolicy: async (input: ServiceBusinessPolicyUpdate) => {
          writes.push(input); expect(input.expectedVersion).toBe(server.version);
          const { expectedVersion, ...configuration } = input;
          server = { status: "configured", version: expectedVersion + 1, policy: configuration };
          return { status: "success", value: server };
        } }, refresh: async () => true } as unknown as VM;
      root.render(<AppointmentPolicyPanel me={owner} vm={vm} />);
    });
    cleanups.push(async () => { await act(async () => root.unmount()); host.remove(); });
    await render(); await click(control(host, labels.online)); await chooseHold(host, "4"); await click(button(host, labels.save));
    incoming = structuredClone(policy(8)); await render();
    expect(control(host, labels.online).getAttribute("aria-checked")).toBe("true");
    expect(control<HTMLInputElement>(host, labels.minutes).value).toBe("4");
    expect(host.textContent).toContain("Pagamento on-line"); expect(host.textContent).toContain("Configura\u00e7\u00e3o salva.");
    expect(writes).toHaveLength(1);
    await click(control(host, labels.online)); await click(button(host, labels.save));
    expect(writes).toHaveLength(2); expect(writes[1]!.expectedVersion).toBe(9);
  });

  it("does not publish late PUT9 or its later stale GET8 over the same context's observed policy10", async () => {
    const f = await fixture(); await click(control(f.host, labels.online)); await chooseHold(f.host, "4");
    f.holdAck(); await click(button(f.host, labels.save));
    f.policies.set(owner.id, policy(10, false, 6)); await act(async () => { await f.vm().refresh(); });
    expect(f.vm().loadState.data?.policy.version).toBe(10);
    f.returnRead(policy(8)); await f.releaseAck();
    expect(f.vm().loadState.data?.policy).toEqual(policy(10, false, 6));
    expect(f.host.textContent).toContain("6 minutos");
    expect(f.host.textContent).toContain("A configura\u00e7\u00e3o foi atualizada.");
    expect(f.calls.filter(call => call.method === "PUT")).toHaveLength(1);
    expect(button(f.host, labels.save).disabled).toBe(true);
  });

  for (const returnToFirstMerchant of [false, true]) it(`refuses late policy9 after merchant context change${returnToFirstMerchant ? " and ABA return" : ""}`, async () => {
    const f = await fixture(); await click(control(f.host, labels.online)); f.holdAck(); await click(button(f.host, labels.save));
    await f.render(other);
    if (returnToFirstMerchant) { f.policies.set(owner.id, policy(10, false, 6)); await f.render({ ...owner }); }
    await f.releaseAck();
    expect(f.vm().loadState.data?.policy).toEqual(policy(10, false, 6));
    expect(control(f.host, labels.online).getAttribute("aria-checked")).toBe("false");
    expect(control<HTMLInputElement>(f.host, labels.minutes).value).toBe("6");
    expect(f.host.textContent).not.toContain("Configura\u00e7\u00e3o salva.");
    expect(f.calls.filter(call => call.method === "PUT")).toHaveLength(1);
  });
});
