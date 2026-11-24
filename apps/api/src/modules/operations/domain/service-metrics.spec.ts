import assert from "node:assert/strict";
import test from "node:test";
import { calculateServiceMetrics, calculateServiceOccupancy, type ServiceMetricsSnapshot } from "./service-metrics.js";
import type { ServiceMetricsAppointmentFact, ServiceMetricsOnlineFact, ServiceMetricsPaymentFact,
  ServiceMetricsUnclassifiedPaidFact } from "../infrastructure/prisma-service-metrics.repository.js";

const from = new Date("2026-11-19T03:00:00Z"), until = new Date("2026-11-20T03:00:00Z");
const at = (text: string) => new Date("2026-11-19T" + text + ":00Z");
const page = <T>(items: T[] = []) => ({ items, coverage: "complete" as const });
function source(): ServiceMetricsSnapshot {
  return { merchantId: "m", period: { from, until }, filters: { professionalId: null, categoryId: null }, timeZone: "America/Sao_Paulo",
    asOf: new Date("2026-11-21T12:00:00Z"), snapshotBasis: "current_repeatable_read", categoryBasis: "current_product_category",
    financialTimeBasis: "retained_evidence_requires_reduction", financialClassificationCoverage: "complete",
    localReceiptTimeBasis: "operator_recorded_received_at", refundCoverage: "requires_financial_evidence",
    cohort: [], appointments: page(), appointmentPayments: page(), localReceipts: page(), onlinePayments: page(),
    unclassifiedPaidPayments: page(), settlements: page(), settlementEntries: page(), refunds: page(), availability: page(), exceptions: page() };
}
function appointment(id = "a", status = "scheduled"): ServiceMetricsAppointmentFact {
  return { id, merchantId: "m", professionalId: "p-a", productId: "service", categoryId: "cat", startsAt: at("10:00"), endsAt: at("10:20"),
    timeZone: "America/Sao_Paulo", operationalStatus: status, priceInCents: 5000, currency: "BRL", orderId: null, orderUnitId: null, inCohort: true };
}
function obligation(id = "balance", status = "pending"): ServiceMetricsPaymentFact {
  return { id, merchantId: "m", appointmentId: "a", professionalId: "p-a", categoryId: "cat", mode: "at_attendance",
    amountCents: 5000, currency: "BRL", status, paymentIntentId: null, providerEvidence: null, receivedAt: null,
    requiresRegularization: false, localReceiptTotalCents: 0, localReceiptCount: 0, localReceiptCurrencyMismatch: false };
}
function intent(id = "intent", prices = [10000], discount = 0, fee = 200): ServiceMetricsOnlineFact {
  const subtotal = prices.reduce((a, b) => a + b, 0), total = subtotal - discount + fee;
  return { id, merchantId: "m", sessionId: "session-" + id, status: "approved", currency: "BRL", amountCents: total,
    approvedAmountCents: total, providerPaymentId: "psp-" + id,
    amountBreakdown: { version: 1, currency: "BRL", itemsSubtotalCents: subtotal, discountCents: discount,
      shippingCents: 0, platformFeeCents: fee, totalCents: total },
    statusHistory: [{ status: "approved", occurredAt: at("12:00").toISOString() }], allocations: [],
    orderSnapshots: [{ id: "order-" + id, currency: "BRL", lines: prices.map((price, index) => ({ lineId: "u" + index,
      productType: "service", quantity: 1, unitPriceCents: price, variantId: "v" + index,
      schedule: { professionalId: index ? "p-b" : "p-a" } })) }], filterAllocationCoverage: "merchant" };
}
function unclassified(history: unknown[] = []): ServiceMetricsUnclassifiedPaidFact {
  return { id: "unknown", merchantId: "m", sessionId: "unknown", status: "approved", currency: "BRL", amountCents: 10200,
    approvedAmountCents: 10200, providerPaymentId: "unknown-psp", amountBreakdown: null,
    statusHistory: history as ServiceMetricsUnclassifiedPaidFact["statusHistory"], classification: "unproven",
    firstConfirmedSettlementOccurredAt: null, firstConfirmedSettlementConfirmedAt: null };
}
function metrics(input: ServiceMetricsSnapshot) {
  const result = calculateServiceMetrics(input);
  assert.ok(result.metrics);
  return result.metrics;
}
function brl(input: ServiceMetricsSnapshot) {
  const row = metrics(input).valuesByCurrency.find(row => row.currency === "BRL");
  assert.ok(row);
  return row;
}

