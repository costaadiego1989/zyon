/** @vitest-environment jsdom */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it } from "vitest";
import type { ServiceMetricsResponse } from "@zyon/shared-types";
import { createDashboardApi, type MerchantProfile } from "../../../api-client.js";
import { ApiContext } from "../../../hooks/useApi.js";
import { SESSION_EXPIRED_EVENT } from "../../../api/http/client.js";
import { ServiceOverviewPanel, defaultServiceOverviewQuery } from "./ServiceOverviewPanel.js";

const me: MerchantProfile = { id: "services-a", user_id: "owner-a", name: "Clínica de exemplo", role: "OWNER", businessMode: "services", businessModeSelectionState: "selected" };
const query = { fromDate: "2026-11-19", toDate: "2026-11-19" };
const mounts: Array<{ root: Root; host: HTMLDivElement }> = [];
afterEach(async () => { for (const { root, host } of mounts.splice(0)) { await act(async () => root.unmount()); host.remove(); } });
const text = (node: Element | null) => node?.textContent?.replace(/\s+/g, " ").trim() ?? "";
function response(url: URL): ServiceMetricsResponse {
  const fromDate = url.searchParams.get("fromDate")!, toDate = url.searchParams.get("toDate")!;
  const end = new Date(Date.parse(toDate + "T12:00:00Z") + 86_400_000).toISOString().slice(0, 10);
  const money = (amount: number, temporalBasis: string) => ({ status: "complete" as const, amountCents: amount, knownAmountCents: amount, reasons: [], temporalBasis });
  return { businessMode: "services", merchantId: decodeURIComponent(url.pathname.split("/")[3]!), timeZone: "America/Sao_Paulo",
    currency: "BRL", currencies: ["BRL"], asOf: "2026-11-21T12:00:00.000Z", dataStatus: "complete",
    period: { fromDate, toDate, from: fromDate + "T03:00:00.000Z", until: end + "T03:00:00.000Z", bounds: "[from,until)" },
    filters: { professionalId: url.searchParams.get("professionalId"), categoryId: url.searchParams.get("categoryId") },
    temporalBases: { appointments: "appointment_starts_at", occupancy: "overlap_clipped_to_period", receivable: "cohort_obligation_as_of",
      received: "recorded_approval_or_confirmed_observation_and_local_receipt", refunds: "refund_processed_at" },
    metrics: { byStatus: { pending: 1, scheduled: 2, in_service: 1, completed: 3, no_show: 1, cancelled: 1 },
      occupancy: { offeredMinutes: 240, occupiedMinutes: 150, knownOfferedMinutes: 240, knownOccupiedMinutes: 150, occupancyRate: .625,
        rateStatus: "calculable", coverage: "complete", reasons: [], professionals: [{ professionalId: "p-a", offeredMinutes: 240, occupiedMinutes: 150, occupancyRate: .625 }] },
      valuesByCurrency: [{ currency: "BRL", scheduled: money(10000, "appointment_starts_at"), receivable: money(4000, "cohort_obligation_as_of"),
        received: money(url.searchParams.get("professionalId") === "p-b" ? 4500 : 9000, "recorded_approval_or_confirmed_observation_and_local_receipt"),
        refunds: money(1000, "refund_processed_at") }], financialCoverage: "complete" } };
}
type Handler = (url: URL) => Response | Promise<Response> | undefined;
function held<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
async function fixture(options: { profile?: MerchantProfile | null; handle?: Handler } = {}) {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const requests: URL[] = [];
  const api = createDashboardApi({ baseUrl: "https://api.example.test", fetchImpl: (async input => {
    const url = new URL(String(input)); requests.push(url);
    const custom = options.handle?.(url); if (custom !== undefined) return custom;
    if (url.pathname.endsWith("/service-metrics")) return Response.json(response(url));
    if (url.pathname.endsWith("/service-professionals")) return Response.json({ items: [
      { id: "p-a", merchantId: me.id, publicName: "Ana", isActive: true }, { id: "p-b", merchantId: me.id, publicName: "Caio", isActive: true },
    ], nextCursor: null });
    if (url.pathname.endsWith("/categories")) return Response.json([{ id: "c-a", name: "Consultas", is_active: true }, { id: "c-b", name: "Exames", is_active: true }]);
    throw new Error("unexpected_commerce_request:" + url.pathname);
  }) as typeof fetch });
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host); mounts.push({ root, host });
  const render = async (profile: MerchantProfile | null) => {
    await act(async () => root.render(React.createElement(ApiContext.Provider, { value: api }, React.createElement(ServiceOverviewPanel, { me: profile, initialQuery: query }))));
  };
  await render(options.profile === undefined ? me : options.profile);
  return { host, requests, render, metricReads: () => requests.filter(url => url.pathname.endsWith("/service-metrics")), unmount: async () => {
    await act(async () => root.unmount()); mounts.splice(mounts.findIndex(entry => entry.root === root), 1); host.remove();
  } };
}
function control<T extends HTMLInputElement | HTMLSelectElement>(host: HTMLElement, label: string): T {
  const element = Array.from(host.querySelectorAll("label")).find(item => text(item) === label);
  if (!element?.htmlFor) throw new Error("Missing real labelled control: " + label);
  return host.querySelector(`[id="${element.htmlFor}"]`)! as T;
}
async function change(element: HTMLInputElement | HTMLSelectElement, value: string) {
  await act(async () => {
    const prototype = element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true })); element.dispatchEvent(new Event("change", { bubbles: true }));
  });
}
async function click(host: HTMLElement, label: string) {
  const button = Array.from(host.querySelectorAll("button")).find(item => text(item) === label);
  if (!button) throw new Error("Missing real button: " + label);
  await act(async () => button.click());
}

