/** Public service dashboard contract. No raw payment, customer or provenance
 * records belong here. Currency buckets are never added across currencies. */
export type ServiceMetricsDataStatus = "complete" | "partial" | "unavailable";
export type ServiceMetricsAppointmentState = "pending" | "scheduled" | "in_service" | "completed" | "no_show" | "cancelled";
export interface ServiceMetricsMoney {
  status: "complete" | "partial";
  knownAmountCents: number;
  amountCents: number | null;
  reasons: string[];
  temporalBasis: string;
}
export interface ServiceMetricsSummary {
  byStatus: Record<ServiceMetricsAppointmentState, number>;
  occupancy: {
    offeredMinutes: number | null;
    occupiedMinutes: number | null;
    knownOfferedMinutes: number;
    knownOccupiedMinutes: number;
    occupancyRate: number | null;
    rateStatus: "calculable" | "not_calculable" | "unavailable";
    coverage: "complete" | "partial";
    reasons: string[];
    professionals: Array<{ professionalId: string; offeredMinutes: number; occupiedMinutes: number; occupancyRate: number | null }>;
  };
  valuesByCurrency: Array<{ currency: string; scheduled: ServiceMetricsMoney; receivable: ServiceMetricsMoney;
    received: ServiceMetricsMoney; refunds: ServiceMetricsMoney }>;
  financialCoverage: "complete" | "partial";
}
export interface ServiceMetricsResponse {
  businessMode: "services";
  merchantId: string;
  timeZone: "America/Sao_Paulo";
  /** Set only when the response has exactly one currency bucket. */
  currency: string | null;
  currencies: string[];
  asOf: string | null;
  period: { fromDate: string; toDate: string; from: string; until: string; bounds: "[from,until)" };
  filters: { professionalId: string | null; categoryId: string | null };
  dataStatus: ServiceMetricsDataStatus;
  temporalBases: {
    appointments: "appointment_starts_at";
    occupancy: "overlap_clipped_to_period";
    receivable: "cohort_obligation_as_of";
    received: "recorded_approval_or_confirmed_observation_and_local_receipt";
    refunds: "refund_processed_at";
  };
  metrics: ServiceMetricsSummary | null;
}
