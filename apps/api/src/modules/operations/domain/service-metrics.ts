import { isDeepStrictEqual } from "node:util";
import { serviceStartInstant } from "../../catalog/domain/services/service-schedule.js";
import { professionalLocalDate } from "../../catalog/domain/services/professional-availability.js";
import { assertPaymentAmount, type PaymentAmountBreakdown } from "../../payment/domain/payment-amount.js";
import type { PrismaServiceMetricsRepository, ServiceMetricsOnlineFact } from "../infrastructure/prisma-service-metrics.repository.js";

export type ServiceMetricsSnapshot = Awaited<ReturnType<PrismaServiceMetricsRepository["read"]>>;
type Range = { start: number; end: number };
export interface ServiceMetricInterval { professionalId: string; startsAt: Date; endsAt: Date }
interface OccupancyInput {
  period: { from: Date; until: Date };
  offered: readonly ServiceMetricInterval[];
  blocks: readonly ServiceMetricInterval[];
  appointments: readonly (ServiceMetricInterval & { id: string; status: string })[];
}
const states = ["pending", "scheduled", "in_service", "completed", "no_show", "cancelled"] as const;
const confirmed = new Set<string>(["scheduled", "in_service", "completed", "no_show"]);
const paidStates = new Set(["approved", "refunded", "chargeback_pending", "chargeback_disputed", "chargeback_lost", "chargeback_won"]);
const day = 86_400_000;
const invalid = () => new Error("service_metrics_invalid");
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
function instant(value: unknown): number {
  const result = value instanceof Date ? value.getTime() : typeof value === "string" ? Date.parse(value) : NaN;
  if (!Number.isFinite(result)) throw invalid();
  return result;
}
function integer(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw invalid();
  return value;
}
function add(a: number, b: number): number {
  const value = a + b;
  if (!Number.isSafeInteger(value)) throw new Error("service_metrics_overflow");
  return value;
}
function range(start: unknown, end: unknown): Range {
  const value = { start: instant(start), end: instant(end) };
  if (value.start >= value.end) throw invalid();
  return value;
}
function union(values: readonly Range[]): Range[] {
  const result: Range[] = [];
  for (const value of [...values].sort((a, b) => a.start - b.start || a.end - b.end)) {
    const previous = result.at(-1);
    if (previous && previous.end >= value.start) previous.end = Math.max(previous.end, value.end);
    else result.push({ ...value });
  }
  return result;
}
function duration(values: readonly Range[]): number { return values.reduce((sum, value) => add(sum, value.end - value.start), 0); }
function unique<T extends { id: string }>(values: readonly T[], kind: string): T[] {
  const found = new Map<string, T>();
  for (const value of values) {
    if (!value || typeof value.id !== "string" || !value.id) throw invalid();
    const previous = found.get(value.id);
    if (previous && !isDeepStrictEqual(previous, value)) throw new Error("service_metrics_conflicting_" + kind);
    if (!previous) found.set(value.id, value);
  }
  return [...found.values()];
}

/** Confirmed elapsed minutes divided by unique offered elapsed minutes. All
 * inputs retain their historical instants; no attendance or clock inference. */
