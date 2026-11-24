/** @vitest-environment jsdom */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterAll, afterEach, expect, it, vi } from "vitest";
import type { ServiceMetricsResponse } from "@zyon/shared-types";
import { createDashboardApi, type MerchantProfile } from "../../api-client.js";
import { ApiContext } from "../../hooks/useApi.js";
import { OverviewPage } from "./OverviewPage.js";

// JSDOM has no matchMedia. The existing chart library reads it at import time;
// this supplies that browser precondition without replacing charts or requests.
const mediaSetup = vi.hoisted(() => {
  const targets = [globalThis, window];
  const descriptors = targets.map(target => Object.getOwnPropertyDescriptor(target, "matchMedia"));
  const matchMedia = (media: string): MediaQueryList => Object.assign(new EventTarget(), {
    media, matches: media.includes("resolution"), onchange: null,
    addListener() {}, removeListener() {},
  }) as MediaQueryList;
  for (const target of targets) Object.defineProperty(target, "matchMedia", { configurable: true, writable: true, value: matchMedia });
  return { targets, descriptors };
});
afterAll(() => mediaSetup.targets.forEach((target, index) => {
  const descriptor = mediaSetup.descriptors[index];
  if (descriptor) Object.defineProperty(target, "matchMedia", descriptor);
  else Reflect.deleteProperty(target, "matchMedia");
}));