// KPI-02/03/04/06/07. Direct assertions deliberately remain in the exact T86
// root: the approved ^T86$ filter selects every group without skipped children.
test("T86", () => {
  // Capacity union and clipping: 240 offered, 150 occupied, exact 0.625.
  const window = { from: at("10:00"), until: at("14:00") };
  const interval = (professionalId: string, start: string, end: string) => ({ professionalId, startsAt: at(start), endsAt: at(end) });
  const capacity = { period: window,
    offered: [interval("a", "09:00", "12:00"), interval("a", "10:00", "12:00"), interval("b", "12:00", "14:00")],
    blocks: [], appointments: [{ ...interval("a", "09:30", "11:00"), id: "a", status: "scheduled" },
      { ...interval("a", "10:30", "11:30"), id: "b", status: "completed" },
      { ...interval("b", "12:00", "13:00"), id: "c", status: "no_show" }] };
  const occupancy = calculateServiceOccupancy(capacity);
  assert.equal(occupancy.offeredMinutes, 240);
  assert.equal(occupancy.occupiedMinutes, 150);
  assert.equal(occupancy.occupancyRate, 0.625);
  assert.equal(calculateServiceOccupancy({ ...capacity, blocks: [interval("a", "11:00", "11:30"), interval("a", "11:15", "11:30")] }).offeredMinutes, 210);
  const noDenominator = calculateServiceOccupancy({ period: window, offered: [], blocks: [], appointments: [] });
  assert.equal(noDenominator.occupancyRate, null);
  assert.equal(noDenominator.rateStatus, "not_calculable");
  assert.equal(calculateServiceOccupancy({ period: window, offered: capacity.offered, blocks: [], appointments: [] }).occupancyRate, 0);
  for (const offered of [capacity.offered, [...capacity.offered].reverse(), [...capacity.offered, ...capacity.offered]])
    assert.deepEqual(calculateServiceOccupancy({ ...capacity, offered }), occupancy);
  assert.throws(() => calculateServiceOccupancy({ ...capacity, appointments: [...capacity.appointments,
    { ...capacity.appointments[0]!, status: "cancelled" }] }), /conflicting_appointment/);

  // Recorded historical zones, midnight and elapsed time through a DST jump.
  const dst = source();
  dst.period = { from: new Date("2026-03-08T05:00:00Z"), until: new Date("2026-03-08T08:00:00Z") };
  dst.availability.items = [{ id: "dst", professionalId: "p-a", weekday: 0, startMinute: 0, endMinute: 240,
    timeZone: "America/New_York", validFrom: null, validUntil: null }];
  assert.equal(metrics(dst).occupancy.offeredMinutes, 180);
  const gap = structuredClone(dst); gap.availability.items[0]!.startMinute = 150;
  assert.equal(metrics(gap).occupancy.offeredMinutes, null);
  assert.equal(metrics(gap).occupancy.rateStatus, "unavailable");
  const midnight = source();
  midnight.period = { from: new Date("2026-11-20T02:00:00Z"), until: new Date("2026-11-20T03:00:00Z") };
  midnight.availability.items = [{ id: "midnight", professionalId: "p-a", weekday: 4, startMinute: 1380, endMinute: 1440,
    timeZone: "America/Sao_Paulo", validFrom: null, validUntil: null }];
  assert.equal(metrics(midnight).occupancy.offeredMinutes, 60);
  assert.equal(midnight.availability.items[0]!.timeZone, "America/Sao_Paulo");

  // Operational completion/unpaid and booking-only have no invented money.
  const operational = source();
  operational.appointments.items = [appointment("a", "completed"), appointment("b", "no_show")];
  operational.cohort = [{ status: "completed", currency: "BRL", count: 1, nominalValueCents: 5000 },
    { status: "no_show", currency: "BRL", count: 1, nominalValueCents: 5000 }];
  operational.appointmentPayments.items = [obligation()];
  assert.equal(metrics(operational).byStatus.completed, 1);
  assert.equal(metrics(operational).byStatus.no_show, 1);
  assert.equal(brl(operational).scheduled.amountCents, 10000);
  assert.equal(brl(operational).receivable.amountCents, 5000);
  assert.equal(brl(operational).received.amountCents, 0);
  const bookingOnly = source(); bookingOnly.appointments.items = [appointment()];
  bookingOnly.cohort = [{ status: "scheduled", currency: "BRL", count: 1, nominalValueCents: 5000 }];
  assert.equal(brl(bookingOnly).receivable.amountCents, 0);

  // Actual discount and buyer fee, paid no-slot, multiple units and replays.
  const paid = source(); paid.onlinePayments.items = [intent("paid", [5000, 5000], 1000, 200)];
  const original = structuredClone(paid);
  assert.equal(brl(paid).received.amountCents, 9000);
  assert.equal(metrics(paid).byStatus.scheduled, 0);
  const replay = structuredClone(paid); replay.onlinePayments.items.push(structuredClone(replay.onlinePayments.items[0]!));
  replay.settlements.items = [1, 2].map(sequence => ({ id: "s" + sequence, merchantId: "m", paymentIntentId: "paid", sequence,
    status: "confirmed", currency: "BRL", confirmedGrossCents: 9200, confirmedPlatformFeeCents: 200,
    confirmedMerchantNetCents: 8700, confirmedProviderFeeCents: 300, occurredAt: at("12:00"), confirmedAt: at("12:00") }));
  assert.equal(brl(replay).received.amountCents, 9000);
  assert.equal(brl(paid).refunds.amountCents, 0);
  assert.deepEqual(paid, original);
  const noDiscount = source(); noDiscount.onlinePayments.items = [intent()];
  assert.equal(brl(noDiscount).received.amountCents, 10000);
  const paidNoShow = source(); paidNoShow.appointments.items = [appointment("a", "no_show")];
  paidNoShow.cohort = [{ status: "no_show", currency: "BRL", count: 1, nominalValueCents: 5000 }];
  const noShowIntent = intent("no-show", [5000], 500, 200);
  noShowIntent.allocations = [{ id: "online-balance", appointmentId: "a", professionalId: "p-a", categoryId: "cat",
    amountCents: 5000, currency: "BRL", providerEvidence: { unitId: "u0" } }];
  paidNoShow.onlinePayments.items = [noShowIntent];
  paidNoShow.appointmentPayments.items = [{ ...obligation("online-balance", "approved"), mode: "online", paymentIntentId: "no-show" }];
  assert.equal(metrics(paidNoShow).byStatus.no_show, 1);
  assert.equal(metrics(paidNoShow).byStatus.completed, 0);
  assert.equal(brl(paidNoShow).received.amountCents, 4500);
  assert.equal(brl(paidNoShow).receivable.amountCents, 0);
  const pendingDiscount = source(); pendingDiscount.appointments.items = [appointment()];
  pendingDiscount.cohort = [{ status: "scheduled", currency: "BRL", count: 1, nominalValueCents: 5000 }];
  pendingDiscount.appointmentPayments.items = [{ ...obligation(), mode: "online", paymentIntentId: "pending-discount" }];
  const waiting = intent("pending-discount", [5000], 500, 200); waiting.status = "pending"; waiting.approvedAmountCents = null;
  waiting.statusHistory = [{ status: "pending", occurredAt: at("12:00").toISOString() }];
  pendingDiscount.onlinePayments.items = [waiting];
  assert.equal(brl(pendingDiscount).received.amountCents, 0);
  assert.equal(brl(pendingDiscount).receivable.amountCents, null);

  // A global discount must never be distributed across professionals by guess.
  const filtered = structuredClone(paid); filtered.filters.professionalId = "p-a";
  filtered.onlinePayments.items[0]!.filterAllocationCoverage = "matched";
  assert.equal(brl(filtered).received.amountCents, null);
  assert.equal(brl(filtered).received.status, "partial");
  assert.ok(brl(filtered).received.reasons.includes("discount_allocation_unproven"));
  const exactShare = source(); exactShare.filters.professionalId = "p-a";
  exactShare.onlinePayments.items = [intent("zero-discount", [5000, 5000])];
  exactShare.onlinePayments.items[0]!.filterAllocationCoverage = "matched";
  assert.equal(brl(exactShare).received.amountCents, 5000);

  // Historical local receipts reduce asOf balance, but only window receipts
  // enter Received. A receipt plus its approved AP is one financial fact.
  const local = source(); local.appointments.items = [appointment("a", "completed")];
  local.cohort = [{ status: "completed", currency: "BRL", count: 1, nominalValueCents: 5000 }];
  local.appointmentPayments.items = [{ ...obligation(), localReceiptTotalCents: 1000, localReceiptCount: 1 }];
  assert.equal(brl(local).receivable.amountCents, 4000);
  assert.equal(brl(local).received.amountCents, 0);
  local.appointmentPayments.items = [{ ...obligation("balance", "approved"), receivedAt: at("12:00"), localReceiptTotalCents: 5000, localReceiptCount: 1 }];
  local.localReceipts.items = [{ id: "receipt", merchantId: "m", appointmentPaymentId: "balance", appointmentId: "a", professionalId: "p-a",
    categoryId: "cat", amountCents: 5000, currency: "BRL", receivedAt: at("12:00") }];
  local.localReceipts.items.push(structuredClone(local.localReceipts.items[0]!));
  assert.equal(brl(local).received.amountCents, 5000);
  assert.equal(brl(local).receivable.amountCents, 0);
  const mismatch = structuredClone(local); mismatch.appointmentPayments.items[0]!.localReceiptCurrencyMismatch = true;
  assert.equal(brl(mismatch).receivable.amountCents, null);

  // Refunds are distinct, deduplicated, and do not mutate the gross service
  // Received metric. A refunded status without facts remains unknown.
  const refunded = structuredClone(paid);
  refunded.onlinePayments.items[0]!.status = "refunded";
  refunded.refunds.items = [{ id: "refund", merchantId: "m", paymentIntentId: "paid", returnId: "return", orderId: "order-paid",
    amountCents: 1000, currency: "BRL", providerRefundId: "psp-refund", status: "COMPLETED", processedAt: at("13:00") }];
  refunded.refunds.items.push(structuredClone(refunded.refunds.items[0]!));
  assert.equal(brl(refunded).received.amountCents, 9000);
  assert.equal(brl(refunded).refunds.amountCents, 1000);
  refunded.refunds.items = [];
  assert.equal(brl(refunded).refunds.amountCents, null);

  // Unknown classification uses event clocks per period, not a blanket flag
  // that makes every later period unknown. Missing clocks remain unknown.
  const unknown = source(); unknown.financialClassificationCoverage = "partial";
  unknown.unclassifiedPaidPayments.items = [unclassified([{ status: "approved", occurredAt: "2026-11-01T12:00:00.000Z" }])];
  assert.equal(brl(unknown).received.amountCents, 0);
  unknown.unclassifiedPaidPayments.items[0]!.statusHistory = [{ status: "approved", occurredAt: at("12:00").toISOString() }];
  assert.equal(brl(unknown).received.amountCents, null);
  unknown.unclassifiedPaidPayments.items[0]!.statusHistory = [];
  assert.equal(brl(unknown).received.amountCents, null);
  unknown.unclassifiedPaidPayments.items[0]!.firstConfirmedSettlementOccurredAt = new Date("2026-11-01T12:00:00Z");
  assert.equal(brl(unknown).received.amountCents, 0);
  const unzoned = source(); unzoned.onlinePayments.items = [intent()];
  unzoned.onlinePayments.items[0]!.statusHistory = [{ status: "approved", occurredAt: "2026-11-19T12:00:00" }];
  assert.equal(brl(unzoned).received.amountCents, null);

  // Truncated/failed facts are not complete zeros; complete cohort summaries
  // still preserve counts when detail is capped. Missing denominators differ.
  const partial = structuredClone(operational); partial.appointments.coverage = "partial";
  assert.equal(metrics(partial).byStatus.completed, 1);
  assert.equal(metrics(partial).occupancy.occupancyRate, null);
  assert.equal(calculateServiceMetrics(partial).dataStatus, "partial");
  assert.deepEqual(calculateServiceMetrics(null), { dataStatus: "unavailable", metrics: null });
  const multiple = source(); multiple.localReceipts.items = [{ id: "usd", merchantId: "m", appointmentPaymentId: "usd", appointmentId: "usd",
    professionalId: "p-a", categoryId: "cat", amountCents: 300, currency: "USD", receivedAt: at("12:00") }];
  multiple.onlinePayments.items = [intent()];
  assert.deepEqual(metrics(multiple).valuesByCurrency.map(row => [row.currency, row.received.amountCents]), [["BRL", 10000], ["USD", 300]]);
  const foreign = structuredClone(paid); foreign.onlinePayments.items[0]!.merchantId = "foreign";
  assert.throws(() => calculateServiceMetrics(foreign), /tenant_mismatch/);
  const conflict = structuredClone(local); conflict.localReceipts.items[1]!.amountCents++;
  assert.throws(() => calculateServiceMetrics(conflict), /conflicting_receipt/);
  const invalidMoney = structuredClone(paid); invalidMoney.onlinePayments.items[0]!.amountCents = Number.MAX_SAFE_INTEGER + 1;
  assert.throws(() => calculateServiceMetrics(invalidMoney), /invalid|overflow/);
});