export function calculateServiceOccupancy(input: OccupancyInput) {
  const period = range(input.period.from, input.period.until);
  const groups = new Map<string, { offered: Range[]; blocked: Range[]; occupied: Range[] }>();
  const append = (value: ServiceMetricInterval, kind: "offered" | "blocked" | "occupied") => {
    if (typeof value.professionalId !== "string" || !value.professionalId) throw invalid();
    const parsed = range(value.startsAt, value.endsAt), clipped = { start: Math.max(parsed.start, period.start), end: Math.min(parsed.end, period.end) };
    if (clipped.start >= clipped.end) return;
    if (!groups.has(value.professionalId)) groups.set(value.professionalId, { offered: [], blocked: [], occupied: [] });
    groups.get(value.professionalId)![kind].push(clipped);
  };
  input.offered.forEach(value => append(value, "offered"));
  input.blocks.forEach(value => append(value, "blocked"));
  for (const value of unique(input.appointments, "appointment")) {
    if (!(states as readonly string[]).includes(value.status)) throw invalid();
    range(value.startsAt, value.endsAt);
    if (confirmed.has(value.status)) append(value, "occupied");
  }
  const professionals = [...groups].sort(([a], [b]) => a.localeCompare(b)).map(([professionalId, group]) => {
    const offered = union(group.offered), blocked = union(group.blocked);
    let available = duration(offered);
    for (const capacity of offered) for (const block of blocked)
      available -= Math.max(0, Math.min(capacity.end, block.end) - Math.max(capacity.start, block.start));
    const occupied = duration(union(group.occupied));
    return { professionalId, offeredMinutes: available / 60_000, occupiedMinutes: occupied / 60_000,
      occupancyRate: available ? occupied / available : null };
  });
  const offeredMinutes = professionals.reduce((sum, row) => sum + row.offeredMinutes, 0);
  const occupiedMinutes = professionals.reduce((sum, row) => sum + row.occupiedMinutes, 0);
  return { offeredMinutes, occupiedMinutes, occupancyRate: offeredMinutes ? occupiedMinutes / offeredMinutes : null,
    rateStatus: offeredMinutes ? "calculable" as const : "not_calculable" as const, professionals };
}

type Tracker = { known: number; reasons: Set<string> };
const tracker = (): Tracker => ({ known: 0, reasons: new Set() });
function amount(value: Tracker, basis: string) {
  return { status: value.reasons.size ? "partial" as const : "complete" as const, knownAmountCents: value.known,
    amountCents: value.reasons.size ? null : value.known, reasons: [...value.reasons].sort(), temporalBasis: basis };
}
type Timing = { kind: "none" } | { kind: "unknown" } | { kind: "known"; at: number };
function recordedTime(value: unknown): number | undefined {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return undefined;
  const civil = Date.parse(value.slice(0, 10) + "T00:00:00Z"), parsed = Date.parse(value);
  if (!Number.isFinite(civil) || new Date(civil).toISOString().slice(0, 10) !== value.slice(0, 10) || !Number.isFinite(parsed)) return undefined;
  return parsed;
}
function approvalTiming(history: unknown, isPaid: boolean, observations: readonly { occurredAt: Date }[]): Timing {
  const times: number[] = [];
  let malformed = !Array.isArray(history);
  for (const row of Array.isArray(history) ? history : []) if (record(row) && row.status === "approved") {
    const value = recordedTime(row.occurredAt);
    if (value !== undefined) times.push(value); else malformed = true;
  }
  if (malformed) return { kind: "unknown" };
  if (times.length) return { kind: "known", at: times.reduce((a, b) => Math.min(a, b), Infinity) };
  if (observations.length) return { kind: "known", at: observations.reduce((value, row) => Math.min(value, instant(row.occurredAt)), Infinity) };
  return { kind: isPaid ? "unknown" : "none" };
}