const product: MerchantProfile = { id: "merchant-a", user_id: "owner-a", name: "Loja A", role: "OWNER", plan: "BOTH", businessMode: "products", businessModeSelectionState: "selected" };
const service: MerchantProfile = { ...product, name: "Empresa de serviços A", businessMode: "services" };
const mounts: Array<{ root: Root; host: HTMLDivElement }> = [];
afterEach(async () => { for (const { root, host } of mounts.splice(0)) { await act(async () => root.unmount()); host.remove(); } });
const text = (node: Element | null) => node?.textContent?.replace(/\s+/g, " ").trim() ?? "";
function metricValue(host: HTMLElement, label: string) {
  return text(Array.from(host.querySelectorAll(".stat-card")).find(item => Array.from(item.querySelectorAll("span")).some(span => span.textContent === label))?.querySelector(".stat-card__value") ?? null);
}
function productPaths(id: string, plan: MerchantProfile["plan"], period = "7d") {
  const store = plan !== "API", checkout = store && plan !== "STORE_ONLY";
  return [
    ...(checkout ? [`/v1/checkout/dashboard/overview/${id}?period=${period}`, `/v1/checkout/funnel/${id}?period=${period}`] : []),
    ...(store ? [`/v1/checkout/dashboard/store-overview/${id}?period=${period}`, `/v1/storefront/funnel/${id}?period=${period}`] : []),
    `/v1/checkout/dashboard/overview/timeseries/${id}?period=${period}`,
  ].sort();
}
function serviceResult(url: URL): ServiceMetricsResponse {
  const fromDate = url.searchParams.get("fromDate")!, toDate = url.searchParams.get("toDate")!;
  const nextDay = new Date(Date.parse(toDate + "T12:00:00Z") + 86_400_000).toISOString().slice(0, 10);
  const merchantId = decodeURIComponent(url.pathname.split("/")[3]!);
  const amount = (cents: number, temporalBasis: string) => ({ status: "complete" as const, amountCents: cents, knownAmountCents: cents, temporalBasis, reasons: [] });
  return { businessMode: "services", merchantId, currency: "BRL", currencies: ["BRL"], timeZone: "America/Sao_Paulo", asOf: "2026-11-21T12:00:00.000Z", dataStatus: "complete",
    period: { fromDate, toDate, from: fromDate + "T03:00:00.000Z", until: nextDay + "T03:00:00.000Z", bounds: "[from,until)" },
    filters: { professionalId: url.searchParams.get("professionalId"), categoryId: url.searchParams.get("categoryId") },
    temporalBases: { appointments: "appointment_starts_at", occupancy: "overlap_clipped_to_period", receivable: "cohort_obligation_as_of", received: "recorded_approval_or_confirmed_observation_and_local_receipt", refunds: "refund_processed_at" },
    metrics: { byStatus: { pending: 1, scheduled: 2, in_service: 0, completed: 1, no_show: 1, cancelled: 0 },
      occupancy: { offeredMinutes: 120, occupiedMinutes: 60, knownOfferedMinutes: 120, knownOccupiedMinutes: 60, occupancyRate: .5, rateStatus: "calculable", coverage: "complete", reasons: [], professionals: [] },
      financialCoverage: "complete", valuesByCurrency: [{ currency: "BRL", scheduled: amount(15000, "appointment_starts_at"), receivable: amount(6000, "cohort_obligation_as_of"),
        received: amount(merchantId === "merchant-b" ? 12000 : 9000, "recorded_approval_or_confirmed_observation_and_local_receipt"), refunds: amount(1000, "refund_processed_at") }] } };
}
function storeResult(url: URL) {
  const id = decodeURIComponent(url.pathname.split("/").at(-1)!);
  return { merchant_id: id, period: url.searchParams.get("period"), revenue: id === "merchant-b" ? 456.78 : 123.45,
    orders_count: 2, average_ticket: 61.725, products_sold: 3, new_customers: 1, abandonment_rate: .1, orders_by_status: {}, top_products: [], recent_orders: [] };
}
interface Read { url: URL; method: string }
type Handle = (url: URL) => Response | Promise<Response> | undefined;
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
async function fixture(profile: MerchantProfile | null, handle?: Handle) {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const requests: Read[] = [];
  const api = createDashboardApi({ baseUrl: "https://api.example.test", fetchImpl: (async (input, init) => {
    const url = new URL(String(input)); requests.push({ url, method: init?.method ?? "GET" });
    const overridden = handle?.(url); if (overridden !== undefined) return overridden;
    const path = url.pathname;
    if (path.endsWith("/service-metrics")) return Response.json(serviceResult(url));
    if (path.endsWith("/service-professionals")) return Response.json({ items: [], nextCursor: null });
    if (/^\/v1\/merchants\/[^/]+\/categories$/.test(path)) return Response.json([]);
    if (path.includes("/checkout/dashboard/store-overview/")) return Response.json(storeResult(url));
    if (path.includes("/checkout/dashboard/overview/timeseries/")) return Response.json({ merchant_id: path.split("/").at(-1), period: url.searchParams.get("period"), revenue_daily: [], orders_daily: [], sessions_daily: [], conversion_daily: [] });
    if (path.includes("/checkout/dashboard/overview/")) return Response.json({ orders_completed: 2, conversion_rate_with_agent: .25, average_discount: 10, recent_sessions: [] });
    if (/^\/v1\/(checkout|storefront)\/funnel\/[^/]+$/.test(path)) return Response.json({ steps: [], transitions: [], bottleneck: null, period: { from: "2026-11-15", to: "2026-11-22" }, totalSessions: 0, overallConversion: 0 });
    if (path.endsWith("/billing/subscription")) return Response.json({ plan: "starter", features: { revenueManager: false } });
    throw new Error("unexpected_overview_request:" + path);
  }) as typeof fetch });
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host); mounts.push({ root, host });
  const render = async (current: MerchantProfile | null) => { await act(async () => root.render(<ApiContext.Provider value={api}>
    <OverviewPage apiBaseUrl="https://ignored.example.test" defaultMerchantId="foreign-default-must-not-be-used" me={current} />
  </ApiContext.Provider>)); };
  await render(profile);
  return { host, requests, render, metrics: () => requests.filter(item => item.url.pathname.endsWith("/service-metrics")),
    commerce: () => requests.filter(item => /^\/v1\/(checkout|storefront)\//.test(item.url.pathname)),
    unmount: async () => { await act(async () => root.unmount()); mounts.splice(mounts.findIndex(item => item.root === root), 1); host.remove(); } };
}
async function click(host: HTMLElement, label: string) {
  const target = Array.from(host.querySelectorAll<HTMLButtonElement>("button")).find(item => text(item) === label || item.getAttribute("aria-label") === label);
  if (!target) throw new Error("Missing real control: " + label);
  await act(async () => target.click());
}
function input(host: HTMLElement, label: string) {
  const id = Array.from(host.querySelectorAll("label")).find(item => text(item) === label)?.htmlFor;
  if (!id) throw new Error("Missing labelled date: " + label);
  return host.querySelector<HTMLInputElement>(`[id="${id}"]`)!;
}
async function change(target: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(target, value);
    target.dispatchEvent(new Event("input", { bubbles: true })); target.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

it("T90", async () => {
  for (const plan of [undefined, "BOTH", "STORE_ONLY", "CHECKOUT_ONLY", "API"] as const) {
    const f = await fixture({ ...product, plan });
    expect(f.commerce().map(item => item.url.pathname + item.url.search).sort()).toEqual(productPaths(product.id, plan));
    expect(f.metrics()).toHaveLength(0);
    expect(f.requests.every(item => item.method === "GET")).toBe(true);
    expect(f.host.querySelector('[data-service-overview]')).toBeNull();
    if (plan !== "API") {
      expect(f.host.querySelector("h1")?.textContent).toBe("Visão Geral");
      expect(metricValue(f.host, "Receita Total")).toBe("123,45"); expect(metricValue(f.host, "Pedidos")).toBe("2");
      if (plan !== "STORE_ONLY") expect(metricValue(f.host, "Conversão")).toBe("25.0");
    }
    await f.unmount();
  }
  for (const role of ["ADMIN", "STAFF"] as const) {
    const f = await fixture({ ...product, role }); expect(f.commerce().map(item => item.url.pathname + item.url.search).sort()).toEqual(productPaths(product.id, "BOTH"));
    expect(metricValue(f.host, "Receita Total")).toBe("123,45"); expect(f.metrics()).toHaveLength(0); await f.unmount();
  }
  for (const state of [undefined, "legacy"] as const) {
    const f = await fixture({ ...product, businessModeSelectionState: state }); expect(f.commerce()).toHaveLength(5); expect(f.metrics()).toHaveLength(0); await f.unmount();
  }
  const buying = await fixture(product);
  await click(buying.host, "Hoje");
  expect(buying.commerce().slice(-5).map(item => item.url.pathname + item.url.search).sort()).toEqual(productPaths(product.id, "BOTH", "today"));
  expect(metricValue(buying.host, "Receita Total")).toBe("123,45");
  await click(buying.host, "Atualizar dados"); expect(buying.commerce()).toHaveLength(15); expect(buying.metrics()).toHaveLength(0);
  await buying.render({ ...product, plan: "STORE_ONLY" });
  expect(buying.commerce().slice(-3).map(item => item.url.pathname + item.url.search).sort()).toEqual(productPaths(product.id, "STORE_ONLY", "today"));
  expect(buying.host.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe("Hoje");
  await buying.unmount();

  for (const plan of [undefined, "BOTH", "STORE_ONLY", "CHECKOUT_ONLY", "API"] as const) {
    const f = await fixture({ ...service, plan }); expect(f.commerce()).toHaveLength(0); expect(f.requests).toHaveLength(3); expect(f.metrics()).toHaveLength(1);
    expect(f.host.querySelector("h1")?.textContent).toBe("Visão geral dos serviços");
    expect(text(f.host.querySelector('[data-financial="received"] dd'))).toContain("R$ 90,00"); await f.unmount();
  }
  const admin = await fixture({ ...service, role: "ADMIN" }); expect(admin.metrics()).toHaveLength(1); expect(admin.commerce()).toHaveLength(0); await admin.unmount();
  const booking = await fixture(service);
  const toDate = input(booking.host, "Data final").value;
  await change(input(booking.host, "Data inicial"), toDate); await click(booking.host, "Aplicar filtros");
  expect(Object.fromEntries(booking.metrics().at(-1)!.url.searchParams)).toEqual({ fromDate: toDate, toDate });
  await click(booking.host, "Atualizar indicadores"); expect(booking.metrics()).toHaveLength(3); expect(booking.commerce()).toHaveLength(0);
  expect(booking.requests.every(item => item.url.pathname.startsWith(`/v1/merchants/${service.id}/`))).toBe(true);
  await booking.unmount();

  for (const profile of [null, { ...product, businessMode: undefined }, { ...product, businessModeSelectionState: "review_required" as const },
    { ...service, businessModeSelectionState: "review_required" as const }, { ...service, businessModeSelectionState: "legacy" as const }, { ...service, businessModeSelectionState: undefined },
    { ...service, role: "STAFF" as const }, { ...product, id: "" }, { ...product, user_id: "" }, { ...service, id: "" }, { ...service, user_id: "" },
    { ...product, businessMode: "unresolved" as MerchantProfile["businessMode"] }]) {
    const f = await fixture(profile); expect(f.requests).toEqual([]); expect(f.host.querySelector('[data-financial],.stat-card')).toBeNull();
    expect(text(f.host)).toMatch(/indisponível|Confirme a modalidade/); await f.unmount();
  }

  const switcher = await fixture(product); await click(switcher.host, "Hoje");
  await switcher.render(service); expect(switcher.metrics()).toHaveLength(1); expect(switcher.host.querySelector('.stat-card')).toBeNull();
  const beforeReturn = switcher.commerce().length;
  await switcher.render(product); expect(switcher.commerce().slice(beforeReturn).map(item => item.url.pathname + item.url.search).sort()).toEqual(productPaths(product.id, "BOTH"));
  expect(switcher.host.querySelector('[data-financial]')).toBeNull();
  const beforePrincipal = switcher.commerce().length;
  await switcher.render({ ...product, user_id: "owner-b" }); expect(switcher.commerce()).toHaveLength(beforePrincipal + 5);
  const beforeRole = switcher.commerce().length;
  await switcher.render({ ...product, user_id: "owner-b", role: "ADMIN" }); expect(switcher.commerce()).toHaveLength(beforeRole + 5);
  await switcher.render({ ...service, id: "merchant-b" });
  expect(text(switcher.host.querySelector('[data-financial="received"] dd'))).toContain("R$ 120,00");
  expect(switcher.metrics().at(-1)!.url.pathname).toBe("/v1/merchants/merchant-b/service-metrics");
  const beforeDenied = switcher.requests.length;
  await switcher.render({ ...service, id: "merchant-b", role: "STAFF" }); expect(switcher.requests).toHaveLength(beforeDenied); expect(switcher.host.querySelector('[data-financial]')).toBeNull();
  await switcher.render(null); expect(switcher.requests).toHaveLength(beforeDenied); expect(switcher.host.querySelector('[data-financial],.stat-card')).toBeNull(); await switcher.unmount();

  const oldProduct = deferred<Response>();
  const productPending = await fixture(product, url => url.pathname.includes("/store-overview/merchant-a") ? oldProduct.promise : undefined);
  await productPending.render({ ...service, id: "merchant-b" });
  await act(async () => oldProduct.resolve(Response.json(storeResult(new URL("https://api.example.test/v1/checkout/dashboard/store-overview/merchant-a?period=7d")))));
  expect(text(productPending.host.querySelector('[data-financial="received"] dd'))).toContain("R$ 120,00");
  expect(productPending.host.querySelector('.stat-card')).toBeNull(); await productPending.unmount();
  const oldService = deferred<Response>(); let heldUrl!: URL;
  const servicePending = await fixture(service, url => url.pathname.endsWith("/service-metrics") ? (heldUrl = url, oldService.promise) : undefined);
  await servicePending.render({ ...product, id: "merchant-b" });
  await act(async () => oldService.resolve(Response.json(serviceResult(heldUrl))));
  expect(metricValue(servicePending.host, "Receita Total")).toBe("456,78"); expect(servicePending.host.querySelector('[data-financial]')).toBeNull(); await servicePending.unmount();

  const failed = await fixture(service, url => url.pathname.endsWith("/service-metrics") ? Response.json({ code: "service_metrics_unavailable" }, { status: 503 }) : undefined);
  expect(text(failed.host)).toContain("Não foi possível carregar os indicadores"); expect(failed.commerce()).toHaveLength(0); expect(failed.host.querySelector('.stat-card')).toBeNull(); await failed.unmount();
  const unavailable = await fixture(service, url => url.pathname.endsWith("/service-metrics")
    ? Response.json({ ...serviceResult(url), dataStatus: "unavailable", metrics: null, asOf: null, currency: null, currencies: [] }) : undefined);
  expect(text(unavailable.host)).toContain("Indicadores temporariamente indisponíveis");
  expect(unavailable.commerce()).toHaveLength(0); expect(unavailable.host.querySelector('[data-financial],.stat-card')).toBeNull(); await unavailable.unmount();
  const empty = await fixture(service, url => {
    if (!url.pathname.endsWith("/service-metrics")) return;
    const body = serviceResult(url);
    for (const key of ["pending", "scheduled", "in_service", "completed", "no_show", "cancelled"] as const) body.metrics!.byStatus[key] = 0;
    for (const key of ["scheduled", "receivable", "received", "refunds"] as const) Object.assign(body.metrics!.valuesByCurrency[0]![key], { amountCents: 0, knownAmountCents: 0 });
    Object.assign(body.metrics!.occupancy, { offeredMinutes: 0, occupiedMinutes: 0, knownOfferedMinutes: 0, knownOccupiedMinutes: 0, occupancyRate: null, rateStatus: "not_calculable" });
    return Response.json(body);
  });
  expect(text(empty.host)).toContain("Sem movimentação neste período"); expect(empty.commerce()).toHaveLength(0); expect(empty.metrics()).toHaveLength(1); await empty.unmount();
  const nextMerchant = deferred<Response>(); let nextUrl!: URL;
  const switchingService = await fixture(service, url => url.pathname === "/v1/merchants/merchant-b/service-metrics" ? (nextUrl = url, nextMerchant.promise) : undefined);
  await switchingService.render({ ...service, id: "merchant-b" });
  expect(switchingService.host.querySelector('[aria-label="Carregando indicadores de serviços"]')).not.toBeNull();
  expect(switchingService.host.querySelector('[data-financial]')).toBeNull();
  const beforeLogout = switchingService.requests.length;
  await switchingService.render(null);
  await act(async () => nextMerchant.resolve(Response.json(serviceResult(nextUrl))));
  expect(switchingService.requests).toHaveLength(beforeLogout); expect(switchingService.host.querySelector('[data-financial],.stat-card')).toBeNull();
  expect(switchingService.commerce()).toHaveLength(0); await switchingService.unmount();
});