it("T89", async () => {
  expect(defaultServiceOverviewQuery(new Date("2026-11-20T01:00:00Z"))).toEqual({ fromDate: "2026-11-13", toDate: "2026-11-19" });
  const ready = await fixture();
  expect(ready.host.querySelector("h1")?.textContent).toBe("Visão geral dos serviços");
  expect(text(ready.host.querySelector('[data-metric="confirmed"] dd'))).toBe("7");
  expect(text(ready.host.querySelector('[data-metric="completed"] dd'))).toBe("3");
  expect(text(ready.host.querySelector('[data-metric="no-show"] dd'))).toBe("1");
  expect(text(ready.host.querySelector('[data-financial="received"] dd'))).toContain("R$ 90,00");
  expect(text(ready.host.querySelector('[data-financial="receivable"] dd'))).toContain("R$ 40,00");
  expect(text(ready.host.querySelector('[data-financial="refunds"] dd'))).toContain("R$ 10,00");
  expect(text(ready.host.querySelector('[data-service-as-of]'))).toContain("21/11/2026");
  expect(text(ready.host.querySelector('[data-service-as-of]'))).toContain("09:00");
  expect(text(ready.host.querySelector('[data-service-occupancy]'))).toContain("62,5%");
  expect(text(ready.host)).toContain("não inclui taxas adicionais do comprador");
  expect(ready.metricReads()).toHaveLength(1);
  expect(ready.requests.filter(url => url.pathname.endsWith("/service-professionals"))).toHaveLength(1);
  expect(ready.requests.filter(url => url.pathname.endsWith("/categories"))).toHaveLength(1);
  await change(control(ready.host, "Data inicial"), "2026-11-18");
  await change(control(ready.host, "Profissional"), "p-b");
  await change(control(ready.host, "Categoria de serviço"), "c-b");
  await click(ready.host, "Aplicar filtros");
  expect(Object.fromEntries(ready.metricReads().at(-1)!.searchParams)).toEqual({ fromDate: "2026-11-18", toDate: "2026-11-19", professionalId: "p-b", categoryId: "c-b" });
  expect(text(ready.host.querySelector('[data-financial="received"] dd'))).toContain("R$ 45,00");
  await change(control(ready.host, "Data inicial"), "2026-10-01");
  await click(ready.host, "Aplicar filtros");
  expect(text(ready.host.querySelector('[data-service-filter-error]'))).toContain("31 dias");
  expect(ready.metricReads()).toHaveLength(2); await ready.unmount();

  const partial = await fixture({ handle: url => {
    if (!url.pathname.endsWith("/service-metrics")) return;
    const body = response(url); body.dataStatus = "partial";
    body.metrics!.valuesByCurrency[0]!.received = { ...body.metrics!.valuesByCurrency[0]!.received,
      status: "partial", amountCents: null, reasons: ["service_classification_unproven"] };
    return Response.json(body);
  } });
  expect(partial.host.querySelector('[data-service-overview]')?.getAttribute("data-state")).toBe("partial");
  expect(text(partial.host.querySelector('[data-financial="received"] dd'))).toContain("Não confirmado");
  expect(text(partial.host.querySelector('[data-financial="received"] dd'))).toContain("Valor conhecido: R$ 90,00");
  expect(text(partial.host.querySelector('[data-financial="received"] dd'))).not.toContain("R$ 0,00"); await partial.unmount();
  const unknownCurrency = await fixture({ handle: url => {
    if (!url.pathname.endsWith("/service-metrics")) return;
    const body = response(url); body.dataStatus = "partial"; body.currency = null; body.currencies = [];
    body.metrics!.financialCoverage = "partial"; body.metrics!.valuesByCurrency = []; return Response.json(body);
  } });
  expect(text(unknownCurrency.host)).toContain("Não foi possível confirmar os valores financeiros deste período");
  expect(text(unknownCurrency.host)).not.toContain("Nenhum valor financeiro registrado");
  expect(unknownCurrency.host.querySelector('[data-financial]')).toBeNull(); await unknownCurrency.unmount();
  const currencies = await fixture({ handle: url => {
    if (!url.pathname.endsWith("/service-metrics")) return;
    const body = response(url); body.currency = null; body.currencies = ["BRL", "USD"];
    const dollars = structuredClone(body.metrics!.valuesByCurrency[0]!); dollars.currency = "USD";
    dollars.received.amountCents = 2000; dollars.received.knownAmountCents = 2000;
    body.metrics!.valuesByCurrency.push(dollars); return Response.json(body);
  } });
  expect(currencies.host.querySelectorAll('[data-service-currency]')).toHaveLength(2);
  expect(text(currencies.host.querySelector('[aria-label="Valores em BRL"] [data-financial="received"] dd'))).toContain("R$ 90,00");
  expect(text(currencies.host.querySelector('[aria-label="Valores em USD"] [data-financial="received"] dd'))).toContain("20,00"); await currencies.unmount();
  const denominator = await fixture({ handle: url => {
    if (!url.pathname.endsWith("/service-metrics")) return;
    const body = response(url); Object.assign(body.metrics!.occupancy, { offeredMinutes: 0, occupiedMinutes: 0, knownOfferedMinutes: 0,
      knownOccupiedMinutes: 0, occupancyRate: null, rateStatus: "not_calculable", professionals: [] }); return Response.json(body);
  } });
  expect(text(denominator.host.querySelector('[data-service-occupancy]'))).toContain("Não calculável");
  expect(text(denominator.host.querySelector('[data-service-occupancy]'))).not.toContain("0%"); await denominator.unmount();

  const empty = await fixture({ handle: url => {
    if (!url.pathname.endsWith("/service-metrics")) return;
    const body = response(url); for (const key of ["pending", "scheduled", "in_service", "completed", "no_show", "cancelled"] as const) body.metrics!.byStatus[key] = 0;
    for (const key of ["scheduled", "receivable", "received", "refunds"] as const) Object.assign(body.metrics!.valuesByCurrency[0]![key], { amountCents: 0, knownAmountCents: 0 });
    Object.assign(body.metrics!.occupancy, { occupiedMinutes: 0, knownOccupiedMinutes: 0, occupancyRate: 0, professionals: [] }); return Response.json(body);
  } });
  expect(text(empty.host)).toContain("Sem movimentação neste período");
  expect(text(empty.host.querySelector('[data-metric="confirmed"] dd'))).toBe("0"); await empty.unmount();
  const unavailable = await fixture({ handle: url => url.pathname.endsWith("/service-metrics")
    ? Response.json({ ...response(url), dataStatus: "unavailable", metrics: null, asOf: null, currency: null, currencies: [] }) : undefined });
  expect(text(unavailable.host)).toContain("Indicadores temporariamente indisponíveis");
  expect(unavailable.host.querySelector('[data-financial]')).toBeNull(); await unavailable.unmount();
  const pending = held<Response>(); const loading = await fixture({ handle: url => url.pathname.endsWith("/service-metrics") ? pending.promise : undefined });
  expect(loading.host.querySelector('[aria-label="Carregando indicadores de serviços"]')).not.toBeNull();
  expect(loading.host.querySelector('[data-financial]')).toBeNull();
  await act(async () => pending.resolve(Response.json(response(loading.metricReads()[0]!)))); await loading.unmount();

  let metricsCalls = 0;
  const retry = await fixture({ handle: url => url.pathname.endsWith("/service-metrics") && ++metricsCalls === 1 ? Response.json({ code: "service_metrics_unavailable" }, { status: 503 }) : undefined });
  expect(text(retry.host)).toContain("Não foi possível carregar os indicadores");
  await click(retry.host, "Tentar novamente");
  expect(text(retry.host.querySelector('[data-financial="received"] dd'))).toContain("R$ 90,00"); expect(retry.metricReads()).toHaveLength(2); await retry.unmount();
  let failLookup = true;
  const lookup = await fixture({ handle: url => failLookup && (url.pathname.endsWith("/categories") || url.pathname.endsWith("/service-professionals"))
    ? Response.json({ message: "unavailable" }, { status: 503 }) : undefined });
  expect(text(lookup.host)).toContain("Não foi possível carregar os filtros de equipe");
  expect(text(lookup.host.querySelector('[data-financial="received"] dd'))).toContain("R$ 90,00");
  failLookup = false; await click(lookup.host, "Recarregar filtros"); expect(lookup.metricReads()).toHaveLength(1);
  expect(control<HTMLSelectElement>(lookup.host, "Profissional").options[1]?.textContent).toBe("Ana"); await lookup.unmount();
  const expired = await fixture();
  const readsBeforeExpiry = expired.requests.length;
  await act(async () => window.dispatchEvent(new CustomEvent(SESSION_EXPIRED_EVENT)));
  expect(text(expired.host)).toContain("Acesso aos indicadores indisponível");
  expect(expired.host.querySelector('form')).toBeNull();
  expect(expired.host.querySelector('[data-financial]')).toBeNull();
  expect(text(expired.host)).not.toContain("Ana"); expect(expired.requests).toHaveLength(readsBeforeExpiry); await expired.unmount();
  for (const profile of [null, { ...me, role: "STAFF" as const }, { ...me, businessMode: "products" as const }, { ...me, businessModeSelectionState: "review_required" as const }]) {
    const blocked = await fixture({ profile }); expect(blocked.requests).toEqual([]); expect(blocked.host.querySelector('[data-financial]')).toBeNull(); await blocked.unmount();
  }
});