function recurringCapacity(snapshot: ServiceMetricsSnapshot) {
  const offered: ServiceMetricInterval[] = [], blocks: ServiceMetricInterval[] = [], reasons = new Set<string>();
  const period = range(snapshot.period.from, snapshot.period.until);
  for (const row of unique(snapshot.availability.items, "availability")) {
    integer(row.weekday); integer(row.startMinute); integer(row.endMinute);
    if (row.weekday > 6 || row.startMinute >= row.endMinute || row.endMinute > 1440) throw invalid();
    let first: number, last: number;
    try {
      first = Date.parse(professionalLocalDate(snapshot.period.from, row.timeZone) + "T00:00:00Z");
      last = Date.parse(professionalLocalDate(new Date(period.end - 1), row.timeZone) + "T00:00:00Z");
    } catch { reasons.add("availability_timezone_unresolved"); continue; }
    for (let date = first; date <= last; date += day) if (new Date(date).getUTCDay() === row.weekday) {
      const boundary = (minute: number) => serviceStartInstant(new Date(date + (minute === 1440 ? day : 0)).toISOString().slice(0, 10),
        minute === 1440 ? "00:00" : `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`, row.timeZone);
      const start = boundary(row.startMinute), end = boundary(row.endMinute);
      if (!start || !end) { reasons.add("availability_boundary_unresolved"); continue; }
      const clipped = { start: Math.max(start.getTime(), row.validFrom ? instant(row.validFrom) : -Infinity),
        end: Math.min(end.getTime(), row.validUntil ? instant(row.validUntil) : Infinity) };
      if (clipped.start < clipped.end) offered.push({ professionalId: row.professionalId, startsAt: new Date(clipped.start), endsAt: new Date(clipped.end) });
    }
  }
  for (const row of unique(snapshot.exceptions.items, "exception")) {
    if (row.kind === "one_off") offered.push(row);
    else if (row.kind === "block") blocks.push(row);
    else throw invalid();
  }
  if ([snapshot.availability, snapshot.exceptions, snapshot.appointments].some(page => page.coverage !== "complete"))
    reasons.add("capacity_source_truncated");
  const known = calculateServiceOccupancy({ period: snapshot.period, offered, blocks,
    appointments: snapshot.appointments.items.map(row => ({ ...row, status: row.operationalStatus })) });
  return { ...known, knownOfferedMinutes: known.offeredMinutes, knownOccupiedMinutes: known.occupiedMinutes,
    offeredMinutes: reasons.size ? null : known.offeredMinutes, occupiedMinutes: reasons.size ? null : known.occupiedMinutes,
    occupancyRate: reasons.size ? null : known.occupancyRate,
    rateStatus: reasons.size ? "unavailable" as const : known.rateStatus,
    coverage: reasons.size ? "partial" as const : "complete" as const, reasons: [...reasons].sort() };
}

/** No IO, current clock, mutable cart, proportional discount allocation or
 * payment-state-driven attendance. Unavailable source is distinct from empty. */
