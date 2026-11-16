/** @vitest-environment jsdom */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { createDashboardApi, type MerchantProfile } from "../../api-client.js";
import { ApiContext } from "../../hooks/useApi.js";
import { parseServiceAttendanceFilters, useServiceAttendancePage } from "./useServiceAttendancePage.js";

type VM = ReturnType<typeof useServiceAttendancePage>;
type Request = { path: string; method: string; body: Record<string, unknown> | undefined };
const me: MerchantProfile = { id: "merchant-a", user_id: "operator-a", name: "A", role: "OWNER", businessMode: "services", businessModeSelectionState: "selected" };
const professional = { id: "professional-a", merchantId: me.id, publicName: "Ana", publicProfile: {}, timeZone: "America/Sao_Paulo", isActive: true, isPublished: true, version: 7, createdAt: "2026-11-16T12:00:00.000Z", updatedAt: "2026-11-16T12:00:00.000Z", services: [{ id: "link-a", productId: "service-a", version: 2 }] };
const policy = { status: "configured", version: 2, policy: { holdEnabled: false, holdMinutes: null, paymentMode: "at_attendance", admissionsEnabled: true } };
const mounts: Array<{ root: Root; host: HTMLDivElement }> = [];
afterEach(async () => {
  for (const { root, host } of mounts.splice(0)) { await act(async () => root.unmount()); host.remove(); }
  window.history.replaceState(null, "", "/#service-attendance");
});
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
async function fixture(options: { me?: MerchantProfile | null; handle?: (request: Request) => Response | Promise<Response> | undefined; hash?: string } = {}) {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  window.history.replaceState(null, "", "/" + (options.hash ?? "#service-attendance"));
  const requests: Request[] = [];
  let vm!: VM;
  const api = createDashboardApi({ baseUrl: "https://api.example.test", fetchImpl: (async (input, init) => {
    const request = { path: new URL(String(input)).pathname, method: init?.method ?? "GET", body: init?.body == null ? undefined : JSON.parse(String(init.body)) };
    requests.push(request);
    const response = options.handle?.(request);
    if (response !== undefined) return response;
    if (request.path.endsWith("/service-professionals")) {
      const merchantId = request.path.split("/")[3];
      return Response.json({ items: [{ ...professional, merchantId, publicName: merchantId === me.id ? "Ana" : "New account" }], nextCursor: null });
    }
    if (request.path.endsWith("/categories")) return Response.json([]);
    if (request.path.endsWith("/service-business-policy")) return Response.json(policy);
    throw new Error("Unexpected request: " + request.path);
  }) as typeof fetch });
  function Probe({ current }: { current: MerchantProfile | null }) {
    vm = useServiceAttendancePage({ me: current });
    return React.createElement("output", null, JSON.stringify({ status: vm.loadState.status, data: vm.loadState.data, command: vm.command.status, availability: vm.availability.status }));
  }
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host); mounts.push({ root, host });
  const render = async (current: MerchantProfile | null) => { await act(async () => root.render(React.createElement(ApiContext.Provider, { value: api }, React.createElement(Probe, { current })))); };
  await render(options.me === undefined ? me : options.me);
  return { vm: () => vm, requests, host, render, unmount: async () => { await act(async () => root.unmount()); mounts.splice(mounts.findIndex(item => item.root === root), 1); host.remove(); } };
}

