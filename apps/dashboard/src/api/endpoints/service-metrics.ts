import type { ServiceMetricsResponse } from "@zyon/shared-types";
import type { MerchantProfile } from "../types.js";
import { dashboardJson } from "../http/client.js";
import { DashboardJsonParseError } from "../http/error.js";

export { classifyServiceAttendanceError as classifyServiceMetricsError } from "./service-attendance.js";
export type { ServiceAttendanceErrorKind as ServiceMetricsErrorKind } from "./service-attendance.js";
export interface ServiceMetricsQuery { fromDate: string; toDate: string; professionalId?: string; categoryId?: string }
export interface ServiceMetricsReadOptions { signal?: AbortSignal }
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const invalid = () => new TypeError("invalid_service_metrics_query");
function resourceId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.trim() === value && value.length <= 191
    && value !== "." && value !== ".." && !/[\u0000-\u001f\u007f]/.test(value);
}
/** Civil query only. Brasília instant conversion and the financial clock remain
 * authoritative server fields; this client never imports backend code. */
export function validateServiceMetricsQuery(value: unknown): ServiceMetricsQuery {
  if (!record(value) || Object.keys(value).some(key => !["fromDate", "toDate", "professionalId", "categoryId"].includes(key))) throw invalid();
  const date = (value: unknown) => {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw invalid();
    const epoch = Date.parse(value + "T00:00:00Z");
    if (!Number.isFinite(epoch) || new Date(epoch).toISOString().slice(0, 10) !== value) throw invalid();
    return { text: value, epoch };
  };
  const from = date(value.fromDate), to = date(value.toDate);
  if (to.epoch < from.epoch || to.epoch - from.epoch >= 31 * 86_400_000) throw invalid();
  const queryId = (id: unknown) => typeof id === "string" && id.length > 0 && id.trim() === id && id.length <= 191 && !/[\u0000-\u001f\u007f]/.test(id);
  if (value.professionalId !== undefined && !queryId(value.professionalId) || value.categoryId !== undefined && !queryId(value.categoryId)) throw invalid();
  return { fromDate: from.text, toDate: to.text,
    ...(value.professionalId === undefined ? {} : { professionalId: value.professionalId as string }),
    ...(value.categoryId === undefined ? {} : { categoryId: value.categoryId as string }) };
}
function checkedResponse(value: unknown, merchantId: string, query: ServiceMetricsQuery): ServiceMetricsResponse {
  const fail = (): never => { throw new DashboardJsonParseError("service_metrics_response_invalid"); };
  const instant = (value: unknown) => typeof value === "string" && /T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value));
  const nonnegative = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value >= 0;
  const cents = (value: unknown) => nonnegative(value) && Number.isSafeInteger(value);
  if (!record(value) || value.businessMode !== "services" || value.merchantId !== merchantId || value.timeZone !== "America/Sao_Paulo"
    || !["complete", "partial", "unavailable"].includes(String(value.dataStatus)) || !record(value.period) || !record(value.filters)
    || value.period.fromDate !== query.fromDate || value.period.toDate !== query.toDate || value.period.bounds !== "[from,until)"
    || !instant(value.period.from) || !instant(value.period.until) || Date.parse(String(value.period.from)) >= Date.parse(String(value.period.until))
    || value.filters.professionalId !== (query.professionalId ?? null) || value.filters.categoryId !== (query.categoryId ?? null)
    || !Array.isArray(value.currencies) || !value.currencies.every(currency => typeof currency === "string" && /^[A-Z]{3}$/.test(currency))
    || new Set(value.currencies).size !== value.currencies.length
    || value.currency !== (value.currencies.length === 1 ? value.currencies[0] : null) || !record(value.temporalBases)) return fail();
  const expectedBases = { appointments: "appointment_starts_at", occupancy: "overlap_clipped_to_period", receivable: "cohort_obligation_as_of",
    received: "recorded_approval_or_confirmed_observation_and_local_receipt", refunds: "refund_processed_at" };
  for (const [key, basis] of Object.entries(expectedBases)) if (value.temporalBases[key] !== basis) return fail();
  if (value.dataStatus === "unavailable") {
    if (value.metrics !== null || value.asOf !== null || value.currencies.length) return fail();
    return value as unknown as ServiceMetricsResponse;
  }
  if (!instant(value.asOf) || !record(value.metrics) || !record(value.metrics.byStatus) || !record(value.metrics.occupancy)
    || !Array.isArray(value.metrics.valuesByCurrency) || !["complete", "partial"].includes(String(value.metrics.financialCoverage))) return fail();
  for (const state of ["pending", "scheduled", "in_service", "completed", "no_show", "cancelled"]) if (!cents(value.metrics.byStatus[state])) return fail();
  const occupancy = value.metrics.occupancy;
  let partial = value.metrics.financialCoverage === "partial" || occupancy.coverage === "partial";
  if (![occupancy.offeredMinutes, occupancy.occupiedMinutes].every(amount => amount === null || nonnegative(amount))
    || !nonnegative(occupancy.knownOfferedMinutes) || !nonnegative(occupancy.knownOccupiedMinutes)
    || !(occupancy.occupancyRate === null || nonnegative(occupancy.occupancyRate))
    || !["calculable", "not_calculable", "unavailable"].includes(String(occupancy.rateStatus))
    || !["complete", "partial"].includes(String(occupancy.coverage)) || !Array.isArray(occupancy.reasons) || !Array.isArray(occupancy.professionals)) return fail();
  for (const row of occupancy.professionals) if (!record(row) || !resourceId(row.professionalId)
    || !nonnegative(row.offeredMinutes) || !nonnegative(row.occupiedMinutes) || !(row.occupancyRate === null || nonnegative(row.occupancyRate))) return fail();
  const currencies: string[] = [];
  for (const row of value.metrics.valuesByCurrency) {
    if (!record(row) || typeof row.currency !== "string" || !value.currencies.includes(row.currency) || currencies.includes(row.currency)) return fail();
    currencies.push(row.currency);
    for (const [key, basis] of [["scheduled", expectedBases.appointments], ["receivable", expectedBases.receivable],
      ["received", expectedBases.received], ["refunds", expectedBases.refunds]] as const) {
      const amount = row[key];
      if (!record(amount) || !cents(amount.knownAmountCents) || !Array.isArray(amount.reasons) || amount.temporalBasis !== basis
        || !(amount.status === "complete" && cents(amount.amountCents) && amount.amountCents === amount.knownAmountCents
          || amount.status === "partial" && amount.amountCents === null)) return fail();
      if (amount.status === "partial") partial = true;
    }
  }
  if (currencies.length !== value.currencies.length || value.dataStatus === "complete" && partial) return fail();
  return value as unknown as ServiceMetricsResponse;
}

export function serviceMetricsEndpoints(base: string, fetchImpl: typeof fetch) {
  return {
    serviceMetrics(profile: Pick<MerchantProfile, "id" | "user_id">) {
      if (!profile || !resourceId(profile.id) || !resourceId(profile.user_id)) throw new TypeError("authenticated_service_profile_required");
      const merchantId = profile.id;
      const path = `/merchants/${encodeURIComponent(merchantId)}/service-metrics`;
      return {
        async read(value: ServiceMetricsQuery, options: ServiceMetricsReadOptions = {}): Promise<ServiceMetricsResponse> {
          const query = validateServiceMetricsQuery(value);
          const search = new URLSearchParams(Object.entries(query));
          const result = await dashboardJson<unknown>(base, `${path}?${search}`, { method: "GET", signal: options.signal }, fetchImpl);
          return checkedResponse(result, merchantId, query);
        },
      };
    },
  };
}
export type ServiceMetricsClient = ReturnType<ReturnType<typeof serviceMetricsEndpoints>["serviceMetrics"]>;
