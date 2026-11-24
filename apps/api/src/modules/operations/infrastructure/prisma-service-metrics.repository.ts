import { Prisma, type PrismaClient } from "@prisma/client";

export interface ServiceMetricsScope {
  merchantId: string;
  from: Date;
  until: Date;
  professionalId?: string;
  categoryId?: string;
  pageSize?: number;
  maxRows?: number;
}
export interface ServiceMetricsFactPage<T> {
  items: T[];
  coverage: "complete" | "partial";
  nextCursor?: string;
}
export interface ServiceMetricsAppointmentFact {
  id: string; merchantId: string; professionalId: string; productId: string;
  categoryId: string | null; startsAt: Date; endsAt: Date; timeZone: string;
  operationalStatus: string; priceInCents: number; currency: string;
  orderId: string | null; orderUnitId: string | null; inCohort: boolean;
}
export interface ServiceMetricsPaymentFact {
  id: string; merchantId: string; appointmentId: string; professionalId: string;
  categoryId: string | null; mode: string; amountCents: number; currency: string;
  status: string; paymentIntentId: string | null; providerEvidence: Prisma.JsonValue;
  receivedAt: Date | null; requiresRegularization: boolean;
  localReceiptTotalCents: number; localReceiptCount: number; localReceiptCurrencyMismatch: boolean;
}
export interface ServiceMetricsReceiptFact {
  id: string; merchantId: string; appointmentPaymentId: string; appointmentId: string;
  professionalId: string; categoryId: string | null; amountCents: number;
  currency: string; receivedAt: Date;
}
export interface ServiceMetricsOrderLine {
  productType?: string; variantId?: string; lineId?: string;
  unitPriceCents?: number; quantity?: number;
  schedule?: { professionalId?: string; [key: string]: unknown };
  [key: string]: unknown;
}
export interface ServiceMetricsOnlineFact {
  id: string; merchantId: string; sessionId: string; status: string; currency: string;
  amountCents: number; approvedAmountCents: number | null;
  amountBreakdown: Prisma.JsonValue; statusHistory: Prisma.JsonValue;
  providerPaymentId: string | null;
  allocations: Array<{ id: string; appointmentId: string; professionalId: string; categoryId: string | null;
    amountCents: number; currency: string; providerEvidence: Prisma.JsonValue }>;
  orderSnapshots: Array<{ id: string; currency: string; lines: ServiceMetricsOrderLine[] }>;
  filterAllocationCoverage: "matched" | "unallocated" | "merchant";
}
/** Tenant financial evidence without an immutable service classification. The
 * amounts remain unknown for service metrics; they are never service income. */
export interface ServiceMetricsUnclassifiedPaidFact {
  id: string; merchantId: string; sessionId: string; status: string; currency: string;
  amountCents: number; approvedAmountCents: number | null; providerPaymentId: string | null;
  amountBreakdown: Prisma.JsonValue; statusHistory: Prisma.JsonValue;
  classification: "unproven";
  firstConfirmedSettlementOccurredAt: Date | null;
  firstConfirmedSettlementConfirmedAt: Date | null;
}
export interface ServiceMetricsSettlementFact {
  id: string; merchantId: string; paymentIntentId: string; sequence: number;
  status: string; currency: string; confirmedGrossCents: number | null;
  confirmedPlatformFeeCents: number | null; confirmedMerchantNetCents: number | null;
  confirmedProviderFeeCents: number | null; occurredAt: Date; confirmedAt: Date | null;
}
export interface ServiceMetricsSettlementEntryFact {
  id: string; merchantId: string; settlementId: string; paymentIntentId: string;
  entryKey: string; entryType: string; direction: string; status: string; currency: string;
  confirmedAmountCents: number | null; occurredAt: Date; confirmedAt: Date | null;
}
export interface ServiceMetricsRefundFact {
  id: string; merchantId: string; paymentIntentId: string; returnId: string; orderId: string;
  amountCents: number; currency: string; providerRefundId: string | null; status: string; processedAt: Date | null;
}
export interface ServiceMetricsAvailabilityFact {
  id: string; professionalId: string; weekday: number; startMinute: number; endMinute: number;
  validFrom: Date | null; validUntil: Date | null; timeZone: string;
}
export interface ServiceMetricsExceptionFact {
  id: string; professionalId: string; kind: string; startsAt: Date; endsAt: Date; timeZone: string;
}