describe("T74", () => {
  it("loads only the current management contracts and retains exact server versions and links", async () => {
    const f = await fixture();
    expect(f.vm().allowed).toBe(true);
    expect(f.vm().loadState).toMatchObject({ status: "ready", data: { professionals: { items: [professional], nextCursor: null }, categories: [], policy } });
    expect(f.requests.map(r => [r.method, r.path])).toEqual([
      ["GET", "/v1/merchants/merchant-a/service-professionals"], ["GET", "/v1/merchants/merchant-a/categories"], ["GET", "/v1/merchants/me/service-business-policy"],
    ]);
    expect(f.host.textContent).not.toMatch(/appointment|confirmed|paid/);
  });

  it.each([
    null,
    { ...me, role: "STAFF" as const },
    { ...me, businessMode: "products" as const },
    { ...me, businessModeSelectionState: "review_required" as const },
    { ...me, user_id: "" },
  ])("denies management context %j without any configuration request", async current => {
    const f = await fixture({ me: current });
    expect(f.vm().allowed).toBe(false);
    expect(f.vm().loadState).toMatchObject({ status: "forbidden", data: null });
    expect(f.requests).toEqual([]);
    let result: unknown;
    await act(async () => { result = await f.vm().actions.updatePolicy({ expectedVersion: 2, holdEnabled: false, holdMinutes: null, paymentMode: "at_attendance", admissionsEnabled: false }); });
    expect(result).toEqual({ status: "forbidden" });
    expect(f.requests).toEqual([]);
  });

  it("distinguishes a real empty collection from a failed read", async () => {
    const empty = await fixture({ handle: r => r.path.endsWith("/service-professionals") ? Response.json({ items: [], nextCursor: null }) : undefined });
    expect(empty.vm().loadState).toMatchObject({ status: "empty", data: { professionals: { items: [] }, categories: [] } });
    const denied = await fixture({ handle: r => r.path.endsWith("/service-professionals") ? Response.json({ message: "services_mode_required" }, { status: 403 }) : undefined });
    expect(denied.vm().loadState).toMatchObject({ status: "error", data: null, errorKind: "forbidden" });
  });

  it("parses only supported URL filters with a canonical date window", () => {
    expect(parseServiceAttendanceFilters("#service-attendance?tab=availability&professionalId=professional%2Fa&categoryId=category-a&fromDate=2026-11-23&toDate=2026-11-24"))
      .toEqual({ tab: "availability", professionalId: "professional/a", categoryId: "category-a", fromDate: "2026-11-23", toDate: "2026-11-24" });
    expect(parseServiceAttendanceFilters("#service-attendance?tab=unknown&fromDate=2026-02-30&toDate=2026-03-01"))
      .toEqual({ tab: "agenda", professionalId: "", categoryId: "", fromDate: "", toDate: "" });
  });

  it("writes selectors to the existing hash query, preserves unrelated values and handles back/refresh", async () => {
    const f = await fixture({ hash: "#service-attendance?source=menu&tab=professionals" });
    await act(async () => f.vm().setFilters({ tab: "availability", professionalId: "professional/a", categoryId: "category-a", fromDate: "2026-11-23", toDate: "2026-11-24" }));
    const query = new URLSearchParams(window.location.hash.split("?")[1]);
    expect(Object.fromEntries(query)).toEqual({ source: "menu", tab: "availability", professionalId: "professional/a", categoryId: "category-a", fromDate: "2026-11-23", toDate: "2026-11-24" });
    await act(async () => { window.history.replaceState(null, "", "/#service-attendance?tab=categories&categoryId=old-category"); window.dispatchEvent(new HashChangeEvent("hashchange")); });
    expect(f.vm().filters).toEqual({ tab: "categories", professionalId: "", categoryId: "old-category", fromDate: "", toDate: "" });
    const refreshed = await fixture({ hash: window.location.hash });
    expect(refreshed.vm().filters).toEqual(f.vm().filters);
  });

  it("preserves the last real snapshot and exposes a failed refresh without showing fabricated emptiness", async () => {
    let fail = false;
    const f = await fixture({ handle: r => fail && r.path.endsWith("/service-professionals") ? Response.json({ message: "unavailable" }, { status: 503 }) : undefined });
    fail = true;
    await act(async () => f.vm().refresh());
    expect(f.vm().loadState).toMatchObject({ status: "error", errorKind: "server", data: { professionals: { items: [professional] } } });
  });

  it("discards an older refresh after the later read has completed", async () => {
    const old = deferred<Response>(); let number = 0;
    const f = await fixture({ handle: r => {
      if (!r.path.endsWith("/service-professionals")) return;
      number++;
      if (number === 2) return old.promise;
      return Response.json({ items: [{ ...professional, publicName: number === 3 ? "Latest" : "Initial" }], nextCursor: null });
    } });
    let pending!: Promise<void>;
    await act(async () => { pending = f.vm().refresh(); });
    await act(async () => f.vm().refresh());
    await act(async () => { old.resolve(Response.json({ items: [{ ...professional, publicName: "Old" }], nextCursor: null })); await pending; });
    expect(f.vm().loadState).toMatchObject({ status: "ready", data: { professionals: { items: [{ publicName: "Latest" }] } } });
  });

  it("masks old account data immediately and never publishes its deferred response into the new context", async () => {
    const old = deferred<Response>();
    const f = await fixture({ handle: r => r.path.includes("merchant-a/service-professionals") ? old.promise : undefined });
    expect(f.vm().loadState).toMatchObject({ status: "loading", data: null });
    await f.render({ ...me, id: "merchant-b", user_id: "operator-b" });
    expect(f.vm().loadState).toMatchObject({ status: "ready", data: { professionals: { items: [{ merchantId: "merchant-b", publicName: "New account" }] } } });
    await act(async () => old.resolve(Response.json({ items: [{ ...professional, publicName: "Private old account" }], nextCursor: null })));
    expect(f.host.textContent).not.toContain("Private old account");
    expect(f.requests.some(r => r.path === "/v1/merchants/merchant-b/service-professionals")).toBe(true);
  });

  it("refuses a retained old-context policy callback rather than writing the newly selected /me tenant", async () => {
    const f = await fixture();
    const oldUpdate = f.vm().actions.updatePolicy;
    await f.render({ ...me, id: "merchant-b", user_id: "operator-b" });
    let result: unknown;
    await act(async () => { result = await oldUpdate({ expectedVersion: 2, holdEnabled: false, holdMinutes: null, paymentMode: "at_attendance", admissionsEnabled: false }); });
    expect(result).toEqual({ status: "stale" });
    expect(f.requests.filter(r => r.method !== "GET")).toEqual([]);
  });

  it("serializes actual commands before the next render and publishes no optimistic professional change", async () => {
    const saved = deferred<Response>();
    let currentProfessional = professional;
    const f = await fixture({ handle: r => r.method === "PATCH" ? saved.promise : r.path.endsWith("/service-professionals") ? Response.json({ items: [currentProfessional], nextCursor: null }) : undefined });
    let first!: Promise<unknown>, second!: Promise<unknown>;
    await act(async () => {
      first = f.vm().actions.updateProfessional(professional.id, { expectedVersion: 7, publicName: "Changed" });
      second = f.vm().actions.deactivateProfessional(professional.id, 7);
    });
    expect(await second).toEqual({ status: "busy" });
    expect(f.vm().command.status).toBe("saving");
    expect(f.vm().loadState.data?.professionals.items[0].publicName).toBe("Ana");
    expect(f.requests.filter(r => r.method !== "GET")).toEqual([{ method: "PATCH", path: "/v1/merchants/merchant-a/service-professionals/professional-a", body: { expectedVersion: 7, publicName: "Changed" } }]);
    await act(async () => { currentProfessional = { ...professional, version: 8, publicName: "Changed" }; saved.resolve(Response.json(currentProfessional)); await first; });
    expect(await first).toMatchObject({ status: "success", value: { id: professional.id, version: 8, publicName: "Changed" } });
    expect(f.vm().command.status).toBe("success");
    expect(f.vm().loadState.data?.professionals.items).toEqual([currentProfessional]);
  });

  it.each([[409, "conflict"], [403, "forbidden"], [500, "server"]] as const)("keeps the previous snapshot on command HTTP%i and performs no automatic resend", async (status, kind) => {
    const f = await fixture({ handle: r => r.method !== "GET" ? Response.json({ message: "actual_code" }, { status }) : undefined });
    let result: unknown;
    await act(async () => { result = await f.vm().actions.updateProfessional(professional.id, { expectedVersion: 7, publicName: "Changed" }); });
    expect(result).toMatchObject({ status: "error", kind });
    expect(f.vm().command).toMatchObject({ status: status === 409 ? "conflict" : "error", errorKind: kind });
    expect(f.vm().loadState.data?.professionals.items).toEqual([professional]);
    expect(f.requests.filter(r => r.method !== "GET")).toHaveLength(1);
  });

  it("reports an uncertain network result without changing local records or resending the mutation", async () => {
    const f = await fixture({ handle: r => { if (r.method !== "GET") throw new Error("network unavailable"); } });
    await act(async () => { await f.vm().actions.deactivateProfessional(professional.id, 7); });
    expect(f.vm().command).toMatchObject({ status: "uncertain", errorKind: "network" });
    expect(f.vm().loadState.data?.professionals.items[0].isActive).toBe(true);
    expect(f.requests.filter(r => r.method !== "GET")).toHaveLength(1);
  });

  it("requires a successful explicit refresh before another command after a conflict", async () => {
    let version = 7, writes = 0;
    const f = await fixture({ handle: r => {
      if (r.method !== "GET") {
        writes++;
        if (writes === 1) { version = 8; return Response.json({ message: "service_professional_stale" }, { status: 409 }); }
        return Response.json({ ...professional, version: 9, publicName: "Reconfirmed" });
      }
      if (r.path.endsWith("/service-professionals")) return Response.json({ items: [{ ...professional, version }], nextCursor: null });
    } });
    await act(async () => { await f.vm().actions.updateProfessional(professional.id, { expectedVersion: 7, publicName: "Old" }); });
    await act(async () => { await f.vm().actions.updateProfessional(professional.id, { expectedVersion: 7, publicName: "Old" }); });
    expect(writes).toBe(1);
    expect(f.vm().command.status).toBe("conflict");
    await act(async () => f.vm().refresh());
    expect(f.vm().loadState.data?.professionals.items[0].version).toBe(8);
    let result: unknown;
    await act(async () => { result = await f.vm().actions.updateProfessional(professional.id, { expectedVersion: 8, publicName: "Reconfirmed" }); });
    expect(writes).toBe(2);
    expect(result).toMatchObject({ status: "success", value: { version: 9, publicName: "Reconfirmed" } });
  });

  it("preserves malformed successful mutation JSON as an uncertain outcome", async () => {
    const f = await fixture({ handle: r => r.method !== "GET" ? new Response("broken-json") : undefined });
    await act(async () => { await f.vm().actions.deactivateProfessional(professional.id, 7); });
    expect(f.vm().command).toMatchObject({ status: "uncertain", errorKind: "invalid_response" });
    expect(f.vm().loadState.data?.professionals.items).toEqual([professional]);
    expect(f.requests.filter(r => r.method !== "GET")).toHaveLength(1);
  });

  it("keeps successful mutation and failed post-save reload as separate facts", async () => {
    let saved = false;
    const f = await fixture({ handle: r => {
      if (r.method !== "GET") { saved = true; return Response.json({ ...professional, version: 8 }); }
      if (saved && r.path.endsWith("/service-professionals")) return Response.json({}, { status: 503 });
    } });
    let result: unknown;
    await act(async () => { result = await f.vm().actions.updateProfessional(professional.id, { expectedVersion: 7, publicName: "Changed" }); });
    expect(result).toMatchObject({ status: "success", value: { version: 8 } });
    expect(f.vm().command.status).toBe("success");
    expect(f.vm().loadState).toMatchObject({ status: "error", errorKind: "server", data: { professionals: { items: [professional] } } });
  });

  it("invalidates old availability when selectors change and retains actual stale/empty server statuses", async () => {
    const pending = deferred<Response>(); let count = 0;
    const response = { status: "stale", professionalVersion: 8, policyVersion: 2, timeZone: "America/Sao_Paulo", durationMinutes: 55, asOf: "2026-11-16T12:00:00.000Z", dates: [] };
    const f = await fixture({ handle: r => r.path.endsWith("/service-availability/dates") ? (++count === 1 ? pending.promise : Response.json(response)) : undefined });
    await act(async () => f.vm().setFilters({ professionalId: professional.id, fromDate: "2026-11-23", toDate: "2026-11-24" }));
    let first!: Promise<unknown>;
    await act(async () => { first = f.vm().loadAvailableDates({ productId: "service-a", variantId: "variant-a" }); });
    await act(async () => f.vm().setFilters({ professionalId: "professional-b" }));
    expect(f.vm().availability.status).toBe("idle");
    await act(async () => { pending.resolve(Response.json({ ...response, status: "ready", dates: ["2026-11-23"] })); await first; });
    expect(f.vm().availability.status).toBe("idle");
    await act(async () => { await f.vm().loadAvailableDates({ productId: "service-a", variantId: "variant-a" }); });
    expect(f.vm().availability).toMatchObject({ status: "stale", data: response });
  });

  it("ignores a pending command response after management access is revoked or the hook unmounts", async () => {
    const pending = deferred<Response>();
    const f = await fixture({ handle: r => r.method !== "GET" ? pending.promise : undefined });
    let command!: Promise<unknown>;
    await act(async () => { command = f.vm().actions.deactivateProfessional(professional.id, 7); });
    await f.render({ ...me, role: "STAFF" });
    expect(f.vm().loadState).toMatchObject({ status: "forbidden", data: null });
    await f.unmount();
    await act(async () => { pending.resolve(Response.json({ ...professional, isActive: false, version: 8 })); await command; });
    expect(await command).toEqual({ status: "stale" });
    expect(f.requests.filter(r => r.method === "GET")).toHaveLength(3);
  });
});
