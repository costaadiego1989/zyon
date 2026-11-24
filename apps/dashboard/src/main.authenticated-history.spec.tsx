/** @vitest-environment jsdom */
import React, { act } from "react";
import type { Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDashboardApi } from "./api-client.js";
import { ApiContext } from "./hooks/useApi.js";
import { App } from "./main.js";

vi.mock("react-dom/client", () => ({ createRoot: () => ({ render: () => {} }) }));
vi.mock("./shell/DashboardShell.js", () => ({ DashboardShell: () => <h1>Authorized owner shell</h1> }));
vi.mock("./auth/AuthScreen.js", () => ({ AuthScreen: (props: {
  mode: string; email: string; password: string; busy: boolean; hint: string | null;
  setEmail: (value: string) => void; setPassword: (value: string) => void;
  onSubmit: (event: React.FormEvent) => void;
}) => <form aria-label="Login" data-auth-mode={props.mode} onSubmit={props.onSubmit}>
  <input aria-label="Email" value={props.email} onChange={event => props.setEmail(event.target.value)} />
  <input aria-label="Password" type="password" value={props.password} onChange={event => props.setPassword(event.target.value)} />
  {props.hint ? <p role="alert">{props.hint}</p> : null}
  <button type="submit" disabled={props.busy}>Entrar</button>
</form> }));

const mounts: Array<{ root: Root; host: HTMLElement }> = [];
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  localStorage.clear();
  window.history.replaceState({ source: "owned-history" }, "", "/?mode=signin#service-appointments?fromDate=2030-01-01&toDate=2030-01-04");
});
afterEach(async () => {
  for (const item of mounts.splice(0)) {
    await act(async () => item.root.unmount());
    item.host.remove();
  }
});

async function fixture(options: { authenticated?: boolean; loginStatus?: number; profileStatus?: number; registrationPending?: boolean } = {}) {
  let authenticated = options.authenticated ?? false;
  let historyBeforeConfirmedProfile: unknown;
  const requests: Array<{ path: string; method: string; status: number }> = [];
  const api = createDashboardApi({ baseUrl: "https://api.example.test", fetchImpl: async (input, init) => {
    const path = new URL(String(input)).pathname, method = init?.method ?? "GET";
    let response: Response;
    if (path === "/v1/merchants/me") response = authenticated
      ? Response.json({ id: "merchant-owner", name: "Owner shop", role: "owner", userId: "owner-user", businessMode: "services", businessModeSelectionState: "selected" }, { status: options.profileStatus ?? 200 })
      : Response.json({ code: "unauthorized" }, { status: 401 });
    else if (path === "/v1/auth/refresh") response = Response.json({ code: "unauthorized" }, { status: 401 });
    else if (path === "/v1/auth/login") {
      const status = options.loginStatus ?? 201;
      if (status === 201) authenticated = true;
      response = Response.json(status === 201 ? { access_token: "synthetic-owner-token" } : { code: "invalid_credentials" }, { status });
    } else if (path === "/v1/merchants/me/store-settings") response = Response.json({ registration_pending: options.registrationPending ?? false });
    else if (path === "/v1/billing/subscription") response = Response.json({ trial_expired: false });
    else if (path === "/v1/onboarding") response = Response.json({ completed: true });
    else if (path === "/v1/auth/me") response = Response.json({ name: "Owner", email: "owner@example.test" });
    else throw Error("unexpected_private_request:" + path);
    if (path === "/v1/merchants/me" && response.status === 200) historyBeforeConfirmedProfile = JSON.parse(JSON.stringify(window.history.state));
    requests.push({ path, method, status: response.status });
    return response;
  } });
  const { createRoot } = await vi.importActual<typeof import("react-dom/client")>("react-dom/client");
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host); mounts.push({ root, host });
  await act(async () => root.render(<ApiContext.Provider value={api}><App api={api} /></ApiContext.Provider>));
  return { requests, host, get historyBeforeConfirmedProfile() { return historyBeforeConfirmedProfile; } };
}