export function calculateServiceMetrics(snapshot: ServiceMetricsSnapshot | null) {
  if (!snapshot) return { dataStatus: "unavailable" as const, metrics: null };
  const window = range(snapshot.period.from, snapshot.period.until), asOf = instant(snapshot.asOf);
  const inPeriod = (time: number) => time >= window.start && time < window.end && time <= asOf;
  const buckets = new Map<string, { scheduled: Tracker; receivable: Tracker; received: Tracker; refunds: Tracker }>();
  const bucket = (currency: string) => {
    if (!/^[A-Z]{3}$/.test(currency)) throw invalid();
    if (!buckets.has(currency)) buckets.set(currency, { scheduled: tracker(), receivable: tracker(), received: tracker(), refunds: tracker() });
    return buckets.get(currency)!;
  };
  const own = (row: { merchantId: string }) => { if (row.merchantId !== snapshot.merchantId) throw new Error("service_metrics_tenant_mismatch"); };
  if (typeof snapshot.merchantId !== "string" || !snapshot.merchantId) throw invalid();
  for (const page of [snapshot.appointments, snapshot.appointmentPayments, snapshot.localReceipts, snapshot.onlinePayments,
    snapshot.unclassifiedPaidPayments, snapshot.settlements, snapshot.settlementEntries, snapshot.refunds]) page.items.forEach(own);
  const byStatus: Record<typeof states[number], number> = { pending: 0, scheduled: 0, in_service: 0, completed: 0, no_show: 0, cancelled: 0 };
  const cohortKeys = new Set<string>();
  for (const row of snapshot.cohort) {
    if (!(states as readonly string[]).includes(row.status)) throw invalid();
    const key = row.status + ":" + row.currency;
    if (cohortKeys.has(key)) throw new Error("service_metrics_conflicting_cohort");
    cohortKeys.add(key);
    byStatus[row.status as typeof states[number]] = add(byStatus[row.status as typeof states[number]], integer(row.count));
    const values = bucket(row.currency);
    if (confirmed.has(row.status)) values.scheduled.known = add(values.scheduled.known, integer(row.nominalValueCents));
  }
  const appointments = unique(snapshot.appointments.items, "appointment"), payments = unique(snapshot.appointmentPayments.items, "payment");
  const online = unique(snapshot.onlinePayments.items, "intent"), receipts = unique(snapshot.localReceipts.items, "receipt");
  const settlements = unique(snapshot.settlements.items, "settlement"), refunds = unique(snapshot.refunds.items, "refund");
  unique(snapshot.settlementEntries.items, "settlement_entry");
  const filtered = snapshot.filters.professionalId !== null || snapshot.filters.categoryId !== null;
  const rowMatches = (row: { professionalId: string; categoryId: string | null }) =>
    (!snapshot.filters.professionalId || row.professionalId === snapshot.filters.professionalId)
      && (!snapshot.filters.categoryId || row.categoryId === snapshot.filters.categoryId);
  const funded = new Set<string>(), refundWholeScope = new Set<string>(), onlineAllocationIds = new Set<string>();
  const providerIds = new Map<string, string>();
  for (const payment of online) {
    integer(payment.amountCents);
    if (payment.approvedAmountCents !== null) integer(payment.approvedAmountCents);
    const values = bucket(payment.currency);
    if (payment.providerPaymentId) {
      const previous = providerIds.get(payment.providerPaymentId);
      if (previous && previous !== payment.id) throw new Error("service_metrics_conflicting_intent");
      providerIds.set(payment.providerPaymentId, payment.id);
    }
    payment.allocations.forEach(row => onlineAllocationIds.add(row.id));
    const observations = settlements.filter(row => row.paymentIntentId === payment.id && row.currency === payment.currency
      && row.status === "confirmed" && row.confirmedGrossCents !== null && integer(row.confirmedGrossCents) > 0);
    const timing = approvalTiming(payment.statusHistory, paidStates.has(payment.status) || (payment.approvedAmountCents ?? 0) > 0, observations);
    const proof = serviceValue(payment, snapshot.filters);
    if (proof.fullyFunded && timing.kind !== "none") funded.add(payment.id);
    if (proof.wholeScope) refundWholeScope.add(payment.id);
    if (timing.kind === "none") continue;
    if (timing.kind === "unknown") { values.received.reasons.add("approval_time_unknown"); continue; }
    if (!inPeriod(timing.at)) continue;
    if (proof.reason) values.received.reasons.add(proof.reason);
    values.received.known = add(values.received.known, proof.known);
  }
  for (const receipt of receipts) {
    integer(receipt.amountCents);
    const values = bucket(receipt.currency);
    if (!inPeriod(instant(receipt.receivedAt)) || !rowMatches(receipt)) continue;
    if (onlineAllocationIds.has(receipt.appointmentPaymentId)
      || payments.some(row => row.id === receipt.appointmentPaymentId && (row.paymentIntentId || row.mode === "online"))) {
      values.received.reasons.add("receipt_online_allocation_conflict"); continue;
    }
    values.received.known = add(values.received.known, receipt.amountCents);
  }
  for (const payment of payments) {
    integer(payment.amountCents);
    const values = bucket(payment.currency), appointment = appointments.find(row => row.id === payment.appointmentId);
    if (appointment?.inCohort && confirmed.has(appointment.operationalStatus) && rowMatches(payment)) {
      const linked = online.find(row => row.id === payment.paymentIntentId);
      if (payment.mode === "online" && payment.paymentIntentId && funded.has(payment.paymentIntentId)) {
        // A fully funded canonical intent covers its nominal unit obligations
        // even when its effective discount has no per-professional allocation.
      } else if (linked && record(linked.amountBreakdown) && typeof linked.amountBreakdown.discountCents === "number"
        && linked.amountBreakdown.discountCents > 0) values.receivable.reasons.add("obligation_discount_allocation_unproven");
      else if (payment.localReceiptCurrencyMismatch || !Number.isSafeInteger(payment.localReceiptTotalCents)
        || !Number.isSafeInteger(payment.localReceiptCount) || payment.localReceiptTotalCents < 0 || payment.localReceiptCount < 0
        || payment.localReceiptTotalCents > payment.amountCents) values.receivable.reasons.add("receipt_balance_unproven");
      else if (payment.status === "pending" || payment.mode === "at_attendance" && payment.localReceiptTotalCents === payment.amountCents)
        values.receivable.known = add(values.receivable.known, payment.amountCents - payment.localReceiptTotalCents);
      else if (payment.status !== "cancelled") values.receivable.reasons.add("obligation_settlement_unproven");
    } else if (!appointment && snapshot.appointments.coverage !== "complete") values.receivable.reasons.add("cohort_detail_truncated");
    if (payment.status === "approved" && !payment.paymentIntentId && payment.localReceiptCount === 0) {
      if (!payment.receivedAt || inPeriod(instant(payment.receivedAt))) values.received.reasons.add("local_receipt_missing");
    }
  }
  for (const row of unique(snapshot.unclassifiedPaidPayments.items, "unclassified_payment")) {
    integer(row.amountCents); if (row.approvedAmountCents !== null) integer(row.approvedAmountCents);
    const values = bucket(row.currency);
    const observations = row.firstConfirmedSettlementOccurredAt ? [{ occurredAt: row.firstConfirmedSettlementOccurredAt }] : [];
    const timing = approvalTiming(row.statusHistory, true, observations);
    if (timing.kind === "unknown" || timing.kind === "known" && inPeriod(timing.at)) values.received.reasons.add("service_classification_unproven");
    if (row.status === "refunded") values.refunds.reasons.add("refund_evidence_missing");
  }
  const providerRefunds = new Map<string, { amountCents: number; currency: string; time: number }>();
  for (const refund of refunds) {
    integer(refund.amountCents);
    const payment = online.find(row => row.id === refund.paymentIntentId);
    if (payment && payment.currency !== refund.currency) throw invalid();
    const values = bucket(refund.currency);
    if (refund.status !== "COMPLETED") continue;
    if (!refund.processedAt) { values.refunds.reasons.add("refund_time_unknown"); continue; }
    const time = instant(refund.processedAt);
    if (!inPeriod(time)) continue;
    if (!refund.providerRefundId || refund.providerRefundId.startsWith("pending:") || filtered && !refundWholeScope.has(refund.paymentIntentId)) {
      values.refunds.reasons.add("refund_allocation_unproven"); continue;
    }
    const identity = refund.paymentIntentId + ":" + refund.providerRefundId, proof = { amountCents: refund.amountCents, currency: refund.currency, time };
    const previous = providerRefunds.get(identity);
    if (previous && !isDeepStrictEqual(previous, proof)) throw new Error("service_metrics_conflicting_refund");
    if (!previous) { values.refunds.known = add(values.refunds.known, refund.amountCents); providerRefunds.set(identity, proof); }
  }
  for (const payment of online) if (payment.status === "refunded" && !refunds.some(row => row.paymentIntentId === payment.id && row.status === "COMPLETED"))
    bucket(payment.currency).refunds.reasons.add("refund_evidence_missing");
  const truncatedFinance = [snapshot.onlinePayments, snapshot.unclassifiedPaidPayments, snapshot.settlements, snapshot.settlementEntries,
    snapshot.localReceipts, snapshot.refunds].some(page => page.coverage !== "complete");
  for (const values of buckets.values()) {
    if (truncatedFinance) { values.received.reasons.add("financial_source_truncated"); values.refunds.reasons.add("financial_source_truncated"); }
    if (snapshot.appointmentPayments.coverage !== "complete") values.receivable.reasons.add("obligation_source_truncated");
  }
  const occupancy = recurringCapacity(snapshot);
  const valuesByCurrency = [...buckets].sort(([a], [b]) => a.localeCompare(b)).map(([currency, values]) => ({ currency,
    scheduled: amount(values.scheduled, "appointment_starts_at"), receivable: amount(values.receivable, "cohort_obligation_as_of"),
    received: amount(values.received, "recorded_approval_or_confirmed_observation_and_local_receipt"), refunds: amount(values.refunds, "refund_processed_at") }));
  const partial = truncatedFinance || snapshot.appointmentPayments.coverage !== "complete" || occupancy.coverage !== "complete"
    || valuesByCurrency.some(row => [row.scheduled, row.receivable, row.received, row.refunds].some(value => value.status === "partial"));
  return { dataStatus: partial ? "partial" as const : "complete" as const,
    metrics: { merchantId: snapshot.merchantId, period: snapshot.period, asOf: snapshot.asOf, timeZone: snapshot.timeZone,
      filters: snapshot.filters, byStatus, occupancy, valuesByCurrency, financialCoverage: truncatedFinance ? "partial" as const : "complete" as const } };
}

