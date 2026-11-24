/** @vitest-environment jsdom */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { createDashboardApi, type MerchantProfile } from "../../../api-client.js";
import type { ServiceProfessionalDTO, ServiceProfessionalAvailabilityDTO, ServiceAvailabilityExceptionDTO } from "../../../api/endpoints/service-attendance.js";
import { ApiContext } from "../../../hooks/useApi.js";
import { useServiceAttendancePage } from "../useServiceAttendancePage.js";
import { useAvailabilityPanelData } from "./useAvailabilityPanelData.js";

const owner: MerchantProfile = { id: "merchant-a", user_id: "owner-a", name: "Local", role: "OWNER", businessMode: "services", businessModeSelectionState: "selected" };
const professional = (id = "professional-a", merchantId = owner.id): ServiceProfessionalDTO => ({ id, merchantId, publicName: id, publicProfile: {}, timeZone: "America/Sao_Paulo", isActive: true, isPublished: true, version: 7, services: [], createdAt: "2026-11-17T00:00:00Z", updatedAt: "2026-11-17T00:00:00Z" });
const exception = (id: string): ServiceAvailabilityExceptionDTO => ({ id, merchantId: owner.id, professionalId: "professional-a", kind: "block", startsAt: "2027-01-04T12:00:00.000Z", endsAt: "2027-01-04T13:00:00.000Z", timeZone: "America/Sao_Paulo", reason: null, isActive: true, actorId: owner.user_id!, version: 1, createdAt: "2026-11-17T00:00:00Z", updatedAt: "2026-11-17T00:00:00Z" });
const grade = (change: Partial<ServiceProfessionalAvailabilityDTO> = {}): ServiceProfessionalAvailabilityDTO => ({ professionalId: "professional-a", version: 7, timeZone: "America/Sao_Paulo", rows: [], exceptions: [], nextCursor: null, ...change });
interface Request { path: string; query: URLSearchParams; method: string }
const mounts: Array<{ root: Root; host: HTMLDivElement }> = [];
afterEach(async () => { for (const item of mounts.splice(0)) { await act(async () => item.root.unmount()); item.host.remove(); } window.history.replaceState(null, "", "/"); });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
async function fixture(options: { me?: MerchantProfile | null; professionals?: ServiceProfessionalDTO[]; professionalId?: string; handle?: (request: Request) => Response | Promise<Response> | undefined } = {}) {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); window.history.replaceState(null, "", "/#service-attendance?tab=availability&professionalId=" + (options.professionalId ?? "professional-a"));
  const requests: Request[] = [];
  const api = createDashboardApi({ baseUrl: "https://api.example.test", fetchImpl: (async (input, init) => {
    const url = new URL(String(input)), request = { path: url.pathname, query: url.searchParams, method: init?.method ?? "GET" }; requests.push(request);
    const handled = options.handle?.(request); if (handled !== undefined) return handled;
    if (request.method !== "GET") throw new Error("Unexpected write " + request.path);
    if (request.path.endsWith("/categories")) return Response.json([]);
    if (request.path.endsWith("/service-business-policy")) return Response.json({ status: "unconfigured", version: 0, policy: null });
    if (request.path.endsWith("/service-professionals")) return Response.json({ items: options.professionals ?? [professional("professional-a", request.path.split("/")[3])], nextCursor: null });
    if (request.path.endsWith("/availability")) return Response.json(grade());
    throw new Error("Unexpected request " + request.path);
  }) as typeof fetch });
  let value!: ReturnType<typeof useAvailabilityPanelData>, page!: ReturnType<typeof useServiceAttendancePage>;
  function Probe({ me }: { me: MerchantProfile | null }) { const vm = useServiceAttendancePage({ me }); page = vm; value = useAvailabilityPanelData(me, vm); return null; }
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host); mounts.push({ root, host });
  const render = async (me: MerchantProfile | null) => { await act(async () => root.render(<ApiContext.Provider value={api}><Probe me={me} /></ApiContext.Provider>)); };
  await render(options.me === undefined ? owner : options.me);
  const read = async (minimumVersion?: number) => { let result = false; await act(async () => { result = await value.read(minimumVersion); }); return result; };
  return { current: () => value, page: () => page, requests, render, read };
}
const gradeReads = (f: Awaited<ReturnType<typeof fixture>>) => f.requests.filter(request => request.path.endsWith("/availability"));

