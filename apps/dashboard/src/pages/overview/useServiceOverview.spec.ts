/** @vitest-environment jsdom */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it } from "vitest";
import type { ServiceMetricsResponse } from "@zyon/shared-types";
import { createDashboardApi, SESSION_EXPIRED_EVENT, type MerchantProfile } from "../../api-client.js";
import { ApiContext } from "../../hooks/useApi.js";
import type { ServiceMetricsQuery } from "../../api/endpoints/service-metrics.js";
import { useServiceOverview } from "./useServiceOverview.js";

type VM = ReturnType<typeof useServiceOverview>;
type ReadRequest = { url: URL; signal?: AbortSignal | null };
const me: MerchantProfile = { id: "merchant-a", user_id: "operator-a", name: "A", role: "OWNER", businessMode: "services", businessModeSelectionState: "selected" };
const query: ServiceMetricsQuery = { fromDate: "2026-11-19", toDate: "2026-11-19" };
const roots: Array<{ root: Root; host: HTMLDivElement }> = [];
afterEach(async () => { for (const { root, host } of roots.splice(0)) { await act(async () => root.unmount()); host.remove(); } });
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: unknown) => void;
  const promise = new Promise<T>((done, failed) => { resolve = done; reject = failed; });
  return { promise, resolve, reject };
}
function dto(request: ReadRequest, status: ServiceMetricsResponse["dataStatus"] = "complete", known = 9000): ServiceMetricsResponse {
  const fromDate = request.url.searchParams.get("fromDate")!, toDate = request.url.searchParams.get("toDate")!;
  const next = new Date(Date.parse(toDate + "T12:00:00Z") + 86_400_000).toISOString().slice(0, 10);
  const money = (amount: number, basis: string) => ({ status: "complete" as const, amountCents: amount, knownAmountCents: amount, reasons: [], temporalBasis: basis });
  return { businessMode: "services", merchantId: decodeURIComponent(request.url.pathname.split("/")[3]!), timeZone: "America/Sao_Paulo",
    currency: status === "unavailable" ? null : "BRL", currencies: status === "unavailable" ? [] : ["BRL"],
    asOf: status === "unavailable" ? null : "2026-11-21T12:00:00.000Z",
    period: { fromDate, toDate, from: fromDate + "T03:00:00.000Z", until: next + "T03:00:00.000Z", bounds: "[from,until)" },
    filters: { professionalId: request.url.searchParams.get("professionalId"), categoryId: request.url.searchParams.get("categoryId") }, dataStatus: status,
    temporalBases: { appointments: "appointment_starts_at", occupancy: "overlap_clipped_to_period", receivable: "cohort_obligation_as_of",
      received: "recorded_approval_or_confirmed_observation_and_local_receipt", refunds: "refund_processed_at" },
    metrics: status === "unavailable" ? null : { byStatus: { pending: 0, scheduled: 1, in_service: 0, completed: 0, no_show: 0, cancelled: 0 },
      occupancy: { offeredMinutes: 60, occupiedMinutes: 20, knownOfferedMinutes: 60, knownOccupiedMinutes: 20, occupancyRate: 1 / 3,
        rateStatus: "calculable", coverage: "complete", reasons: [], professionals: [{ professionalId: "p", offeredMinutes: 60, occupiedMinutes: 20, occupancyRate: 1 / 3 }] },
      valuesByCurrency: [{ currency: "BRL", scheduled: money(10000, "appointment_starts_at"), receivable: money(1000, "cohort_obligation_as_of"),
        received: { ...money(known, "recorded_approval_or_confirmed_observation_and_local_receipt"), status: status === "partial" ? "partial" : "complete",
          amountCents: status === "partial" ? null : known, reasons: status === "partial" ? ["service_classification_unproven"] : [] },
        refunds: money(0, "refund_processed_at") }], financialCoverage: "complete" } };
}
async function mount(options: { profile?: MerchantProfile | null; query?: ServiceMetricsQuery; handle?: (request: ReadRequest) => Response | Promise<Response> | undefined } = {}) {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const requests: ReadRequest[] = [];
  let vm!: VM;
  const api = createDashboardApi({ baseUrl: "https://api.example.test", fetchImpl: (async (input, init) => {
    const request = { url: new URL(String(input)), signal: init?.signal };
    requests.push(request);
    if (!request.url.pathname.endsWith("/service-metrics")) throw new Error("unexpected_commerce_request:" + request.url.pathname);
    return options.handle?.(request) ?? Response.json(dto(request));
  }) as typeof fetch });
  function Probe({ profile, selected }: { profile: MerchantProfile | null; selected: ServiceMetricsQuery }) {
    vm = useServiceOverview({ me: profile, query: selected });
    return React.createElement("output", null, JSON.stringify({ status: vm.status, data: vm.data, errorKind: vm.errorKind, asOf: vm.asOf }));
  }
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host); roots.push({ root, host });
  const render = async (profile: MerchantProfile | null, selected: ServiceMetricsQuery = query) => {
    await act(async () => root.render(React.createElement(ApiContext.Provider, { value: api }, React.createElement(Probe, { profile, selected }))));
  };
  await render(options.profile === undefined ? me : options.profile, options.query ?? query);
  return { vm: () => vm, host, requests, render, unmount: async () => {
    await act(async () => root.unmount()); roots.splice(roots.findIndex(entry => entry.root === root), 1); host.remove();
  } };
}