/** Validate the effective whole-payment base before selecting service units.
 * A discount is never allocated by ratio. Only full matching scope can take
 * the whole discounted service amount. */
function serviceValue(payment: ServiceMetricsOnlineFact, filters: ServiceMetricsSnapshot["filters"]) {
  const unknown = (reason: string) => ({ known: 0, reason, fullyFunded: false, wholeScope: false });
  if (!record(payment.amountBreakdown)) return unknown("payment_breakdown_missing");
  const breakdown = payment.amountBreakdown as unknown as PaymentAmountBreakdown;
  try { assertPaymentAmount(breakdown, payment.amountCents, payment.currency); } catch { return unknown("payment_breakdown_invalid"); }
  if (payment.approvedAmountCents !== payment.amountCents) return unknown("approved_service_amount_unproven");
  const orders = unique(payment.orderSnapshots, "order");
  const lines = orders.flatMap(order => {
    if (order.currency !== payment.currency) throw invalid();
    return order.lines;
  });
  const allocations = unique(payment.allocations, "allocation");
  type Unit = { value: number; matches: boolean | undefined };
  const units: Unit[] = [];
  let allService = true, unknownClassification = false, total = 0;
  if (lines.length) for (const line of lines) {
    if (line.unitPriceCents === undefined || line.quantity === undefined || line.quantity === 0) return unknown("service_unit_value_unproven");
    const value = integer(integer(line.unitPriceCents) * integer(line.quantity));
    total = add(total, value);
    if (line.productType !== "service") {
      allService = false;
      if (!["physical", "food", "digital"].includes(line.productType ?? "")) unknownClassification = true;
      continue;
    }
    const allocation = allocations.find(row => record(row.providerEvidence) && row.providerEvidence.unitId === line.lineId);
    let matches: boolean | undefined = true;
    if (filters.professionalId) matches = typeof line.schedule?.professionalId === "string"
      ? line.schedule.professionalId === filters.professionalId : allocation ? allocation.professionalId === filters.professionalId : undefined;
    if (filters.categoryId && matches !== false) matches = allocation ? allocation.categoryId === filters.categoryId
      : lines.length === 1 && payment.filterAllocationCoverage === "matched" ? true : undefined;
    units.push({ value, matches });
  } else for (const allocation of allocations) {
    if (allocation.currency !== payment.currency) throw invalid();
    const value = integer(allocation.amountCents); total = add(total, value);
    units.push({ value, matches: (!filters.professionalId || allocation.professionalId === filters.professionalId)
      && (!filters.categoryId || allocation.categoryId === filters.categoryId) });
  }
  if (!units.length || total !== breakdown.itemsSubtotalCents) return unknown("service_unit_value_unproven");
  const wholeScope = allService && units.every(unit => unit.matches === true);
  const fullyFunded = allService && breakdown.shippingCents === 0;
  if (breakdown.discountCents && !wholeScope) return { known: 0, reason: "discount_allocation_unproven", fullyFunded, wholeScope };
  const known = wholeScope ? breakdown.itemsSubtotalCents - breakdown.discountCents
    : units.filter(unit => unit.matches === true).reduce((sum, unit) => add(sum, unit.value), 0);
  return { known, reason: unknownClassification ? "service_unit_classification_unproven"
    : units.some(unit => unit.matches === undefined) ? "service_unit_allocation_unproven" : undefined, fullyFunded, wholeScope };
}
