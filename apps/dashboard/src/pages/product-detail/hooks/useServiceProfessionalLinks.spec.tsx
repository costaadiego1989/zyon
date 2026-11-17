/** @vitest-environment jsdom */
// UNEXECUTED cache candidate; copy into productive paths only after T105 gate/commit.
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiContext, type DashboardApi } from "../../../hooks/useApi.js";
import { DashboardHttpError } from "../../../api/http/error.js";
import type { MerchantProfile } from "../../../api-client.js";
import type { ServiceProfessionalDTO as ServiceProfessional, ServiceProfessionalPage } from "../../../api/endpoints/service-attendance.js";
import { useServiceProfessionalLinks, type ServiceProfessionalLinksOptions } from "./useServiceProfessionalLinks.js";

const mounts: Array<{ root: Root; host: HTMLDivElement }> = [];
afterEach(async () => { for (const { root, host } of mounts.splice(0)) { await act(async () => root.unmount()); host.remove(); } });
const me: MerchantProfile = { id: "merchant-a", user_id: "owner-a", name: "Empresa local", role: "OWNER", businessMode: "services", businessModeSelectionState: "selected" };
const options: ServiceProfessionalLinksOptions = { me, productId: "target-service", businessMode: "services", productType: "service", blocked: false };
const professional = (id: string, productIds: string[] = [], version = 1, extra: Partial<ServiceProfessional> = {}): ServiceProfessional => ({
  id, merchantId: "merchant-a", publicName: id, publicProfile: {}, createdAt: "2026-11-17T00:00:00Z", updatedAt: "2026-11-17T00:00:00Z", timeZone: "America/Sao_Paulo", isActive: true, isPublished: false, version,
  services: productIds.map((productId, index) => ({ id: id + "-link-" + index, productId, version: 1 })), ...extra,
});
const page = (items: ServiceProfessional[], nextCursor: string | null = null): ServiceProfessionalPage => ({ items, nextCursor });
function deferred<T>() { let resolve!: (value: T) => void, reject!: (reason: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }

async function fixture(records: ServiceProfessional[] = [], current: ServiceProfessionalLinksOptions = options, initialRead?: Promise<ServiceProfessionalPage>) {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const api = {
    listProfessionals: vi.fn().mockResolvedValue(page(records)),
    updateProfessional: vi.fn().mockImplementation(async (id: string, payload: { productIds: string[]; expectedVersion: number }) => professional(id, payload.productIds, payload.expectedVersion + 1)),
  };
  if (initialRead) api.listProfessionals.mockImplementationOnce(() => initialRead);
  const binding = vi.fn().mockReturnValue(api);
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host); mounts.push({ root, host });
  let vm!: ReturnType<typeof useServiceProfessionalLinks>;
  function Probe({ value }: { value: ServiceProfessionalLinksOptions }) { vm = useServiceProfessionalLinks(value); return null; }
  const render = async (value: ServiceProfessionalLinksOptions) => { await act(async () => root.render(<ApiContext.Provider value={{ serviceAttendance: binding } as unknown as DashboardApi}><Probe value={value} /></ApiContext.Provider>)); };
  await render(current);
  return { api, binding, render, vm: () => vm };
}
async function select(f: Awaited<ReturnType<typeof fixture>>, id: string, selected: boolean) { await act(async () => f.vm().select(id, selected)); }
async function save(f: Awaited<ReturnType<typeof fixture>>) { await act(async () => f.vm().save()); }