// One exact root; the approved ^T88$ selector executes every direct group.
it("T88", async () => {
  const complete = await mount();
  expect(complete.vm().status).toBe("complete");
  expect(complete.vm().data?.metrics?.valuesByCurrency[0]?.received.amountCents).toBe(9000);
  expect(complete.vm().asOf).toBe("2026-11-21T12:00:00.000Z");
  expect(complete.requests.map(row => row.url.pathname)).toEqual(["/v1/merchants/merchant-a/service-metrics"]);
  expect(complete.vm().data?.temporalBases.received).toBe("recorded_approval_or_confirmed_observation_and_local_receipt");
  complete.vm().query!.professionalId = "not-a-controlled-filter";
  await act(async () => complete.vm().refresh());
  expect(complete.requests[1]?.url.searchParams.get("professionalId")).toBeNull();
  expect(complete.vm().data?.filters.professionalId).toBeNull();
  await complete.unmount();
  const partial = await mount({ handle: request => Response.json(dto(request, "partial")) });
  expect(partial.vm().status).toBe("partial");
  expect(partial.vm().data?.metrics?.valuesByCurrency[0]?.received).toMatchObject({ amountCents: null, knownAmountCents: 9000, status: "partial" });
  expect(partial.vm().data?.currency).toBe("BRL"); await partial.unmount();
  const unavailable = await mount({ handle: request => Response.json(dto(request, "unavailable")) });
  expect(unavailable.vm().status).toBe("unavailable");
  expect(unavailable.vm().data?.metrics).toBeNull(); expect(unavailable.vm().asOf).toBeNull(); await unavailable.unmount();

  for (const profile of [null, { ...me, role: "STAFF" as const }, { ...me, businessMode: "products" as const },
    { ...me, businessMode: undefined }, { ...me, businessModeSelectionState: undefined }, { ...me, businessModeSelectionState: "review_required" as const },
    { ...me, user_id: "" }]) {
    const blocked = await mount({ profile }); expect(blocked.vm().allowed).toBe(false);
    expect(blocked.vm().data).toBeNull(); expect(blocked.requests).toEqual([]);
    await act(async () => blocked.vm().refresh()); expect(blocked.requests).toEqual([]); await blocked.unmount();
  }
  const invalid = await mount({ query: { fromDate: "2026-02-30", toDate: "2026-03-01" } });
  expect(invalid.vm().status).toBe("invalid"); expect(invalid.requests).toEqual([]); await invalid.unmount();

  const old = deferred<Response>();
  const race = await mount({ query: { ...query, professionalId: "old" }, handle: request => request.url.searchParams.get("professionalId") === "old" ? old.promise : undefined });
  await race.render(me, { ...query, professionalId: "new", categoryId: "c" });
  expect(race.requests[0]?.signal?.aborted).toBe(true);
  expect(race.vm().data?.filters).toEqual({ professionalId: "new", categoryId: "c" });
  await act(async () => old.resolve(Response.json(dto(race.requests[0]!, "complete", 111))));
  expect(race.vm().data?.filters.professionalId).toBe("new");
  expect(race.vm().data?.metrics?.valuesByCurrency[0]?.received.amountCents).toBe(9000); await race.unmount();

  const stale = deferred<Response>();
  const failedLatest = await mount({ query: { ...query, professionalId: "old" }, handle: request => request.url.searchParams.get("professionalId") === "old"
    ? stale.promise : Response.json({ code: "service_metrics_unavailable" }, { status: 503 }) });
  await failedLatest.render(me, { ...query, professionalId: "new" });
  expect(failedLatest.vm().status).toBe("error"); expect(failedLatest.vm().errorKind).toBe("server"); expect(failedLatest.vm().data).toBeNull();
  await act(async () => stale.resolve(Response.json(dto(failedLatest.requests[0]!))));
  expect(failedLatest.vm().status).toBe("error"); expect(failedLatest.vm().data).toBeNull(); await failedLatest.unmount();
  let refreshCalls = 0;
  const failedRefresh = await mount({ handle: () => ++refreshCalls === 1 ? undefined : Response.json({ code: "service_metrics_unavailable" }, { status: 503 }) });
  expect(failedRefresh.vm().data).not.toBeNull();
  await act(async () => failedRefresh.vm().refresh());
  expect(failedRefresh.vm().status).toBe("error"); expect(failedRefresh.vm().data).toBeNull(); expect(failedRefresh.vm().asOf).toBeNull();
  await failedRefresh.unmount();

  const tenantA = deferred<Response>(), userB = deferred<Response>(); let calls = 0;
  const identities = await mount({ handle: () => ++calls === 1 ? tenantA.promise : calls === 2 ? userB.promise : undefined });
  await identities.render({ ...me, id: "merchant-b", user_id: "operator-b" });
  expect(identities.vm().data).toBeNull();
  await identities.render({ ...me, id: "merchant-b", user_id: "operator-c" });
  expect(identities.requests[0]?.signal?.aborted).toBe(true); expect(identities.requests[1]?.signal?.aborted).toBe(true);
  await act(async () => { tenantA.resolve(Response.json(dto(identities.requests[0]!, "complete", 111))); userB.resolve(Response.json(dto(identities.requests[1]!, "complete", 222))); });
  expect(identities.vm().data?.merchantId).toBe("merchant-b");
  expect(identities.vm().data?.metrics?.valuesByCurrency[0]?.received.amountCents).toBe(9000);
  expect(identities.requests.length).toBe(3); await identities.unmount();

  const loggedOutRead = deferred<Response>(); const logout = await mount({ handle: () => loggedOutRead.promise });
  const previousRefresh = logout.vm().refresh;
  await logout.render(null); expect(logout.vm().data).toBeNull(); expect(logout.vm().status).toBe("unauthorized");
  expect(logout.requests[0]?.signal?.aborted).toBe(true);
  await act(async () => { await previousRefresh(); loggedOutRead.resolve(Response.json(dto(logout.requests[0]!))); });
  expect(logout.requests.length).toBe(1); expect(logout.vm().data).toBeNull(); await logout.unmount();

  const expired = await mount(); const expiredRefresh = expired.vm().refresh;
  await act(async () => window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT)));
  expect(expired.vm().status).toBe("unauthorized"); expect(expired.vm().data).toBeNull();
  await act(async () => expiredRefresh()); expect(expired.requests.length).toBe(1);
  await expired.render(null); await expired.render(me);
  expect(expired.vm().status).toBe("complete"); expect(expired.requests.length).toBe(2); await expired.unmount();

  const late = deferred<Response>(); const unmounted = await mount({ handle: () => late.promise });
  const afterUnmount = unmounted.vm().refresh; await unmounted.unmount();
  expect(unmounted.requests[0]?.signal?.aborted).toBe(true);
  await act(async () => { await afterUnmount(); late.reject(new Error("late_failure")); });
  expect(unmounted.requests.length).toBe(1);
});