/** A reader only. An order proves service classification, never attendance.
 * Monetary reduction belongs to T86: these are source identities, allocations
 * and observations, not additive income rows. Each collection is bounded and
 * reports truncation instead of converting incomplete evidence to zero. */
export class PrismaServiceMetricsRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async read(input: ServiceMetricsScope) {
    validateScope(input);
    const pageSize = input.pageSize ?? 200, maxRows = input.maxRows ?? 10_000;
    return this.prisma.$transaction(async tx => {
      await tx.$executeRaw`SET TRANSACTION READ ONLY`;
      const [clock] = await tx.$queryRaw<Array<{ asOf: Date }>>`SELECT transaction_timestamp() AS "asOf"`;
      if (!clock) throw new Error("service_metrics_clock_unavailable");
      const merchant = await tx.merchant.findUnique({ where: { id: input.merchantId },
        select: { businessMode: true, businessModeNeedsReview: true, businessModeSelectedAt: true } });
      if (!merchant || merchant.businessMode !== "services" || merchant.businessModeNeedsReview || !merchant.businessModeSelectedAt)
        throw new Error("service_metrics_business_mode_required");
      if (input.professionalId && !await tx.serviceProfessional.findFirst({
        where: { id: input.professionalId, merchantId: input.merchantId }, select: { id: true },
      })) throw new Error("service_metrics_filter_not_found");
      if (input.categoryId && !await tx.productCategory.findFirst({
        where: { id: input.categoryId, merchantId: input.merchantId }, select: { id: true },
      })) throw new Error("service_metrics_filter_not_found");

      const filter = appointmentFilter(input);
      const cohortRows = await tx.$queryRaw<Array<{ status: string; currency: string; count: bigint; nominalValueCents: bigint }>>(Prisma.sql`
        SELECT a.operational_status::text AS status, a.currency, count(*) AS count,
          sum(a.price_in_cents)::bigint AS "nominalValueCents"
        FROM service_appointments a JOIN products p ON p.id = a.product_id AND p.merchant_id = a.merchant_id
        WHERE a.merchant_id = ${input.merchantId} AND a.starts_at >= ${input.from} AND a.starts_at < ${input.until} ${filter}
        GROUP BY a.operational_status, a.currency ORDER BY a.operational_status::text, a.currency`);
      const cohort = cohortRows.map(row => ({ ...row, count: safeInteger(row.count), nominalValueCents: safeInteger(row.nominalValueCents) }));
      const batch = <T extends { id: string }>(query: (cursor: string, take: number) => Prisma.Sql) =>
        readBatches<T>(tx, query, pageSize, maxRows);

      const appointments = await batch<ServiceMetricsAppointmentFact>((cursor, take) => Prisma.sql`
        SELECT a.id, a.merchant_id AS "merchantId", a.professional_id AS "professionalId", a.product_id AS "productId",
          p.category_id AS "categoryId", a.starts_at AS "startsAt", a.ends_at AS "endsAt", a.time_zone AS "timeZone",
          a.operational_status::text AS "operationalStatus", a.price_in_cents AS "priceInCents", a.currency,
          a.order_id AS "orderId", a.order_unit_id AS "orderUnitId",
          (a.starts_at >= ${input.from} AND a.starts_at < ${input.until}) AS "inCohort"
        FROM service_appointments a JOIN products p ON p.id = a.product_id AND p.merchant_id = a.merchant_id
        WHERE a.merchant_id = ${input.merchantId} AND a.id > ${cursor} ${filter} AND (
          (a.starts_at >= ${input.from} AND a.starts_at < ${input.until}) OR
          (a.starts_at < ${input.until} AND a.ends_at > ${input.from}
            AND a.operational_status IN ('scheduled', 'in_service', 'completed', 'no_show')))
        ORDER BY a.id LIMIT ${take}`);
      type RawPaymentFact = Omit<ServiceMetricsPaymentFact, "localReceiptTotalCents" | "localReceiptCount"> & {
        localReceiptTotalCents: bigint; localReceiptCount: bigint;
      };
      const rawAppointmentPayments = await batch<RawPaymentFact>((cursor, take) => Prisma.sql`
        SELECT ap.id, ap.merchant_id AS "merchantId", ap.appointment_id AS "appointmentId", a.professional_id AS "professionalId",
          p.category_id AS "categoryId", ap.mode::text AS mode, ap.amount_cents AS "amountCents", ap.currency, ap.status::text AS status,
          ap.payment_intent_id AS "paymentIntentId", ap.provider_evidence AS "providerEvidence", ap.received_at AS "receivedAt",
          ap.requires_regularization AS "requiresRegularization", receipts.total AS "localReceiptTotalCents",
          receipts.count AS "localReceiptCount", receipts.mismatch AS "localReceiptCurrencyMismatch"
        FROM appointment_payments ap JOIN service_appointments a ON a.id = ap.appointment_id AND a.merchant_id = ap.merchant_id
        JOIN products p ON p.id = a.product_id AND p.merchant_id = a.merchant_id
        LEFT JOIN LATERAL (SELECT COALESCE(sum(r.amount_cents) FILTER (WHERE r.currency = ap.currency), 0)::bigint AS total,
          count(*) FILTER (WHERE r.currency = ap.currency) AS count,
          COALESCE(bool_or(r.currency <> ap.currency), false) AS mismatch
          FROM attendance_receipts r WHERE r.appointment_payment_id = ap.id AND r.merchant_id = ap.merchant_id
            AND r.received_at <= ${clock.asOf}) receipts ON true
        WHERE ap.merchant_id = ${input.merchantId} AND ap.id > ${cursor} ${filter}
          AND ((a.starts_at >= ${input.from} AND a.starts_at < ${input.until})
            OR (ap.received_at >= ${input.from} AND ap.received_at < ${input.until} AND ap.received_at <= ${clock.asOf}))
        ORDER BY ap.id LIMIT ${take}`);
      const appointmentPayments: ServiceMetricsFactPage<ServiceMetricsPaymentFact> = { ...rawAppointmentPayments,
        items: rawAppointmentPayments.items.map(row => ({ ...row,
          localReceiptTotalCents: safeInteger(row.localReceiptTotalCents), localReceiptCount: safeInteger(row.localReceiptCount) })) };
      const localReceipts = await batch<ServiceMetricsReceiptFact>((cursor, take) => Prisma.sql`
        SELECT r.id, r.merchant_id AS "merchantId", r.appointment_payment_id AS "appointmentPaymentId", a.id AS "appointmentId",
          a.professional_id AS "professionalId", p.category_id AS "categoryId", r.amount_cents AS "amountCents", r.currency,
          r.received_at AS "receivedAt"
        FROM attendance_receipts r JOIN appointment_payments ap ON ap.id = r.appointment_payment_id AND ap.merchant_id = r.merchant_id
        JOIN service_appointments a ON a.id = ap.appointment_id AND a.merchant_id = ap.merchant_id
        JOIN products p ON p.id = a.product_id AND p.merchant_id = a.merchant_id
        WHERE r.merchant_id = ${input.merchantId} AND r.id > ${cursor} ${filter}
          AND r.received_at >= ${input.from} AND r.received_at < ${input.until} AND r.received_at <= ${clock.asOf}
        ORDER BY r.id LIMIT ${take}`);

      // The independent online universe includes immutable completed service
      // orders without any appointment. The reducer receives all observations
      // needed to determine the first financial event in the requested period;
      // mutable updatedAt and appointment confirmation are not PSP clocks.
      const finance = financialSources(input);
      const onlinePayments = await batch<ServiceMetricsOnlineFact>((cursor, take) => Prisma.sql`${finance}
        SELECT i.id, i.merchant_id AS "merchantId", i.session_id AS "sessionId", i.status, i.currency,
          i.amount_cents AS "amountCents", i.approved_amount_cents AS "approvedAmountCents", i.provider_payment_id AS "providerPaymentId",
          i.amount_breakdown AS "amountBreakdown", i.status_history AS "statusHistory", i.allocations, i."orderSnapshots",
          i."filterAllocationCoverage"
        FROM selected_intents i WHERE i.id > ${cursor} ORDER BY i.id LIMIT ${take}`);
      // Approval is durable before its order consumer runs. Unclassified paid
      // facts cannot disappear as a complete zero, nor can a mutable current
      // cart classify their gross amount as services. Keep history/time evidence
      // so T86 can distinguish old approvals from missing event clocks.
      const unclassifiedPaidPayments = await batch<ServiceMetricsUnclassifiedPaidFact>((cursor, take) => Prisma.sql`${finance}
        SELECT pi.id, pi.merchant_id AS "merchantId", pi.session_id AS "sessionId", pi.status, pi.currency,
          pi.amount_cents AS "amountCents", pi.approved_amount_cents AS "approvedAmountCents", pi.provider_payment_id AS "providerPaymentId",
          pi.amount_breakdown AS "amountBreakdown", pi.status_history AS "statusHistory", 'unproven'::text AS classification,
          evidence.occurred_at AS "firstConfirmedSettlementOccurredAt", evidence.confirmed_at AS "firstConfirmedSettlementConfirmedAt"
        FROM payment_intents pi LEFT JOIN LATERAL (
          SELECT s.occurred_at, s.confirmed_at FROM payment_settlements s
          WHERE s.merchant_id = pi.merchant_id AND s.payment_intent_id = pi.id AND s.currency = pi.currency
            AND s.status = 'confirmed' AND s.confirmed_gross_cents > 0 AND s.created_at <= ${clock.asOf}
          ORDER BY s.occurred_at, s.id LIMIT 1
        ) evidence ON true
        WHERE pi.merchant_id = ${input.merchantId} AND pi.id > ${cursor}
          AND (pi.approved_amount_cents > 0 OR pi.status IN ('approved', 'refunded',
            'chargeback_pending', 'chargeback_disputed', 'chargeback_lost', 'chargeback_won')
            OR EXISTS (SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(pi.status_history) = 'array'
              THEN pi.status_history ELSE '[]'::jsonb END) history WHERE history->>'status' = 'approved'))
          AND NOT EXISTS (SELECT 1 FROM classified i WHERE i.id = pi.id AND i.merchant_id = pi.merchant_id)
        ORDER BY pi.id LIMIT ${take}`);
      const settlements = await batch<ServiceMetricsSettlementFact>((cursor, take) => Prisma.sql`${finance}
        SELECT s.id, s.merchant_id AS "merchantId", s.payment_intent_id AS "paymentIntentId", s.sequence, s.status, s.currency,
          s.confirmed_gross_cents AS "confirmedGrossCents", s.confirmed_platform_fee_cents AS "confirmedPlatformFeeCents",
          s.confirmed_merchant_net_cents AS "confirmedMerchantNetCents", s.confirmed_provider_fee_cents AS "confirmedProviderFeeCents",
          s.occurred_at AS "occurredAt", s.confirmed_at AS "confirmedAt"
        FROM payment_settlements s JOIN selected_intents i ON i.id = s.payment_intent_id AND i.merchant_id = s.merchant_id
        WHERE s.merchant_id = ${input.merchantId} AND s.id > ${cursor} AND s.created_at <= ${clock.asOf}
        ORDER BY s.id LIMIT ${take}`);
      const settlementEntries = await batch<ServiceMetricsSettlementEntryFact>((cursor, take) => Prisma.sql`${finance}
        SELECT e.id, e.merchant_id AS "merchantId", e.settlement_id AS "settlementId", s.payment_intent_id AS "paymentIntentId",
          e.entry_key AS "entryKey", e.entry_type AS "entryType", e.direction, e.status, e.currency,
          e.confirmed_amount_cents AS "confirmedAmountCents", e.occurred_at AS "occurredAt", e.confirmed_at AS "confirmedAt"
        FROM payment_settlement_entries e JOIN payment_settlements s ON s.id = e.settlement_id AND s.merchant_id = e.merchant_id
        JOIN selected_intents i ON i.id = s.payment_intent_id AND i.merchant_id = s.merchant_id
        WHERE e.merchant_id = ${input.merchantId} AND e.id > ${cursor} AND e.created_at <= ${clock.asOf}
        ORDER BY e.id LIMIT ${take}`);
      const refunds = await batch<ServiceMetricsRefundFact>((cursor, take) => Prisma.sql`${finance}
        SELECT f.id, r.merchant_id AS "merchantId", f.payment_intent_id AS "paymentIntentId", r.id AS "returnId",
          r.order_id AS "orderId", f.amount_in_cents AS "amountCents", i.currency,
          f.provider_refund_id AS "providerRefundId", f.status, f.processed_at AS "processedAt"
        FROM return_refunds f JOIN returns r ON r.id = f.return_id
        JOIN selected_intents i ON i.id = f.payment_intent_id AND i.merchant_id = r.merchant_id
        JOIN completed_orders o ON o.id = r.order_id AND o.merchant_id = r.merchant_id
          AND o.session_id = i.session_id AND o.external_order_id = i.provider_payment_id
        WHERE r.merchant_id = ${input.merchantId} AND f.id > ${cursor} AND f.created_at <= ${clock.asOf}
        ORDER BY f.id LIMIT ${take}`);
      const professionalFilter = Prisma.sql`
        ${input.professionalId ? Prisma.sql`AND v.professional_id = ${input.professionalId}` : Prisma.empty}
        ${input.categoryId ? Prisma.sql`AND EXISTS (SELECT 1 FROM professional_services ps
          JOIN products p ON p.id = ps.product_id AND p.merchant_id = ps.merchant_id
          WHERE ps.merchant_id = v.merchant_id AND ps.professional_id = v.professional_id AND p.category_id = ${input.categoryId})` : Prisma.empty}`;
      const availability = await batch<ServiceMetricsAvailabilityFact>((cursor, take) => Prisma.sql`
        SELECT v.id, v.professional_id AS "professionalId", v.weekday, v.start_minute AS "startMinute", v.end_minute AS "endMinute",
          v.valid_from AS "validFrom", v.valid_until AS "validUntil", v.time_zone AS "timeZone"
        FROM professional_availability v WHERE v.merchant_id = ${input.merchantId} AND v.id > ${cursor} AND v.is_active
          AND (v.valid_from IS NULL OR v.valid_from < ${input.until}) AND (v.valid_until IS NULL OR v.valid_until > ${input.from})
          ${professionalFilter} ORDER BY v.id LIMIT ${take}`);
      const exceptions = await batch<ServiceMetricsExceptionFact>((cursor, take) => Prisma.sql`
        SELECT v.id, v.professional_id AS "professionalId", v.kind::text AS kind,
          v.starts_at AS "startsAt", v.ends_at AS "endsAt", v.time_zone AS "timeZone"
        FROM availability_exceptions v WHERE v.merchant_id = ${input.merchantId} AND v.id > ${cursor} AND v.is_active
          AND v.starts_at < ${input.until} AND v.ends_at > ${input.from} ${professionalFilter}
        ORDER BY v.id LIMIT ${take}`);

      return { merchantId: input.merchantId, period: { from: input.from, until: input.until },
        filters: { professionalId: input.professionalId ?? null, categoryId: input.categoryId ?? null },
        timeZone: "America/Sao_Paulo" as const, asOf: clock.asOf, snapshotBasis: "current_repeatable_read" as const,
        categoryBasis: "current_product_category" as const,
        financialTimeBasis: "retained_evidence_requires_reduction" as const,
        financialClassificationCoverage: unclassifiedPaidPayments.items.length || unclassifiedPaidPayments.coverage === "partial"
          ? "partial" as const : "complete" as const,
        localReceiptTimeBasis: "operator_recorded_received_at" as const,
        refundCoverage: "requires_financial_evidence" as const,
        cohort, appointments, appointmentPayments, localReceipts, onlinePayments, unclassifiedPaidPayments,
        settlements, settlementEntries, refunds, availability, exceptions };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, maxWait: 5_000, timeout: 30_000 });
  }
}