async function login() {
  await act(async () => {
    for (const [label, value] of [["Email", "owner@example.test"], ["Password", "SyntheticPassword123!"]]) {
      const input = document.querySelector<HTMLInputElement>('[aria-label="' + label + '"]')!;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }
  });
  await act(async () => document.querySelector('form[aria-label="Login"]')!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
}

describe("confirmed owner session retires only the public login URL marker", () => {
  it("normalizes a cookie-restored owner before direct service hash navigation without adding a history entry", async () => {
    const length = window.history.length;
    const f = await fixture({ authenticated: true });
    expect(f.host.textContent).toContain("Authorized owner shell");
    expect(window.location.search).toBe("");
    expect(window.location.hash).toBe("#service-appointments?fromDate=2030-01-01&toDate=2030-01-04");
    expect(window.history.state).toEqual(f.historyBeforeConfirmedProfile);
    expect(window.history.state.source).toBe("owned-history");
    expect(window.history.length).toBe(length);
    expect(f.requests.some(row => row.path === "/v1/auth/login")).toBe(false);
    const current = new URL(window.location.href), target = new URL("/#service-attendance?tab=availability&professionalId=professional-owned", current);
    expect([current.origin, current.pathname, current.search]).toEqual([target.origin, target.pathname, target.search]);
  });

  it.each(["signin", "login"])("keeps the real owner bootstrap and hash-only history after %s authentication succeeds", async mode => {
    window.history.replaceState({ source: "owned-history" }, "", "/?mode=" + mode + "#service-appointments?fromDate=2030-01-01&toDate=2030-01-04");
    const length = window.history.length, f = await fixture();
    expect(f.host.querySelector('form[aria-label="Login"]')).not.toBeNull();
    await login();
    expect(f.requests.filter(row => row.path === "/v1/auth/login")).toEqual([{ path: "/v1/auth/login", method: "POST", status: 201 }]);
    expect(f.host.textContent).toContain("Authorized owner shell");
    expect(window.location.search).toBe("");
    expect(window.history.state).toEqual(f.historyBeforeConfirmedProfile);
    expect(window.history.state.source).toBe("owned-history");
    expect(window.history.length).toBe(length);
    const before = f.requests.length;
    await act(async () => { window.location.hash = "#service-attendance?tab=availability&professionalId=professional-owned"; window.dispatchEvent(new HashChangeEvent("hashchange")); });
    expect(f.host.textContent).toContain("Authorized owner shell");
    expect(f.requests).toHaveLength(before);
    for (const path of ["/v1/merchants/me/store-settings", "/v1/billing/subscription", "/v1/onboarding"]) expect(f.requests.some(row => row.path === path && row.status === 200)).toBe(true);
  });

  it("does not normalize a failed login or manufacture an authenticated owner", async () => {
    const original = window.location.href, f = await fixture({ loginStatus: 401 });
    await login();
    expect(window.location.href).toBe(original);
    expect(f.host.querySelector('form[aria-label="Login"]')).not.toBeNull();
    expect(f.host.textContent).not.toContain("Authorized owner shell");
    expect(f.requests.some(row => row.path === "/v1/merchants/me/store-settings")).toBe(false);
  });

  it("preserves benign subscription parameters, the service query and the existing history state", async () => {
    window.history.replaceState({ source: "owned-history" }, "", "/?mode=signin&plan=growth&utm_source=owned#service-appointments?fromDate=2030-01-01&toDate=2030-01-04");
    const f = await fixture({ authenticated: true }), current = new URL(window.location.href);
    expect(f.host.querySelector('section[aria-labelledby="plan-selection-title"] #plan-selection-title')?.textContent).toBe("Sua loja pronta para o próximo passo.");
    expect([...current.searchParams.entries()]).toEqual([["plan", "growth"], ["utm_source", "owned"]]);
    expect(current.hash).toBe("#service-appointments?fromDate=2030-01-01&toDate=2030-01-04");
    expect(window.history.state).toEqual(f.historyBeforeConfirmedProfile);
    expect(window.history.state.source).toBe("owned-history");
  });

  it("retains the existing pending-registration boundary before owner shell or URL normalization", async () => {
    const f = await fixture({ authenticated: true, registrationPending: true });
    expect(f.host.textContent).not.toContain("Authorized owner shell");
    expect(f.host.querySelector('form[data-auth-mode="signup"]')).not.toBeNull();
    expect(new URL(window.location.href).searchParams.get("mode")).toBe("signup");
    expect(f.requests.some(row => row.path === "/v1/billing/subscription")).toBe(false);
  });
});
