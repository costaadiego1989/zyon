import { expect, it } from "vitest";
import type { ServiceMetricsResponse } from "@zyon/shared-types";
import { createDashboardApi } from "../index.js";
import { DashboardHttpError, DashboardJsonParseError } from "../http/error.js";
import { serviceMetricsEndpoints, validateServiceMetricsQuery } from "./service-metrics.js";

const query = { fromDate: "2026-11-19", toDate: "2026-11-19", professionalId: "professional/a", categoryId: "category-a" };
function dto(merchantId: string): ServiceMetricsResponse {
  return { businessMode: "services", merchantId, timeZone: "America/Sao_Paulo", currency: null, currencies: [],
    asOf: "2026-11-21T12:00:00.000Z", period: { fromDate: query.fromDate, toDate: query.toDate,
      from: "2026-11-19T03:00:00.000Z", until: "2026-11-20T03:00:00.000Z", bounds: "[from,until)" },
    filters: { professionalId: query.professionalId, categoryId: query.categoryId }, dataStatus: "complete",
    temporalBases: { appointments: "appointment_starts_at", occupancy: "overlap_clipped_to_period", receivable: "cohort_obligation_as_of",
      received: "recorded_approval_or_confirmed_observation_and_local_receipt", refunds: "refund_processed_at" },
    metrics: { byStatus: { pending: 0, scheduled: 0, in_service: 0, completed: 0, no_show: 0, cancelled: 0 },
      occupancy: { offeredMinutes: 0, occupiedMinutes: 0, knownOfferedMinutes: 0, knownOccupiedMinutes: 0, occupancyRate: null,
        rateStatus: "not_calculable", coverage: "complete", reasons: [], professionals: [] }, valuesByCurrency: [], financialCoverage: "complete" } };
}

it("T88", async () => {
  const profile = { id: "merchant/a", user_id: "operator-a" };
  const expected = dto(profile.id);
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const fetchImpl = (async (input, init) => { requests.push({ url: String(input), init }); return Response.json(expected); }) as typeof fetch;
  const api = serviceMetricsEndpoints("https://api.example.test", fetchImpl).serviceMetrics(profile);
  profile.id = "foreign"; profile.user_id = "another-operator";
  const controller = new AbortController();
  await expect(api.read(query, { signal: controller.signal })).resolves.toEqual(expected);
  expect(requests[0]?.url).toBe("https://api.example.test/v1/merchants/merchant%2Fa/service-metrics?fromDate=2026-11-19&toDate=2026-11-19&professionalId=professional%2Fa&categoryId=category-a");
  expect(requests[0]?.init).toMatchObject({ method: "GET", credentials: "include", cache: "no-store", signal: controller.signal });
  expect(requests[0]?.init?.body).toBeNull();
  expect(new Headers(requests[0]?.init?.headers).has("Idempotency-Key")).toBe(false);
  const composed = createDashboardApi({ baseUrl: "https://api.example.test", fetchImpl });
  await expect(composed.serviceMetrics({ id: "merchant/a", user_id: "operator-a" }).read(query)).resolves.toEqual(expected);
  expect(requests.map(row => new URL(row.url).pathname)).toEqual([
    "/v1/merchants/merchant%2Fa/service-metrics", "/v1/merchants/merchant%2Fa/service-metrics",
  ]);

  expect(validateServiceMetricsQuery({ fromDate: "2026-01-01", toDate: "2026-01-31" })).toEqual({ fromDate: "2026-01-01", toDate: "2026-01-31" });
  for (const invalid of [null, [], {}, { ...query, fromDate: "2026-02-30" }, { ...query, toDate: "2026-11-18" },
    { fromDate: "2026-01-01", toDate: "2026-02-01" }, { ...query, professionalId: ["p"] }, { ...query, categoryId: " c " },
    ...["merchantId", "actor", "userId", "timeZone", "asOf", "pageSize", "maxRows", "cursor"].map(key => ({ ...query, [key]: "forged" }))])
    expect(() => validateServiceMetricsQuery(invalid)).toThrow(TypeError);
  await expect(api.read({ ...query, merchantId: "forged" } as typeof query)).rejects.toBeInstanceOf(TypeError);
  expect(requests.length).toBe(2);
  expect(() => serviceMetricsEndpoints("https://api.example.test", fetchImpl).serviceMetrics({ id: "", user_id: "a" })).toThrow(TypeError);

  const wrongScope = serviceMetricsEndpoints("https://api.example.test", (async () => Response.json({ ...expected, merchantId: "foreign" })) as typeof fetch)
    .serviceMetrics({ id: "merchant/a", user_id: "operator-a" });
  await expect(wrongScope.read(query)).rejects.toBeInstanceOf(DashboardJsonParseError);
  const malformed = serviceMetricsEndpoints("https://api.example.test", (async () => Response.json({})) as typeof fetch)
    .serviceMetrics({ id: "merchant/a", user_id: "operator-a" });
  await expect(malformed.read(query)).rejects.toBeInstanceOf(DashboardJsonParseError);
  const inconsistent = structuredClone(expected);
  inconsistent.metrics!.occupancy.coverage = "partial";
  inconsistent.metrics!.occupancy.offeredMinutes = null;
  const inconsistentApi = serviceMetricsEndpoints("https://api.example.test", (async () => Response.json(inconsistent)) as typeof fetch)
    .serviceMetrics({ id: "merchant/a", user_id: "operator-a" });
  await expect(inconsistentApi.read(query)).rejects.toBeInstanceOf(DashboardJsonParseError);
  const failed = serviceMetricsEndpoints("https://api.example.test", (async () => Response.json({ code: "service_metrics_unavailable" }, { status: 503 })) as typeof fetch)
    .serviceMetrics({ id: "merchant/a", user_id: "operator-a" });
  await expect(failed.read(query)).rejects.toMatchObject({ status: 503, name: "DashboardHttpError" });
  await expect(failed.read(query)).rejects.toBeInstanceOf(DashboardHttpError);
});