describe("T78 canonical grade reads", () => {
  it("consults only after the real read command and treats an empty grade as empty data", async () => {
    const f = await fixture(); expect(gradeReads(f)).toEqual([]); expect(f.current().canEdit).toBe(false);
    expect(await f.read()).toBe(true); expect(f.current().grade).toMatchObject({ status: "ready", value: { professionalId: "professional-a", version: 7, rows: [], exceptions: [] } }); expect(f.current().canEdit).toBe(true);
    expect(f.requests.every(request => request.method === "GET")).toBe(true);
  });
  it("reads all exception pages with one unchanged professional snapshot before admitting edit", async () => {
    const f = await fixture({ handle: request => request.path.endsWith("/availability") ? Response.json(grade({ exceptions: [exception(request.query.has("cursor") ? "second" : "first")], nextCursor: request.query.has("cursor") ? null : "page-2" })) : undefined });
    expect(await f.read()).toBe(true); expect(gradeReads(f).map(request => Object.fromEntries(request.query))).toEqual([{}, { cursor: "page-2" }]);
    expect(f.current().grade.value?.exceptions.map(row => row.id)).toEqual(["first", "second"]); expect(f.current().canEdit).toBe(true);
  });
  it("rejects repeated cursors instead of enabling edits with a partial grade", async () => {
    const f = await fixture({ handle: request => request.path.endsWith("/availability") ? Response.json(grade({ nextCursor: "same" })) : undefined });
    expect(await f.read()).toBe(false); expect(gradeReads(f)).toHaveLength(2); expect(f.current().grade.status).toBe("error"); expect(f.current().canEdit).toBe(false);
  });
  it("rejects a professional version changed between pages without mixing snapshots", async () => {
    const f = await fixture({ handle: request => request.path.endsWith("/availability") ? Response.json(grade({ version: request.query.has("cursor") ? 8 : 7, nextCursor: request.query.has("cursor") ? null : "page-2" })) : undefined });
    expect(await f.read()).toBe(false); expect(f.current().grade).toMatchObject({ status: "error", value: null }); expect(f.current().canEdit).toBe(false);
  });
  it("rejects a foreign exception instead of presenting it as this professional's grade", async () => {
    const f = await fixture({ handle: request => request.path.endsWith("/availability") ? Response.json(grade({ exceptions: [{ ...exception("foreign"), merchantId: "merchant-b" }] })) : undefined });
    expect(await f.read()).toBe(false); expect(f.current().grade.value).toBeNull(); expect(f.current().canEdit).toBe(false);
  });
  it("retains the previous visible snapshot on read failure while blocking edits", async () => {
    let fail = false; const f = await fixture({ handle: request => request.path.endsWith("/availability") && fail ? Response.json({ code: "unavailable" }, { status: 503 }) : undefined });
    expect(await f.read()).toBe(true); fail = true; expect(await f.read()).toBe(false);
    expect(f.current().grade.status).toBe("error"); expect(f.current().grade.value?.version).toBe(7); expect(f.current().canEdit).toBe(false);
  });
  it("allows an inactive professional's grade to be read without admitting any edit", async () => {
    const f = await fixture({ professionals: [{ ...professional(), isActive: false, isPublished: false }] });
    expect(await f.read()).toBe(true); expect(f.current().grade.status).toBe("ready"); expect(f.current().canEdit).toBe(false); expect(f.requests.every(request => request.method === "GET")).toBe(true);
  });
  it.each([{ ...owner, role: "STAFF" as const }, { ...owner, businessMode: "products" as const }, null])("denies the management context before issuing grade requests %j", async me => {
    const f = await fixture({ me }); expect(await f.read()).toBe(false); expect(f.requests).toEqual([]); expect(f.current().canEdit).toBe(false);
  });
  it("does not invent a professional for an unloaded selected id", async () => {
    const f = await fixture({ professionalId: "not-loaded" }); expect(await f.read()).toBe(false);
    expect(gradeReads(f)).toEqual([]); expect(f.current().professional).toBeNull(); expect(f.current().canEdit).toBe(false);
  });
  it("serializes two same-context reads before a render", async () => {
    const held = deferred<Response>(); const f = await fixture({ handle: request => request.path.endsWith("/availability") ? held.promise : undefined });
    let first!: Promise<boolean>, second!: Promise<boolean>; await act(async () => { first = f.current().read(); second = f.current().read(); });
    expect(gradeReads(f)).toHaveLength(1); await act(async () => { held.resolve(Response.json(grade())); await first; expect(await second).toBe(false); }); expect(f.current().grade.status).toBe("ready");
  });
  it("drops an old user's response and does not continue its next page", async () => {
    const held = deferred<Response>(); const f = await fixture({ handle: request => request.path.endsWith("/availability") ? held.promise : undefined });
    let reading!: Promise<boolean>; await act(async () => { reading = f.current().read(); }); await f.render({ ...owner, user_id: "new-owner-session" });
    await act(async () => { held.resolve(Response.json(grade({ nextCursor: "old-next" }))); expect(await reading).toBe(false); });
    expect(gradeReads(f)).toHaveLength(1); expect(f.current().grade.value).toBeNull(); expect(f.current().canEdit).toBe(false);
  });
  it("does not confirm a post-save read older than the acknowledged mutation version", async () => {
    const f = await fixture(); expect(await f.read(8)).toBe(false); expect(f.current().grade.status).toBe("error"); expect(f.current().canEdit).toBe(false);
  });

});