function validateScope(input: ServiceMetricsScope): void {
  if (!input || typeof input.merchantId !== "string" || !input.merchantId
    || !(input.from instanceof Date) || !(input.until instanceof Date)
    || !Number.isFinite(input.from.getTime()) || !Number.isFinite(input.until.getTime()) || input.from >= input.until
    || [input.professionalId, input.categoryId].some(value => value !== undefined && (typeof value !== "string" || !value))
    || (input.pageSize !== undefined && (!Number.isSafeInteger(input.pageSize) || input.pageSize < 1 || input.pageSize > 500))
    || (input.maxRows !== undefined && (!Number.isSafeInteger(input.maxRows) || input.maxRows < 1 || input.maxRows > 10_000)))
    throw new Error("service_metrics_scope_invalid");
}
function safeInteger(value: bigint): number {
  const result = Number(value);
  if (!Number.isSafeInteger(result)) throw new Error("service_metrics_amount_overflow");
  return result;
}
function appointmentFilter(input: ServiceMetricsScope): Prisma.Sql {
  return Prisma.sql`${input.professionalId ? Prisma.sql`AND a.professional_id = ${input.professionalId}` : Prisma.empty}
    ${input.categoryId ? Prisma.sql`AND p.category_id = ${input.categoryId}` : Prisma.empty}`;
}
async function readBatches<T extends { id: string }>(tx: Prisma.TransactionClient,
  query: (cursor: string, take: number) => Prisma.Sql, pageSize: number, maxRows: number): Promise<ServiceMetricsFactPage<T>> {
  const items: T[] = [];
  let cursor = "";
  while (items.length < maxRows) {
    const remaining = Math.min(pageSize, maxRows - items.length);
    const rows = await tx.$queryRaw<T[]>(query(cursor, remaining + 1));
    const accepted = rows.slice(0, remaining);
    items.push(...accepted);
    if (rows.length <= remaining) return { items, coverage: "complete" };
    const last = accepted.at(-1);
    if (!last || last.id <= cursor) throw new Error("service_metrics_cursor_invalid");
    cursor = last.id;
  }
  return { items, coverage: "partial", nextCursor: cursor };
}

