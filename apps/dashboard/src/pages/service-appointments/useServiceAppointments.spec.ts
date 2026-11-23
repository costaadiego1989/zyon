/** @vitest-environment jsdom */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { createDashboardApi, SESSION_EXPIRED_EVENT, type MerchantProfile } from "../../api-client.js";
import { ApiContext } from "../../hooks/useApi.js";
import { useServiceAppointments } from "./useServiceAppointments.js";

const profile: MerchantProfile = { id: "merchant-a", user_id: "owner-a", name: "Clínica", role: "OWNER", businessMode: "services", businessModeSelectionState: "selected" };
const period = { fromDate: "2030-01-01", toDate: "2030-01-02" };
type VM = ReturnType<typeof useServiceAppointments>;
type Query = Parameters<typeof useServiceAppointments>[0]["query"];
const mounts: Array<{ root: Root; host: HTMLElement }> = [];
afterEach(async () => { for (const mount of mounts.splice(0)) { await act(async () => mount.root.unmount()); mount.host.remove(); } });
function page(merchantId = "merchant-a", id = "appointment-a", nextCursor: string | null = null) {
  return { items: [{ id, merchantId, professionalId: "professional-a", professionalName: "Ana", productId: "service-a", serviceName: "Consulta", categoryId: "category-a", variantId: "variant-a",
    startsAt: "2030-01-01T13:00:00.000Z", endsAt: "2030-01-01T13:30:00.000Z", timeZone: "America/Sao_Paulo", durationMinutes: 30, priceInCents: 10000,
    currency: "BRL", policyVersion: 2, operationalStatus: "scheduled", origin: "manual", version: 3, customer: { name: "Cliente" }, payments: [] }],
    nextCursor, totalCount: nextCursor || id === "page-two" ? 2 : 1,
    countsByStatus: { pending: 0, scheduled: nextCursor || id === "page-two" ? 2 : 1, in_service: 0, completed: 0, no_show: 0, cancelled: 0 },
    asOf: "2030-01-01T12:00:00.000Z", timeZone: "America/Sao_Paulo" };
}
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
async function fixture(options: { me?: MerchantProfile | null; query?: Query; handle?: (url: URL, init?: RequestInit) => Response | Promise<Response> } = {}) {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const requests: Array<{ url: URL; init?: RequestInit }> = [];
  const api = createDashboardApi({ baseUrl: "https://api.example.test", fetchImpl: (async (input, init) => {
    const url = new URL(String(input)); requests.push({ url, init });
    if (options.handle) return options.handle(url, init);
    return Response.json(page(decodeURIComponent(url.pathname.split("/")[3])));
  }) as typeof fetch });
  let vm!: VM;
  function Probe({ me, query }: { me: MerchantProfile | null; query: Query }) {
    vm = useServiceAppointments({ me, query });
    return React.createElement("output", null, JSON.stringify({ status: vm.status, snapshot: vm.snapshot, issue: vm.issue }));
  }
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host); mounts.push({ root, host });
  async function render(me: MerchantProfile | null, query: Query = options.query ?? period) {
    await act(async () => root.render(React.createElement(ApiContext.Provider, { value: api }, React.createElement(Probe, { me, query }))));
  }
  await render(options.me === undefined ? profile : options.me);
  return { vm: () => vm, render, requests, host, root };
}