describe("T78 explicit grade reconciliation fence", () => {
  const input = { expectedVersion: 7, timeZone: "America/Sao_Paulo", rows: [] };
  it("keeps the conflict until canonical metadata and the actual grade have both reloaded", async () => {
    const held = deferred<Response>(); const f = await fixture({ handle: request => request.method !== "GET" ? Response.json({ code: "service_professional_stale", detail: "service_professional_stale" }, { status: 409 }) : request.path.endsWith("/availability") ? held.promise : undefined });
    await act(async () => { await f.page().actions.saveProfessionalAvailability("professional-a", input); });
    let reconcile!: Promise<boolean>; await act(async () => { reconcile = f.page().reconcileAvailability(f.current().read); });
    expect(f.page().command.status).toBe("conflict"); expect(f.current().canEdit).toBe(false);
    await act(async () => { held.resolve(Response.json(grade({ version: 8 }))); expect(await reconcile).toBe(true); });
    expect(f.page().command.status).toBe("idle"); expect(f.current().grade.value?.version).toBe(8); expect(f.current().canEdit).toBe(true);
  });
  it("does not clear the issue when the grade read fails after metadata succeeds", async () => {
    const f = await fixture({ handle: request => request.method !== "GET" ? Response.json({}, { status: 409 }) : request.path.endsWith("/availability") ? Response.json({}, { status: 503 }) : undefined });
    await act(async () => { await f.page().actions.saveProfessionalAvailability("professional-a", input); });
    await act(async () => { expect(await f.page().reconcileAvailability(f.current().read)).toBe(false); });
    expect(f.current().grade.status).toBe("error"); expect(f.page().command.status).toBe("conflict");
    await act(async () => { await f.page().actions.saveProfessionalAvailability("professional-a", input); });
    expect(f.requests.filter(request => request.method !== "GET")).toHaveLength(1); expect(f.current().canEdit).toBe(false);
  });
  it("does not release an issue created after the reconciliation being completed", async () => {
    const held = deferred<boolean>(); const f = await fixture({ handle: request => request.method !== "GET" ? Response.json({}, { status: 409 }) : undefined });
    await act(async () => { await f.page().actions.saveProfessionalAvailability("professional-a", input); });
    let old!: Promise<boolean>; await act(async () => { old = f.page().reconcileAvailability(() => held.promise); });
    await act(async () => { await f.page().refresh(); await f.page().actions.updatePolicy({ expectedVersion: 1, holdEnabled: false, holdMinutes: null, paymentMode: "at_attendance", admissionsEnabled: true }); });
    await act(async () => { held.resolve(true); expect(await old).toBe(false); });
    expect(f.page().command.status).toBe("conflict"); await act(async () => { await f.page().actions.saveProfessionalAvailability("professional-a", input); });
    expect(f.requests.filter(request => request.method !== "GET")).toHaveLength(2);
  });
  it("drops old reconciliation after the authenticated tenant changes", async () => {
    const held = deferred<boolean>(); const f = await fixture({ handle: request => request.method !== "GET" ? Response.json({}, { status: 409 }) : undefined });
    await act(async () => { await f.page().actions.saveProfessionalAvailability("professional-a", input); });
    let old!: Promise<boolean>; await act(async () => { old = f.page().reconcileAvailability(() => held.promise); });
    await f.render({ ...owner, id: "merchant-b", user_id: "owner-b" }); await act(async () => { held.resolve(true); expect(await old).toBe(false); });
    expect(f.page().loadState.data?.professionals.items[0].merchantId).not.toBe("merchant-a"); expect(f.current().grade.value).toBeNull(); expect(f.page().command.status).toBe("idle");
  });
});