function financialSources(input: ServiceMetricsScope): Prisma.Sql {
  const filtered = input.professionalId !== undefined || input.categoryId !== undefined;
  const allocationMatch = Prisma.sql`
    ${input.professionalId ? Prisma.sql`AND ap->>'professionalId' = ${input.professionalId}` : Prisma.empty}
    ${input.categoryId ? Prisma.sql`AND ap->>'categoryId' = ${input.categoryId}` : Prisma.empty}`;
  const lineMatch = Prisma.sql`
    ${input.professionalId ? Prisma.sql`AND line->'schedule'->>'professionalId' = ${input.professionalId}` : Prisma.empty}
    ${input.categoryId ? Prisma.sql`AND p.category_id = ${input.categoryId}` : Prisma.empty}`;
  const lineUnknown = Prisma.sql`(${input.professionalId ? Prisma.sql`NULLIF(line->'schedule'->>'professionalId', '') IS NULL` : Prisma.sql`false`}
    OR ${input.categoryId ? Prisma.sql`p.id IS NULL` : Prisma.sql`false`})`;
  // Completed-order line classification is immutable. A mutable checkout cart,
  // today's professional profile, or a regularization notice is insufficient.
  return Prisma.sql`WITH service_intents AS (
    SELECT pi.*, COALESCE((SELECT jsonb_agg(jsonb_build_object('id', ap.id, 'appointmentId', a.id,
      'professionalId', a.professional_id, 'categoryId', p.category_id, 'amountCents', ap.amount_cents,
      'currency', ap.currency, 'providerEvidence', ap.provider_evidence) ORDER BY ap.id)
      FROM appointment_payments ap JOIN service_appointments a ON a.id = ap.appointment_id AND a.merchant_id = ap.merchant_id
      JOIN products p ON p.id = a.product_id AND p.merchant_id = a.merchant_id
      WHERE ap.merchant_id = pi.merchant_id AND ap.payment_intent_id = pi.id AND ap.mode = 'online'), '[]'::jsonb) AS allocations,
      COALESCE((SELECT jsonb_agg(jsonb_build_object('id', o.id, 'currency', o.currency, 'lines', o.line_items_json) ORDER BY o.id)
      FROM completed_orders o WHERE o.merchant_id = pi.merchant_id AND o.session_id = pi.session_id
        AND o.external_order_id = pi.provider_payment_id
        AND EXISTS (SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(o.line_items_json) = 'array'
          THEN o.line_items_json ELSE '[]'::jsonb END) line WHERE line->>'productType' = 'service')), '[]'::jsonb) AS "orderSnapshots"
    FROM payment_intents pi WHERE pi.merchant_id = ${input.merchantId}
  ), classified AS (
    SELECT i.*, ${filtered ? Prisma.sql`EXISTS (SELECT 1 FROM jsonb_array_elements(i.allocations) ap WHERE true ${allocationMatch})
      OR EXISTS (SELECT 1 FROM jsonb_array_elements(i."orderSnapshots") ord
        CROSS JOIN LATERAL jsonb_array_elements(ord->'lines') line
        LEFT JOIN product_variants pv ON pv.id = line->>'variantId'
        LEFT JOIN products p ON p.id = pv.product_id AND p.merchant_id = i.merchant_id
        WHERE line->>'productType' = 'service' ${lineMatch})` : Prisma.sql`true`} AS matched,
      ${filtered ? Prisma.sql`EXISTS (SELECT 1 FROM jsonb_array_elements(i."orderSnapshots") ord
        CROSS JOIN LATERAL jsonb_array_elements(ord->'lines') line
        LEFT JOIN product_variants pv ON pv.id = line->>'variantId'
        LEFT JOIN products p ON p.id = pv.product_id AND p.merchant_id = i.merchant_id
        WHERE line->>'productType' = 'service' AND ${lineUnknown})` : Prisma.sql`false`} AS unallocated
    FROM service_intents i WHERE jsonb_array_length(i.allocations) > 0 OR jsonb_array_length(i."orderSnapshots") > 0
  ), selected_intents AS (
    SELECT i.*, CASE WHEN ${!filtered} THEN 'merchant' WHEN i.unallocated THEN 'unallocated' ELSE 'matched' END AS "filterAllocationCoverage"
    FROM classified i WHERE i.matched OR i.unallocated
  )`;
}
