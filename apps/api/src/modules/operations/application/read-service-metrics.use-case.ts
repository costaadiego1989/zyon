import { BadRequestException, ForbiddenException, HttpException, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import type { ServiceMetricsResponse } from "@zyon/shared-types";
import { addBusinessDays, businessDateKey, businessDayStart, DASHBOARD_TIME_ZONE } from "../../../shared/analytics/business-period.js";
import { assertServiceAdministration, type ServiceActor } from "../../../shared/bookings/service-business-access.js";
import { calculateServiceMetrics, type ServiceMetricsSnapshot } from "../domain/service-metrics.js";
import type { ServiceMetricsScope } from "../infrastructure/prisma-service-metrics.repository.js";

interface MetricsReader { read(input: ServiceMetricsScope): Promise<ServiceMetricsSnapshot | null> }
const invalidQuery = () => new BadRequestException("invalid_service_metrics_query");
const bases = {
  appointments: "appointment_starts_at", occupancy: "overlap_clipped_to_period", receivable: "cohort_obligation_as_of",
  received: "recorded_approval_or_confirmed_observation_and_local_receipt", refunds: "refund_processed_at",
} as const;

export function parseServiceMetricsQuery(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw invalidQuery();
  const query = value as Record<string, unknown>;
  if (Object.keys(query).some(key => !["fromDate", "toDate", "professionalId", "categoryId"].includes(key))) throw invalidQuery();
  const civil = (value: unknown): { text: string; epoch: number } => {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw invalidQuery();
    const epoch = Date.parse(value + "T00:00:00Z");
    if (!Number.isFinite(epoch) || new Date(epoch).toISOString().slice(0, 10) !== value) throw invalidQuery();
    return { text: value, epoch };
  };
  const fromDate = civil(query.fromDate), toDate = civil(query.toDate);
  if (toDate.epoch < fromDate.epoch || toDate.epoch - fromDate.epoch >= 31 * 86_400_000) throw invalidQuery();
  for (const key of ["professionalId", "categoryId"]) {
    const id = query[key];
    if (id !== undefined && (typeof id !== "string" || !id || id.trim() !== id || id.length > 191 || /[\u0000-\u001f\u007f]/.test(id))) throw invalidQuery();
  }
  const nextDate = addBusinessDays(toDate.text, 1);
  const from = businessDayStart(fromDate.text), until = businessDayStart(nextDate);
  if (!Number.isFinite(from.getTime()) || !Number.isFinite(until.getTime()) || from >= until
    || businessDateKey(from) !== fromDate.text || businessDateKey(until) !== nextDate) throw invalidQuery();
  return { fromDate: fromDate.text, toDate: toDate.text, from, until,
    ...(query.professionalId === undefined ? {} : { professionalId: query.professionalId as string }),
    ...(query.categoryId === undefined ? {} : { categoryId: query.categoryId as string }) };
}

/** Canonical human actor comes from the authenticated controller, never query
 * or body. Native access proof still belongs to the served HTTP/DB gate. */
export class ReadServiceMetricsUseCase {
  constructor(private readonly prisma: PrismaClient, private readonly reader: MetricsReader) {}

  async execute(actor: ServiceActor, query: unknown): Promise<ServiceMetricsResponse> {
    const scopedActor: ServiceActor = { merchantId: actor.merchantId, userId: actor.userId, role: actor.role };
    const input = parseServiceMetricsQuery(query);
    const envelope: Pick<ServiceMetricsResponse, "businessMode" | "merchantId" | "timeZone" | "period" | "filters" | "temporalBases"> = {
      businessMode: "services" as const, merchantId: scopedActor.merchantId, timeZone: DASHBOARD_TIME_ZONE,
      period: { fromDate: input.fromDate, toDate: input.toDate, from: input.from.toISOString(), until: input.until.toISOString(), bounds: "[from,until)" as const },
      filters: { professionalId: input.professionalId ?? null, categoryId: input.categoryId ?? null }, temporalBases: bases,
    };
    try {
      // The canonical default permission is owner/admin. The read variant of
      // this helper also admits staff and is deliberately not used here.
      await this.prisma.$transaction(tx => assertServiceAdministration(tx, scopedActor), { isolationLevel: "RepeatableRead" });
      const snapshot = await this.reader.read({ merchantId: scopedActor.merchantId, from: input.from, until: input.until,
        ...(input.professionalId ? { professionalId: input.professionalId } : {}),
        ...(input.categoryId ? { categoryId: input.categoryId } : {}), pageSize: 200, maxRows: 10000 });
      if (!snapshot) return { ...envelope, currency: null, currencies: [], asOf: null, dataStatus: "unavailable", metrics: null };
      if (snapshot.merchantId !== scopedActor.merchantId || snapshot.timeZone !== DASHBOARD_TIME_ZONE
        || snapshot.period.from.getTime() !== input.from.getTime() || snapshot.period.until.getTime() !== input.until.getTime()
        || snapshot.filters.professionalId !== envelope.filters.professionalId || snapshot.filters.categoryId !== envelope.filters.categoryId)
        throw new Error("service_metrics_snapshot_scope_mismatch");
      const reduced = calculateServiceMetrics(snapshot);
      if (!reduced.metrics) return { ...envelope, currency: null, currencies: [], asOf: null, dataStatus: "unavailable", metrics: null };
      const currencies = reduced.metrics.valuesByCurrency.map(row => row.currency);
      // Explicit projection: no raw financial facts, actor identity, order
      // snapshots, provider IDs, customer data or provenance can escape.
      return { ...envelope, currency: currencies.length === 1 ? currencies[0]! : null, currencies,
        asOf: snapshot.asOf.toISOString(), dataStatus: reduced.dataStatus,
        metrics: { byStatus: reduced.metrics.byStatus, occupancy: reduced.metrics.occupancy,
          valuesByCurrency: reduced.metrics.valuesByCurrency, financialCoverage: reduced.metrics.financialCoverage } };
    } catch (error) {
      if (error instanceof HttpException) throw error;
      if (error instanceof Error && error.message === "service_metrics_filter_not_found") throw new NotFoundException("service_metrics_filter_not_found");
      if (error instanceof Error && error.message === "service_metrics_business_mode_required") throw new ForbiddenException("services_mode_required");
      throw new ServiceUnavailableException("service_metrics_unavailable", { cause: error });
    }
  }
}