describe("saved-service professional links", () => {
  it("loads page2 and links its professional with the current full other-service set and version", async () => {
    const initial = deferred<ServiceProfessionalPage>(), f = await fixture([], options, initial.promise);
    f.api.listProfessionals.mockResolvedValueOnce(page([professional("second", ["other-service"], 8)]));
    await act(async () => initial.resolve(page([professional("first")], "cursor-2")));
    expect(f.binding).toHaveBeenCalledExactlyOnceWith(me);
    expect(f.api.listProfessionals.mock.calls).toEqual([[{ limit: 25 }], [{ limit: 25, cursor: "cursor-2" }]]);
    expect(f.vm().rows.map(row => row.professional.id)).toEqual(["first", "second"]);
    await select(f, "second", true); await save(f);
    expect(f.api.updateProfessional).toHaveBeenCalledExactlyOnceWith("second", { expectedVersion: 8, productIds: ["other-service", "target-service"] });
    expect(f.vm().rows[1]).toMatchObject({ status: "saved", selected: true, professional: { version: 9 } });
  });

  it("unlinks only the target while preserving unrelated links and requires no second mutation", async () => {
    const f = await fixture([professional("p", ["first-other", "target-service", "second-other"], 4)]);
    await select(f, "p", false); await save(f); await save(f);
    expect(f.api.updateProfessional).toHaveBeenCalledExactlyOnceWith("p", { expectedVersion: 4, productIds: ["first-other", "second-other"] });
    expect(f.vm().dirty).toBe(false);
  });

  it("allows the existing ADMIN role to link", async () => {
    const f = await fixture([professional("p")], { ...options, me: { ...me, role: "ADMIN" } });
    await select(f, "p", true); await save(f); expect(f.api.updateProfessional).toHaveBeenCalledTimes(1);
  });

  it.each([
    { user_id: "" }, { businessMode: "products" }, { businessModeSelectionState: "legacy" },
    { businessModeSelectionState: "review_required" }, { businessModeSelectionState: undefined },
  ] satisfies Partial<MerchantProfile>[])("denies incomplete or unresolved authenticated identity before binding the SDK: %j", async change => {
    const f = await fixture([professional("p")], { ...options, me: { ...me, ...change } });
    await select(f, "p", true); await save(f);
    expect(f.binding).not.toHaveBeenCalled(); expect(f.api.listProfessionals).not.toHaveBeenCalled();
    expect(f.api.updateProfessional).not.toHaveBeenCalled(); expect(f.vm().rows).toEqual([]); expect(f.vm().canSave).toBe(false);
  });

  it("uses the new authenticated user and discards the old user's next-page continuation", async () => {
    const held = deferred<ServiceProfessionalPage>(), f = await fixture([], options, held.promise);
    const nextMe = { ...me, user_id: "other-owner-session" };
    f.api.listProfessionals.mockResolvedValueOnce(page([professional("current")]));
    await f.render({ ...options, me: nextMe });
    await act(async () => held.resolve(page([professional("old")], "old-next")));
    expect(f.binding.mock.calls).toEqual([[me], [nextMe]]);
    expect(f.api.listProfessionals.mock.calls).toEqual([[{ limit: 25 }], [{ limit: 25 }]]);
    expect(f.vm().rows.map(row => row.professional.id)).toEqual(["current"]);
    expect(f.api.updateProfessional).not.toHaveBeenCalled();
  });

  it("keeps one CAS write when Save is invoked twice before a render", async () => {
    const f = await fixture([professional("p", ["other"], 4)]), held = deferred<ServiceProfessional>();
    await select(f, "p", true); f.api.updateProfessional.mockImplementationOnce(() => held.promise);
    let first!: Promise<void>, second!: Promise<void>;
    await act(async () => { first = f.vm().save(); second = f.vm().save(); });
    expect(f.api.updateProfessional).toHaveBeenCalledExactlyOnceWith("p", { expectedVersion: 4, productIds: ["other", "target-service"] });
    await act(async () => { held.resolve(professional("p", ["other", "target-service"], 5)); await Promise.all([first, second]); });
    expect(f.vm().rows[0]).toMatchObject({ selected: true, status: "saved", professional: { version: 5 } });
    expect(f.vm().saving).toBe(false); expect(f.vm().dirty).toBe(false);
  });

  it.each([
    { productId: null }, { me: null }, { businessMode: "products" }, { businessMode: null },
    { productType: "physical" }, { me: { ...me, role: "STAFF" } }, { me: { ...me, role: undefined } }, { blocked: true },
  ] satisfies Partial<ServiceProfessionalLinksOptions>[])("does not request or write outside the admitted saved-service context: %j", async change => {
    const f = await fixture([professional("p")], { ...options, ...change });
    await select(f, "p", true); await save(f);
    expect(f.binding).not.toHaveBeenCalled(); expect(f.api.listProfessionals).not.toHaveBeenCalled(); expect(f.api.updateProfessional).not.toHaveBeenCalled(); expect(f.vm().canSave).toBe(false);
  });

  it.each([{ me: { ...me, id: "merchant-b" } }, { productId: "new-service" }, { businessMode: "products" }, { me: { ...me, role: "STAFF" } }, { blocked: true }] satisfies Partial<ServiceProfessionalLinksOptions>[])("ignores an old paginated response after context changes: %j", async change => {
    const held = deferred<ServiceProfessionalPage>(), f = await fixture([], options, held.promise);
    f.api.listProfessionals.mockResolvedValue(page([])); await f.render({ ...options, ...change });
    const requests = f.api.listProfessionals.mock.calls.length;
    await act(async () => held.resolve(page([professional("old")], "old-next")));
    expect(f.vm().rows).toEqual([]); expect(f.api.listProfessionals).toHaveBeenCalledTimes(requests); expect(f.api.updateProfessional).not.toHaveBeenCalled();
  });

  it("does not recover an old failed PATCH or continue its next row after permission loss", async () => {
    const f = await fixture([professional("first"), professional("second")]), held = deferred<ServiceProfessional>();
    f.api.updateProfessional.mockImplementationOnce(() => held.promise);
    await select(f, "first", true); await select(f, "second", true); let pending!: Promise<void>;
    await act(async () => { pending = f.vm().save(); }); await f.render({ ...options, me: { ...me, role: "STAFF" } });
    await act(async () => { held.reject(new DashboardHttpError(500, "synthetic")); await pending; });
    expect(f.api.updateProfessional).toHaveBeenCalledTimes(1); expect(f.api.listProfessionals).toHaveBeenCalledTimes(1); expect(f.vm().rows).toEqual([]);
  });

  it("409 requires explicit reload and reconfirmation using only actual pending intent", async () => {
    const f = await fixture([professional("pending", ["removed-concurrently", "retained"], 2), professional("untouched", ["target-service"], 5)]);
    await select(f, "pending", true); f.api.updateProfessional.mockRejectedValueOnce(new DashboardHttpError(409, "service_professional_stale"));
    await save(f); expect(f.vm().needsReload).toBe(true); expect(f.vm().canSave).toBe(false); await save(f); expect(f.api.updateProfessional).toHaveBeenCalledTimes(1);
    f.api.listProfessionals.mockResolvedValueOnce(page([professional("pending", ["retained", "added-concurrently"], 3), professional("untouched", [], 6)]));
    await act(async () => f.vm().reload());
    expect(f.vm().rows.map(row => [row.professional.id, row.selected])).toEqual([["pending", true], ["untouched", false]]);
    expect(f.api.updateProfessional).toHaveBeenCalledTimes(1); await save(f);
    expect(f.api.updateProfessional).toHaveBeenLastCalledWith("pending", { expectedVersion: 3, productIds: ["retained", "added-concurrently", "target-service"] });
    expect(f.api.updateProfessional).toHaveBeenCalledTimes(2);
  });

  it.each([0, 500])("reconciles an unknown result%s with read-only authoritative data, without a duplicate PATCH", async status => {
    const f = await fixture([professional("p", ["other"], 2)]); await select(f, "p", true);
    f.api.updateProfessional.mockRejectedValueOnce(new DashboardHttpError(status, "unknown-result"));
    f.api.listProfessionals.mockResolvedValueOnce(page([professional("p", ["other", "target-service", "concurrent-other"], 3)]));
    await save(f); await save(f);
    expect(f.api.updateProfessional).toHaveBeenCalledTimes(1); expect(f.api.listProfessionals).toHaveBeenCalledTimes(2);
    expect(f.vm().rows[0]).toMatchObject({ selected: true, status: "saved", professional: { version: 3 } }); expect(f.vm().needsReload).toBe(false);
  });

  it("blocks an unconfirmed transport result until an explicit reload", async () => {
    const f = await fixture([professional("p")]); await select(f, "p", true);
    f.api.updateProfessional.mockRejectedValueOnce(new DashboardHttpError(0, "unknown-result")); await save(f); await save(f);
    expect(f.vm().needsReload).toBe(true); expect(f.vm().rows[0].status).toBe("failed"); expect(f.api.updateProfessional).toHaveBeenCalledTimes(1);
  });

  it("keeps an already persisted row, stops at the first failure and leaves the rest unprocessed", async () => {
    const f = await fixture([professional("first"), professional("second"), professional("third")]);
    for (const id of ["first", "second", "third"]) await select(f, id, true);
    f.api.updateProfessional.mockResolvedValueOnce(professional("first", ["target-service"], 2)).mockRejectedValueOnce(new DashboardHttpError(409, "stale"));
    await save(f);
    expect(f.api.updateProfessional.mock.calls.map(call => call[0])).toEqual(["first", "second"]);
    expect(f.vm().rows.map(row => row.status)).toEqual(["saved", "failed", "pending"]); expect(f.vm().rows[0].professional.services.map(link => link.productId)).toEqual(["target-service"]);
  });

  it("does not modify inactive professionals or truncate a full100-service base", async () => {
    const ids = Array.from({ length: 100 }, (_, index) => "existing-" + index), f = await fixture([professional("inactive", [], 1, { isActive: false }), professional("full", ids, 9)]);
    await select(f, "inactive", true); expect(f.vm().rows[0].selected).toBe(false); await select(f, "full", true); await save(f);
    expect(f.api.updateProfessional).not.toHaveBeenCalled(); expect(f.vm().rows[1].status).toBe("failed"); expect(f.vm().rows[1].professional.services).toHaveLength(100);
  });

  it.each([{ version: 0 }, { version: undefined }, { merchantId: "foreign" }, { services: [{ id: "x", productId: "same", version: 1 }, { id: "y", productId: "same", version: 1 }] }])("fails closed on incomplete or foreign authoritative data: %j", async invalid => {
    const f = await fixture([professional("p", [], 1, invalid as Partial<ServiceProfessional>)]);
    expect(f.vm().needsReload).toBe(true); expect(f.vm().canSave).toBe(false); await select(f, "p", true); await save(f); expect(f.api.updateProfessional).not.toHaveBeenCalled();
  });

  it("stops repeated cursors instead of silently presenting a partial professional list", async () => {
    const held = deferred<ServiceProfessionalPage>(), f = await fixture([], options, held.promise);
    f.api.listProfessionals.mockResolvedValueOnce(page([professional("second")], "same-cursor"));
    await act(async () => held.resolve(page([professional("first")], "same-cursor")));
    expect(f.api.listProfessionals).toHaveBeenCalledTimes(2); expect(f.vm().needsReload).toBe(true); expect(f.vm().rows).toEqual([]); expect(f.vm().canSave).toBe(false);
  });

  it("uses the newer complete set for a professional repeated across pages", async () => {
    const held = deferred<ServiceProfessionalPage>(), f = await fixture([], options, held.promise);
    f.api.listProfessionals.mockResolvedValueOnce(page([professional("p", ["new-other"], 4)]));
    await act(async () => held.resolve(page([professional("p", ["old-other"], 3)], "next")));
    await select(f, "p", true); await save(f);
    expect(f.api.updateProfessional).toHaveBeenCalledExactlyOnceWith("p", { expectedVersion: 4, productIds: ["new-other", "target-service"] });
  });
});
