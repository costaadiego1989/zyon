/** @vitest-environment jsdom */
import React, { act } from "react";
import type { Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDashboardApi, SESSION_EXPIRED_EVENT } from "./api-client.js";
import { ApiContext } from "./hooks/useApi.js";
import { App } from "./main.js";

const observed = vi.hoisted(() => ({ shellRoles: [] as string[], socketScopes: [] as Array<string | undefined> }));
vi.mock("react-dom/client", () => ({ createRoot: () => ({ render: () => {} }) }));
vi.mock("./shell/DashboardShell.js", () => ({ DashboardShell: (props: { me: { role?: string } }) => {
  observed.shellRoles.push(props.me.role ?? "missing"); return null;
} }));
vi.mock("./hooks/useSupportSocket.js", () => ({ useSupportSocket: (_base: string, merchantId: string | undefined) => {
  observed.socketScopes.push(merchantId); return { connected: true, joinTicket: () => {}, leaveTicket: () => {},
    onNewMessage: () => () => {}, onCaseUpdated: () => () => {}, onConnected: () => () => {} };
} }));
vi.mock("./auth/AuthScreen.js", async () => {
  const { createElement: h } = await import("react");
  return { AuthScreen: (props: { email: string; password: string; busy: boolean; hint: string | null; setEmail: (value: string) => void; setPassword: (value: string) => void; onSubmit: (event: React.FormEvent) => void }) =>
    h("form", { "aria-label": "Login", onSubmit: props.onSubmit },
      h("input", { "aria-label": "Email", value: props.email, onChange: (event: React.ChangeEvent<HTMLInputElement>) => props.setEmail(event.target.value) }),
      h("input", { "aria-label": "Password", type: "password", value: props.password, onChange: (event: React.ChangeEvent<HTMLInputElement>) => props.setPassword(event.target.value) }),
      props.hint ? h("p", { role: "alert" }, props.hint) : null,
      h("button", { type: "submit", disabled: props.busy }, "Entrar")) };
});
const mounts: Array<{ root: Root; host: HTMLElement }> = [];
beforeEach(() => { Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); observed.shellRoles.length = 0; observed.socketScopes.length = 0;
  localStorage.clear(); window.history.replaceState({}, "", "/#whatsapp-seller?tab=conversations"); });
afterEach(async () => { for (const item of mounts.splice(0)) { await act(async () => item.root.unmount()); item.host.remove(); } });
const principal = (suffix: string) => ({ merchant_id: "merchant-" + suffix, user_id: "operator-" + suffix, role: "STAFF" });
async function fixture(options: { holdFirst?: boolean; owner?: boolean } = {}) {
  let first = true, tenant = "a", resolveFirst: ((value: Response) => void) | undefined;
  const held = new Promise<Response>(resolve => { resolveFirst = resolve; });
  const requests: Array<{ path: string; method: string }> = [];
  const api = createDashboardApi({ baseUrl: "https://api.example.test", fetchImpl: async (input, init) => {
    const path = new URL(String(input)).pathname, method = init?.method ?? "GET"; requests.push({ path, method });
    if (path === "/v1/merchants/me") return options.owner ? Response.json({ id: "merchant-owner", name: "Owner shop", role: "owner", userId: "owner-user" }) : Response.json({}, { status: 403 });
    if (path.endsWith("/conversations/context")) { if (first && options.holdFirst) { first = false; return held; } return Response.json(principal(tenant)); }
    if (path.endsWith("/conversations")) return Response.json({ data: [{ id: "ticket-" + tenant, status: "open", buyerMessage: "Fila " + tenant.toUpperCase(), createdAt: "2026-11-19T10:00:00Z", updatedAt: "2026-11-19T10:00:00Z", binding: null }], has_more: false, next_cursor: null });
    if (path === "/v1/auth/login") { tenant = "b"; return Response.json({}); }
    if (path === "/v1/auth/logout") return Response.json({});
    if (options.owner && path === "/v1/merchants/me/store-settings") return Response.json({});
    if (options.owner && path === "/v1/billing/subscription") return Response.json({ trial_expired: false });
    if (options.owner && path === "/v1/onboarding") return Response.json({ completed: true });
    throw Error("unexpected_private_request:" + path);
  } });
  const { createRoot } = await vi.importActual<typeof import("react-dom/client")>("react-dom/client");
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host); mounts.push({ root, host });
  await act(async () => root.render(<ApiContext.Provider value={api}><App api={api} /></ApiContext.Provider>));
  return { requests, async releaseOld() { await act(async () => resolveFirst!(Response.json(principal("a")))); } };
}
async function expire() { await act(async () => window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT))); }
async function login() {
  await act(async () => {
    for (const [label, value] of [["Email", "b@example.test"], ["Password", "SyntheticPassword123!"]]) {
      const input = document.querySelector<HTMLInputElement>('[aria-label="' + label + '"]')!;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true }));
    }
  });
  await act(async () => document.querySelector('form[aria-label="Login"]')!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
}

describe("T62 real App session composition keeps Staff outside the private merchant bootstrap", () => {
  it("mounts canonical Staff Conversations after profile403 without private settings or an invented profile", async () => {
    const f = await fixture(); expect(document.body.textContent).toContain("Fila A"); expect(observed.shellRoles).toEqual([]);
    expect(f.requests.some(request => /store-settings|billing|onboarding|auth\/me/.test(request.path))).toBe(false);
    expect(f.requests.filter(request => request.path.endsWith("/context"))).toHaveLength(1);
  });
  it("session expiry invalidates a pending context response before it can resurrect Staff", async () => {
    const f = await fixture({ holdFirst: true }); await expire();
    expect(document.querySelector('form[aria-label="Login"]')).not.toBeNull(); await f.releaseOld();
    expect(document.querySelector('form[aria-label="Login"]')).not.toBeNull(); expect(document.body.textContent).not.toContain("Fila A");
    expect(observed.socketScopes.filter(Boolean)).toEqual([]); expect(observed.shellRoles).toEqual([]);
  });
  it("the real logout gesture removes Staff context and its visible conversation history", async () => {
    const f = await fixture(); const logout = Array.from(document.querySelectorAll("button")).find(button => button.textContent?.trim() === "Sair")!;
    await act(async () => logout.click());
    expect(document.querySelector('form[aria-label="Login"]')).not.toBeNull(); expect(document.body.textContent).not.toContain("Fila A");
    expect(f.requests.some(request => request.method === "POST" && request.path.endsWith("/auth/logout"))).toBe(true);
  });
  it("a newer login remains authoritative when an old Staff context resolves late", async () => {
    const f = await fixture({ holdFirst: true }); await expire(); await login(); expect(document.body.textContent).toContain("Fila B");
    const count = observed.socketScopes.length; await f.releaseOld();
    expect(document.body.textContent).toContain("Fila B"); expect(document.body.textContent).not.toContain("Fila A");
    expect(observed.socketScopes.slice(count).filter(Boolean).every(value => value === "merchant-b")).toBe(true); expect(observed.shellRoles).toEqual([]);
  });
  it("Owner keeps the normal profile/settings/billing/onboarding bootstrap and private Shell", async () => {
    const f = await fixture({ owner: true });
    expect(observed.shellRoles).toEqual(["OWNER"]); expect(f.requests.some(request => request.path.endsWith("/context"))).toBe(false);
    for (const path of ["/v1/merchants/me/store-settings", "/v1/billing/subscription", "/v1/onboarding"]) expect(f.requests.some(request => request.path === path)).toBe(true);
  });
});