describe("T102 scoped appointment loading", () => {
  it.each([null, { ...profile, role: "STAFF" as const }, { ...profile, businessMode: "products" as const },
    { ...profile, businessModeSelectionState: "review_required" as const }])("performs no appointment or order read for forbidden context %j", async me => {
    const f = await fixture({ me });
    expect(f.vm().status).toBe("forbidden"); expect(f.vm().snapshot).toBeNull(); expect(f.requests).toEqual([]);
    expect(await f.vm().refresh()).toBe(false); expect(await f.vm().nextPage()).toBe(false); expect(f.requests).toEqual([]);
  });
  it("loads canonical counts, current rows and six columns without any commerce request", async () => {
    const f = await fixture();
    expect(f.vm().status).toBe("ready"); expect(f.vm().snapshot?.page.totalCount).toBe(1);
    expect(f.vm().snapshot?.board.columns.find(column => column.status === "scheduled")?.entries[0].id).toBe("appointment-a");
    expect(f.requests).toHaveLength(1); expect(f.requests[0].url.pathname).toBe("/v1/merchants/merchant-a/service-appointments");
    expect(f.requests[0].url.searchParams.get("fromDate")).toBe("2030-01-01");
    expect(f.vm().snapshot?.board.allowedActions).toBeNull();
  });
  it("replaces the current page with server totals and uses its exact cursor", async () => {
    const f = await fixture({ handle: url => Response.json(url.searchParams.has("cursor") ? page("merchant-a", "page-two") : page("merchant-a", "first", "server_next")) });
    await act(async () => { await f.vm().nextPage(); });
    expect(f.requests[1].url.searchParams.get("cursor")).toBe("server_next");
    expect(f.vm().snapshot?.page.totalCount).toBe(2); expect(f.vm().snapshot?.board.entries.map(row => row.id)).toEqual(["page-two"]);
    expect(f.vm().snapshot?.board.loadedCount).toBe(1); expect(await f.vm().nextPage()).toBe(false);
    await act(async () => { await f.vm().firstPage(); });
    expect(f.requests[2].url.searchParams.has("cursor")).toBe(false);
  });
  it("discards an old filter response and clears the previous snapshot during a new filter read", async () => {
    const old = deferred<Response>();
    const f = await fixture({ handle: url => url.searchParams.get("professionalId") === "old" ? old.promise : Response.json(page()) });
    await f.render(profile, { ...period, professionalId: "old" });
    expect(f.vm().status).toBe("loading"); expect(f.vm().snapshot).toBeNull();
    await f.render(profile, period);
    await act(async () => old.resolve(Response.json({ ...page(), items: [{ ...page().items[0], professionalId: "old", professionalName: "Private old filter" }] })));
    expect(f.vm().snapshot?.page.items[0].professionalName).toBe("Ana"); expect(f.host.textContent).not.toContain("Private old filter");
  });
  it("masks old merchant data immediately, ignores its response and refuses retained callbacks", async () => {
    const old = deferred<Response>();
    const f = await fixture({ handle: url => url.pathname.includes("merchant-a/") ? old.promise : Response.json(page("merchant-b")) });
    const retained = f.vm().refresh;
    await f.render({ ...profile, id: "merchant-b", user_id: "owner-b" });
    expect(f.vm().snapshot?.page.items[0].merchantId).toBe("merchant-b");
    expect(await retained()).toBe(false);
    await act(async () => old.resolve(Response.json(page("merchant-a"))));
    expect(f.host.textContent).not.toContain('"merchant-a"'); expect(f.requests).toHaveLength(2);
    await f.render(null); expect(f.vm().snapshot).toBeNull(); expect(f.vm().status).toBe("forbidden");
  });
  it("ignores an older refresh even if the transport ignores AbortSignal", async () => {
    const old = deferred<Response>(); let count = 0;
    const f = await fixture({ handle: () => ++count === 2 ? old.promise : Response.json(page("merchant-a", count === 3 ? "latest" : "first")) });
    let pending!: Promise<boolean>;
    await act(async () => { pending = f.vm().refresh(); });
    await act(async () => { await f.vm().refresh(); });
    await act(async () => { old.resolve(Response.json(page("merchant-a", "outdated"))); await pending; });
    expect(f.vm().snapshot?.board.entries[0].id).toBe("latest"); expect(f.requests).toHaveLength(3);
  });
  it("returns an honest error for network failure and an invalid response, preserving only same-query prior facts", async () => {
    let fail = false;
    const f = await fixture({ handle: () => fail ? Response.json({ items: [], totalCount: 0 }) : Response.json(page()) });
    fail = true;
    await act(async () => { await f.vm().refresh(); });
    expect(f.vm().status).toBe("error"); expect(f.vm().issue).toBe("invalid_response");
    expect(f.vm().snapshot?.page.totalCount).toBe(1); expect(f.requests).toHaveLength(2);
    const network = await fixture({ handle: () => { throw new Error("offline"); } });
    expect(network.vm().status).toBe("error"); expect(network.vm().issue).toBe("network"); expect(network.vm().snapshot).toBeNull();
    expect(network.requests).toHaveLength(1);
  });
  it("rejects invalid date selection before HTTP and does not invent zero counts", async () => {
    const f = await fixture({ query: { ...period, fromDate: "2030-02-30" } });
    expect(f.vm().status).toBe("invalid"); expect(f.vm().snapshot).toBeNull(); expect(f.requests).toEqual([]);
  });
  it("clears customer data on session expiry or denied access and fences retained callbacks until a new login", async () => {
    const expired = await fixture(), retained = expired.vm().refresh;
    expect(expired.vm().snapshot?.page.items[0].customer.name).toBe("Cliente");
    await act(async () => window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT)));
    expect(expired.vm().status).toBe("unauthorized"); expect(expired.vm().snapshot).toBeNull();
    expect(expired.host.textContent).not.toContain("Cliente");
    expect(await retained()).toBe(false); expect(expired.requests).toHaveLength(1);
    await expired.render(null); await expired.render(profile);
    expect(expired.vm().status).toBe("ready"); expect(expired.requests).toHaveLength(2);
    let denied = false;
    const revoked = await fixture({ handle: () => denied ? Response.json({ code: "services_mode_required" }, { status: 403 }) : Response.json(page()) });
    denied = true;
    await act(async () => { await revoked.vm().refresh(); });
    expect(revoked.vm().status).toBe("error"); expect(revoked.vm().issue).toBe("forbidden"); expect(revoked.vm().snapshot).toBeNull();
    expect(revoked.host.textContent).not.toContain("Cliente"); expect(revoked.requests).toHaveLength(2);
  });
});
