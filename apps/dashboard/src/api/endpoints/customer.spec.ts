import { describe, expect, it } from "vitest";
import { customerEndpoints } from "./customer.js";
import { toCustomerKpis } from "../../pages/useCustomersPage.js";

const metrics = {
  total_customers: 8,
  new_customers: 3,
  returning_customers: 5,
  repeat_rate: 0.625,
  period_from: "2026-09-23",
  period_to: "2026-09-29",
};
const period = { dateFrom: "2026-09-23", dateTo: "2026-09-29" };
const envelope = (data: unknown) => ({ data, meta: { request_id: "req_customer_metrics", timestamp: "2026-09-29T12:00:00.000Z", version: "v1" } });
const apiFor = (response: unknown) => customerEndpoints("https://example.test", (async () => new Response(JSON.stringify(response), { status: 200 })) as typeof fetch);

describe("customer analytics response contract", () => {
  it("reads the public API envelope before computing the customer cards", async () => {
    const selectedPeriod = await apiFor(envelope(metrics)).getCustomerMetrics(period);
    expect(toCustomerKpis(selectedPeriod)).toEqual({ totalCustomers: 8, newCustomers: 3, returningCustomers: 5, repeatRate: 0.625 });
  });

  it("sends the full selected date bounds without truncating the final day", async () => {
    const selected = { dateFrom: "2026-07-02T00:00:00.000Z", dateTo: "2026-09-29T23:59:59.999Z" };
    let requestedUrl = "";
    const api = customerEndpoints("https://example.test", (async (url: string) => {
      requestedUrl = url;
      return new Response(JSON.stringify(envelope(metrics)), { status: 200 });
    }) as typeof fetch);
    await api.getCustomerMetrics(selected);
    const url = new URL(requestedUrl);
    expect(url.searchParams.get("date_from")).toBe(selected.dateFrom);
    expect(url.searchParams.get("date_to")).toBe(selected.dateTo);
  });

  it("keeps direct responses compatible", async () => {
    expect(await apiFor(metrics).getCustomerMetrics(period)).toEqual(metrics);
  });

  it("preserves genuine zero values for a store without purchases", async () => {
    const empty = { ...metrics, total_customers: 0, new_customers: 0, returning_customers: 0, repeat_rate: 0 };
    expect(await apiFor(envelope(empty)).getCustomerMetrics(period)).toEqual(empty);
  });

  it.each([
    ["missing payload", null],
    ["missing metrics", {}],
    ["missing rate", { ...metrics, repeat_rate: undefined }],
    ["null rate", { ...metrics, repeat_rate: null }],
    ["string rate", { ...metrics, repeat_rate: "0.625" }],
    ["negative rate", { ...metrics, repeat_rate: -0.5 }],
    ["rate above one", { ...metrics, repeat_rate: 1.5 }],
    ["missing count", { ...metrics, total_customers: undefined }],
    ["negative count", { ...metrics, new_customers: -1 }],
    ["fractional count", { ...metrics, returning_customers: 0.5 }],
  ])("rejects %s instead of showing NaN or inventing zero", async (_name, data) => {
    await expect(apiFor(envelope(data)).getCustomerMetrics(period)).rejects.toThrow("customer_metrics_invalid_response");
  });
});
