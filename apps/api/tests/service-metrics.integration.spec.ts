import assert from "node:assert/strict";
import test from "node:test";
import { PrismaClient } from "@prisma/client";
import type { Prisma, ServiceAppointmentStatus } from "@prisma/client";
import { createDisposablePostgres } from "./local-disposable-postgres.mjs";
import { bootstrapServiceSchema } from "./service-migration-bootstrap.mjs";
import { assertServiceArtifacts } from "./service-test-artifacts.mjs";
import { SERVICE_LOCAL_TEST_MS } from "./service-test-startup.mjs";
import { PrismaServiceMetricsRepository } from "../src/modules/operations/infrastructure/prisma-service-metrics.repository.js";

// KPI-02/04/05/06. This is a real local PostgreSQL read-model proof. Synthetic
// payment/PSP observations are source fixtures, never provider acceptance.
test("T85 service metrics preserve independent appointment and financial facts", { timeout: SERVICE_LOCAL_TEST_MS }, async t => {
  assertServiceArtifacts();
  const db = await createDisposablePostgres({ transport: "loopback-exec" });
  let prisma: PrismaClient | undefined;
  try {
    await db.sql(`CREATE TABLE synthetic_native_marker(run_id TEXT PRIMARY KEY); INSERT INTO synthetic_native_marker VALUES ('${db.runId}');`);
    await bootstrapServiceSchema(db);
    let queries = 0;
    const raw = prisma = new PrismaClient({ datasources: { db: { url: db.prismaUrl } }, log: [{ emit: "event", level: "query" }] });
    raw.$on("query", () => { queries++; });
    const repository = new PrismaServiceMetricsRepository(raw);
    const merchantId = "metrics-services", foreignId = "metrics-foreign";
    const now = new Date("2026-11-19T12:00:00Z");
    for (const id of [merchantId, foreignId]) {
      await raw.merchant.create({ data: { id, name: "Synthetic " + id, businessMode: "services", businessModeSelectedAt: now } });
      await raw.serviceBusinessPolicy.create({ data: { merchantId: id, admissionsEnabled: true, holdEnabled: false,
        paymentMode: "at_attendance", configuredAt: now, version: 1 } });
    }
    await raw.merchant.create({ data: { id: "metrics-products", name: "Synthetic product business", businessMode: "products", businessModeSelectedAt: now } });
    for (const [owner, suffix] of [[merchantId, "a"], [merchantId, "b"], [foreignId, "foreign"]]) {
      await raw.productCategory.create({ data: { id: "metrics-cat-" + suffix, merchantId: owner!, name: suffix!, slug: suffix! } });
      await raw.serviceProfessional.create({ data: { id: "metrics-prof-" + suffix, merchantId: owner!, publicName: "Synthetic " + suffix,
        timeZone: suffix === "b" ? "UTC" : "America/Sao_Paulo", isPublished: true } });
      await raw.product.create({ data: { id: "metrics-product-" + suffix, merchantId: owner!, type: "service", name: "Synthetic " + suffix,
        categoryId: "metrics-cat-" + suffix, variants: { create: { id: "metrics-variant-" + suffix, sku: "metrics-" + suffix,
          price: { create: { basePriceInCents: 5000, currency: "BRL" } } } } } });
      await raw.professionalService.create({ data: { merchantId: owner!, professionalId: "metrics-prof-" + suffix, productId: "metrics-product-" + suffix } });
      await raw.professionalAvailability.create({ data: { merchantId: owner!, professionalId: "metrics-prof-" + suffix,
        weekday: 4, startMinute: 0, endMinute: 1440, timeZone: suffix === "b" ? "UTC" : "America/Sao_Paulo" } });
    }
    const appointment = async (id: string, start: string, suffix: "a" | "b" = "a", status: ServiceAppointmentStatus = "scheduled") => {
      const startsAt = new Date(start);
      return raw.serviceAppointment.create({ data: { id, merchantId, professionalId: "metrics-prof-" + suffix,
        productId: "metrics-product-" + suffix, variantId: "metrics-variant-" + suffix, customerSnapshot: { name: "Synthetic buyer" },
        startsAt, endsAt: new Date(startsAt.getTime() + 20 * 60_000), timeZone: suffix === "b" ? "UTC" : "America/Sao_Paulo",
        durationMinutes: 20, priceInCents: 5000, currency: "BRL", policyVersion: 1,
        policySnapshot: { version: 1, paymentMode: "at_attendance", holdEnabled: false }, origin: "manual", operationalStatus: status,
        idempotencyKey: id, requestFingerprint: id,
        ...(status === "completed" ? { completedAt: new Date(startsAt.getTime() + 20 * 60_000) } : {}),
        ...(status === "no_show" ? { noShowAt: new Date(startsAt.getTime() + 20 * 60_000) } : {}) } });
    };
    await appointment("metrics-overlap", "2026-11-19T02:50:00Z");
    await appointment("metrics-completed-unpaid", "2026-11-19T03:10:00Z", "a", "completed");
    await appointment("metrics-no-show-paid", "2026-11-19T04:00:00Z", "b", "no_show");
    await appointment("metrics-local-outside-cohort", "2026-11-18T12:00:00Z");
    await appointment("metrics-upper-exclusive", "2026-11-20T03:00:00Z");
    await raw.appointmentPayment.create({ data: { id: "metrics-balance-unpaid", merchantId,
      appointmentId: "metrics-completed-unpaid", mode: "at_attendance", amountCents: 5000, currency: "BRL", status: "pending",
      idempotencyKey: "metrics-balance-unpaid", requestFingerprint: "metrics-balance-unpaid" } });
    await raw.appointmentPayment.create({ data: { id: "metrics-local-balance", merchantId,
      appointmentId: "metrics-local-outside-cohort", mode: "at_attendance", amountCents: 5000, currency: "BRL", status: "approved",
      receivedAt: now, idempotencyKey: "metrics-local-balance", requestFingerprint: "metrics-local-balance" } });
    await raw.attendanceReceipt.create({ data: { id: "metrics-local-receipt", merchantId, appointmentPaymentId: "metrics-local-balance",
      amountCents: 5000, currency: "BRL", paymentMethod: "cash", operatorId: "synthetic-operator", receivedAt: now,
      idempotencyKey: "metrics-local-receipt", requestFingerprint: "metrics-local-receipt" } });
    const approved = async (id: string, suffix: "a" | "b", status = "approved") => {
      const sessionId = "metrics-session-" + id, providerPaymentId = "metrics-psp-" + id;
      await raw.checkoutSession.create({ data: { merchantId, sessionId, globalUserId: "synthetic-buyer", conversationId: sessionId,
        cart: { currency: "BRL", items: [] }, createdAt: now, updatedAt: now } });
      await raw.paymentIntent.create({ data: { id, merchantId, sessionId, idempotencyKey: id, method: "pix", status,
        amountCents: 4700, approvedAmountCents: 4700, currency: "BRL", providerPaymentId,
        amountBreakdown: { version: 1, currency: "BRL", itemsSubtotalCents: 5000, discountCents: 500, shippingCents: 0,
          platformFeeCents: 200, totalCents: 4700 }, statusHistory: [{ status: "approved", occurredAt: now.toISOString() }] } });
      await raw.completedOrder.create({ data: { id: "metrics-order-" + id, merchantId, sessionId, externalOrderId: providerPaymentId,
        orderTotal: 45, currency: "BRL", completedAt: now, shippingCents: 0, lineItemsJson: [{ snapshotVersion: 2,
          lineId: "unit-" + id, productType: "service", fulfillmentStrategy: "scheduled_service", variantId: "metrics-variant-" + suffix,
          sku: "metrics-" + suffix, unitPriceCents: 5000, quantity: 1, schedule: { professionalId: "metrics-prof-" + suffix } }] } });
      return id;
    };
    const noSlotIntent = await approved("metrics-paid-no-slot", "a");
    const paidNoShowIntent = await approved("metrics-paid-no-show", "b");
    await raw.appointmentPayment.create({ data: { id: "metrics-online-allocation", merchantId, appointmentId: "metrics-no-show-paid",
      paymentIntentId: paidNoShowIntent, mode: "online", amountCents: 5000, currency: "BRL", status: "approved", receivedAt: now,
      providerEvidence: { paymentIntentId: paidNoShowIntent, approvedAmountCents: 4700, currency: "BRL", unitId: "unit-metrics-paid-no-show" },
      idempotencyKey: "metrics-online-allocation", requestFingerprint: "metrics-online-allocation" } });
    const refundIntent = await approved("metrics-refund-unknown", "a", "refunded");
    await raw.return.create({ data: { id: "metrics-known-refund", merchantId, orderId: "metrics-order-" + noSlotIntent,
      buyerId: "synthetic-buyer", reason: "OTHER", imageUrls: [], status: "REFUND_COMPLETED",
      refund: { create: { id: "metrics-refund-evidence", paymentIntentId: noSlotIntent, providerRefundId: "synthetic-refund-id",
        amountInCents: 1000, status: "COMPLETED", processedAt: now } } } });
    for (const sequence of [1, 2]) await raw.paymentSettlement.create({ data: { id: "metrics-settlement-" + sequence, merchantId,
      paymentIntentId: noSlotIntent, sequence, provider: "synthetic", status: "confirmed", currency: "BRL",
      plannedGrossCents: 4700, plannedPlatformFeeCents: 200, plannedMerchantNetCents: 4500, plannedProviderFeeCents: 0,
      confirmedGrossCents: 4700, occurredAt: now, confirmedAt: now } });
    const scope = { merchantId, from: new Date("2026-11-19T03:00:00Z"), until: new Date("2026-11-20T03:00:00Z") };

    await t.test("cohort, overlap, payment and receipt windows remain distinct", async () => {
      const result = await repository.read(scope);
      assert.equal(result.timeZone, "America/Sao_Paulo");
      assert.equal(result.snapshotBasis, "current_repeatable_read");
      assert.ok(result.asOf instanceof Date);
      assert.deepEqual(result.cohort.map(row => [row.status, row.count, row.nominalValueCents]), [["completed", 1, 5000], ["no_show", 1, 5000]]);
      assert.deepEqual(result.appointments.items.filter(row => row.inCohort).map(row => row.id).sort(), ["metrics-completed-unpaid", "metrics-no-show-paid"]);
      assert.ok(result.appointments.items.some(row => row.id === "metrics-overlap" && !row.inCohort));
      assert.ok(!result.appointments.items.some(row => row.id === "metrics-upper-exclusive"));
      assert.equal(result.appointments.items.find(row => row.id === "metrics-no-show-paid")?.timeZone, "UTC");
      assert.equal(result.appointmentPayments.items.find(row => row.id === "metrics-balance-unpaid")?.status, "pending");
      assert.equal(result.localReceipts.items[0]?.id, "metrics-local-receipt");
      assert.equal(result.localReceipts.items[0]?.appointmentId, "metrics-local-outside-cohort");
      assert.equal(result.localReceipts.items[0]?.amountCents, 5000);
      assert.equal(result.localReceipts.items.length, 1);
    });
    await t.test("legacy or local recorded payment evidence is not restricted to the appointment cohort", async () => {
      const result = await repository.read(scope);
      const payment = result.appointmentPayments.items.find(row => row.id === "metrics-local-balance");
      assert.ok(payment);
      assert.equal(payment.appointmentId, "metrics-local-outside-cohort");
      assert.equal(payment.receivedAt?.toISOString(), now.toISOString());
      assert.equal(payment.amountCents, 5000);
      assert.equal(payment.mode, "at_attendance");
      assert.equal(result.appointments.items.some(row => row.id === payment.appointmentId), false);
    });
    await t.test("paid service without a slot survives with discount, fee and immutable evidence", async () => {
      const result = await repository.read(scope);
      const payment = result.onlinePayments.items.find(row => row.id === noSlotIntent);
      assert.ok(payment);
      assert.equal(payment.approvedAmountCents, 4700);
      assert.deepEqual(payment.amountBreakdown, { version: 1, currency: "BRL", itemsSubtotalCents: 5000,
        discountCents: 500, shippingCents: 0, platformFeeCents: 200, totalCents: 4700 });
      assert.equal(payment.orderSnapshots.length, 1);
      assert.equal(payment.allocations.length, 0);
      assert.equal(payment.orderSnapshots[0]?.lines[0]?.schedule?.professionalId, "metrics-prof-a");
      assert.equal(result.appointments.items.some(row => row.orderId === "metrics-order-" + noSlotIntent), false);
      assert.deepEqual(result.settlements.items.map(row => row.id), ["metrics-settlement-1", "metrics-settlement-2"]);
      assert.equal(result.onlinePayments.items.filter(row => row.id === noSlotIntent).length, 1);
      assert.equal(result.onlinePayments.items.find(row => row.id === refundIntent)?.status, "refunded");
      assert.equal(result.financialTimeBasis, "retained_evidence_requires_reduction");
      assert.equal(result.refundCoverage, "requires_financial_evidence");
    });
    await t.test("known refund evidence remains separate from gross service receipt evidence", async () => {
      const result = await repository.read(scope);
      assert.equal(result.refunds.items.length, 1);
      assert.deepEqual(result.refunds.items[0], { id: "metrics-refund-evidence", merchantId, paymentIntentId: noSlotIntent,
        returnId: "metrics-known-refund", orderId: "metrics-order-" + noSlotIntent, amountCents: 1000, currency: "BRL",
        providerRefundId: "synthetic-refund-id", status: "COMPLETED", processedAt: now });
      assert.equal(result.onlinePayments.items.find(row => row.id === noSlotIntent)?.approvedAmountCents, 4700);
      assert.equal(result.refunds.items.some(row => row.paymentIntentId === refundIntent), false,
        "refunded status without amount/time cannot fabricate an additional refund");
    });
    await t.test("same filters apply to facts and aggregates and foreign filters are refused", async () => {
      const filtered = await repository.read({ ...scope, professionalId: "metrics-prof-a", categoryId: "metrics-cat-a" });
      assert.deepEqual(filtered.cohort.map(row => [row.status, row.count]), [["completed", 1]]);
      assert.ok(filtered.appointments.items.every(row => row.professionalId === "metrics-prof-a" && row.categoryId === "metrics-cat-a"));
      assert.deepEqual(filtered.onlinePayments.items.map(row => row.id).sort(), [noSlotIntent, refundIntent].sort());
      assert.ok(filtered.localReceipts.items.every(row => row.professionalId === "metrics-prof-a"));
      await assert.rejects(() => repository.read({ ...scope, professionalId: "metrics-prof-foreign" }), /service_metrics_filter_not_found/);
      await assert.rejects(() => repository.read({ ...scope, categoryId: "metrics-cat-foreign" }), /service_metrics_filter_not_found/);
      await assert.rejects(() => repository.read({ ...scope, merchantId: "metrics-products" }), /service_metrics_business_mode_required/);
      assert.equal(await raw.serviceAppointment.count({ where: { merchantId: foreignId } }), 0);
    });
    await t.test("aggregate and detail see one real SQL snapshot despite a concurrent state change", async () => {
      let changed = false;
      const writer = new PrismaClient({ datasources: { db: { url: db.prismaUrl } } });
      const isolated = new PrismaServiceMetricsRepository({
        $transaction: (work: (tx: Prisma.TransactionClient) => Promise<unknown>, options: unknown) => raw.$transaction(async tx => {
          const observed = new Proxy(tx, { get(target, key, receiver) {
            if (key !== "$queryRaw") return Reflect.get(target, key, receiver);
            return async (...args: unknown[]) => {
              const result = await Reflect.apply(target.$queryRaw, target, args);
              const query = args[0] as { strings?: readonly string[] };
              if (!changed && query.strings?.join("").includes("sum(a.price_in_cents)")) {
                await writer.serviceAppointment.update({ where: { id: "metrics-completed-unpaid" }, data: { operationalStatus: "cancelled" } });
                changed = true;
              }
              return result;
            };
          } });
          return work(observed);
        }, options as { isolationLevel: Prisma.TransactionIsolationLevel; timeout: number; maxWait: number }),
      } as unknown as PrismaClient);
      try {
        const result = await isolated.read(scope);
        assert.equal(changed, true);
        assert.equal(result.cohort.find(row => row.status === "completed")?.count, 1);
        assert.equal(result.appointments.items.find(row => row.id === "metrics-completed-unpaid")?.operationalStatus, "completed");
        assert.equal((await raw.serviceAppointment.findUniqueOrThrow({ where: { id: "metrics-completed-unpaid" } })).operationalStatus, "cancelled");
      } finally {
        try {
          await writer.serviceAppointment.update({ where: { id: "metrics-completed-unpaid" }, data: { operationalStatus: "completed" } });
        } finally {
          await writer.$disconnect();
        }
      }
    });
    await t.test("batched detail pagination is complete or explicitly truncated, with bounded queries", async () => {
      queries = 0;
      const first = await repository.read({ ...scope, pageSize: 100 });
      const firstQueries = queries;
      await appointment("metrics-extra", "2026-11-19T06:00:00Z", "a", "pending");
      queries = 0;
      const second = await repository.read({ ...scope, pageSize: 100 });
      assert.equal(queries, firstQueries, "query count grows with source pages, not individual appointments");
      assert.equal(second.appointments.items.length, first.appointments.items.length + 1);
      const paged = await repository.read({ ...scope, pageSize: 1 });
      assert.equal(paged.appointments.coverage, "complete");
      assert.equal(new Set(paged.appointments.items.map(row => row.id)).size, paged.appointments.items.length);
      assert.deepEqual(paged.appointments.items.map(row => row.id), second.appointments.items.map(row => row.id));
      const limited = await repository.read({ ...scope, pageSize: 1, maxRows: 1 });
      assert.equal(limited.appointments.coverage, "partial");
      assert.equal(limited.appointments.items.length, 1);
      assert.equal(limited.appointments.nextCursor, limited.appointments.items[0]?.id);
      assert.equal(limited.cohort.reduce((sum, row) => sum + row.count, 0), 3, "complete aggregate is not replaced by capped detail length");
    });
    await t.test("paid classification gaps retain currency and event evidence without trusting the current cart", async () => {
      const before = await repository.read(scope);
      assert.equal(before.unclassifiedPaidPayments.items.length, 0);
      assert.equal(before.financialClassificationCoverage, "complete");
      const old = new Date("2026-11-01T12:00:00Z");
      const candidates = [
        { id: "metrics-unclassified-brl", currency: "BRL", amount: 4700, history: [{ status: "approved", occurredAt: now.toISOString() }] },
        { id: "metrics-unclassified-usd", currency: "USD", amount: 4700, history: [{ status: "approved", occurredAt: old.toISOString() }] },
        { id: "metrics-unclassified-eur", currency: "EUR", amount: 4700, history: [] },
      ];
      for (const candidate of candidates) {
        await raw.checkoutSession.create({ data: { merchantId, sessionId: candidate.id, globalUserId: "synthetic-buyer",
          conversationId: candidate.id, cart: { currency: candidate.currency, items: [{ productType: "physical", quantity: 1, price: 45 }] },
          createdAt: now, updatedAt: now } });
        await raw.paymentIntent.create({ data: { id: candidate.id, merchantId, sessionId: candidate.id, idempotencyKey: candidate.id,
          amountCents: candidate.amount, approvedAmountCents: candidate.amount, currency: candidate.currency, method: "pix", status: "approved",
          providerPaymentId: "synthetic-psp-" + candidate.id, statusHistory: candidate.history,
          amountBreakdown: { version: 1, currency: candidate.currency, itemsSubtotalCents: 5000,
            discountCents: 500, shippingCents: 0, platformFeeCents: 200, totalCents: candidate.amount } } });
        await raw.checkoutSession.update({ where: { merchantId_sessionId: { merchantId, sessionId: candidate.id } }, data: {
          cart: { currency: candidate.currency, items: [{ productType: "service", variantId: "metrics-variant-b", quantity: 1, price: 45,
            fulfillmentSchedule: { professionalId: "metrics-prof-b" } }] } } });
      }
      await raw.paymentSettlement.create({ data: { id: "metrics-unclassified-usd-settlement", merchantId,
        paymentIntentId: "metrics-unclassified-usd", sequence: 1, provider: "synthetic", status: "confirmed", currency: "USD",
        plannedGrossCents: 4700, plannedPlatformFeeCents: 200, plannedMerchantNetCents: 4500, plannedProviderFeeCents: 0,
        confirmedGrossCents: 4700, occurredAt: old, confirmedAt: old, createdAt: old } });
      const result = await repository.read({ ...scope, professionalId: "metrics-prof-a", categoryId: "metrics-cat-a" });
      assert.equal(result.financialClassificationCoverage, "partial");
      assert.equal(result.unclassifiedPaidPayments.coverage, "complete");
      assert.deepEqual(result.unclassifiedPaidPayments.items.map(row => [row.id, row.currency, row.classification]), [
        ["metrics-unclassified-brl", "BRL", "unproven"], ["metrics-unclassified-eur", "EUR", "unproven"],
        ["metrics-unclassified-usd", "USD", "unproven"],
      ]);
      const brl = result.unclassifiedPaidPayments.items.find(row => row.currency === "BRL")!;
      assert.equal(brl.approvedAmountCents, 4700);
      assert.deepEqual(brl.statusHistory, candidates[0]!.history);
      assert.deepEqual(brl.amountBreakdown, { version: 1, currency: "BRL", itemsSubtotalCents: 5000,
        discountCents: 500, shippingCents: 0, platformFeeCents: 200, totalCents: 4700 });
      const usd = result.unclassifiedPaidPayments.items.find(row => row.currency === "USD")!;
      assert.deepEqual(usd.statusHistory, candidates[1]!.history);
      assert.equal(usd.firstConfirmedSettlementOccurredAt?.toISOString(), old.toISOString());
      assert.equal(usd.firstConfirmedSettlementConfirmedAt?.toISOString(), old.toISOString());
      const eur = result.unclassifiedPaidPayments.items.find(row => row.currency === "EUR")!;
      assert.deepEqual(eur.statusHistory, []);
      assert.equal(eur.firstConfirmedSettlementOccurredAt, null);
      assert.equal(eur.firstConfirmedSettlementConfirmedAt, null);
      assert.equal(result.onlinePayments.items.some(row => row.id.startsWith("metrics-unclassified-")), false);
      assert.equal(result.appointments.items.some(row => row.orderId?.includes("unclassified")), false);
      const capped = await repository.read({ ...scope, pageSize: 1, maxRows: 1 });
      assert.equal(capped.unclassifiedPaidPayments.coverage, "partial");
      assert.equal(capped.financialClassificationCoverage, "partial");
      assert.equal(capped.unclassifiedPaidPayments.items.length, 1);
      assert.equal(capped.unclassifiedPaidPayments.nextCursor, capped.unclassifiedPaidPayments.items[0]?.id);
    });
    await t.test("receivable evidence includes historical receipts through asOf without mixing currencies or financial windows", async () => {
      const before = await repository.read(scope);
      const original = before.appointmentPayments.items.find(row => row.id === "metrics-balance-unpaid")!;
      assert.equal(original.localReceiptTotalCents, 0);
      assert.equal(original.localReceiptCount, 0);
      assert.equal(original.localReceiptCurrencyMismatch, false);
      const old = new Date("2026-11-18T12:00:00Z");
      // Historical partial data is retained; this is not a new partial-payment
      // command. New local receipt commands still require the remaining balance.
      await raw.attendanceReceipt.create({ data: { id: "metrics-historical-partial-receipt", merchantId,
        appointmentPaymentId: original.id, amountCents: 1000, currency: "BRL", paymentMethod: "cash",
        operatorId: "synthetic-operator", receivedAt: old, idempotencyKey: "metrics-historical-partial-receipt",
        requestFingerprint: "metrics-historical-partial-receipt" } });
      const recorded = await repository.read(scope);
      const balance = recorded.appointmentPayments.items.find(row => row.id === original.id)!;
      assert.equal(balance.localReceiptTotalCents, 1000);
      assert.equal(balance.localReceiptCount, 1);
      assert.equal(balance.localReceiptCurrencyMismatch, false);
      assert.equal(recorded.localReceipts.items.some(row => row.id === "metrics-historical-partial-receipt"), false);
      await raw.attendanceReceipt.create({ data: { id: "metrics-historical-currency-mismatch", merchantId,
        appointmentPaymentId: original.id, amountCents: 200, currency: "USD", paymentMethod: "cash",
        operatorId: "synthetic-operator", receivedAt: old, idempotencyKey: "metrics-historical-currency-mismatch",
        requestFingerprint: "metrics-historical-currency-mismatch" } });
      const mixed = (await repository.read(scope)).appointmentPayments.items.find(row => row.id === original.id)!;
      assert.equal(mixed.localReceiptTotalCents, 1000);
      assert.equal(mixed.localReceiptCount, 1);
      assert.equal(mixed.localReceiptCurrencyMismatch, true);
    });
  } finally {
    await prisma?.$disconnect();
    await db.dispose();
    assert.deepEqual(db.bridgeStatus(), { listening: false, sockets: 0, children: 0 });
  }
});
