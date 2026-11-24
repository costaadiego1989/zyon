import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { createServiceMetricsHttpFixture } from "./service-metrics-http.fixture.js";
import { SERVICE_LOCAL_TEST_MS } from "./service-test-startup.mjs";

// Real AppModule, HTTP, authentication and owned SQL. Seeded historical facts
// are synthetic preconditions, not provider payments or booking-command proof.
test("T87 and T91 served metrics HTTP and SQL", { timeout: SERVICE_LOCAL_TEST_MS }, async t => {
  const f = await createServiceMetricsHttpFixture();
  try {
    await t.test("private canonical service transport keeps independent facts, real asOf and no-store", async () => {
      const before = await f.snapshot(), start = await f.clock(), result = await f.metrics(), finish = await f.clock();
      assert.equal(result.status, 200, JSON.stringify(result.body)); assert.equal(result.headers.get("cache-control"), "no-store");
      assert.equal(result.headers.get("aacp-api-version"), "v1");
      const body = result.body; assert.equal(body.merchantId, f.services.merchant_id); assert.equal(body.businessMode, "services");
      assert.equal(body.timeZone, "America/Sao_Paulo"); assert.equal(body.dataStatus, "complete"); assert.equal(body.currency, "BRL");
      assert.ok(Date.parse(body.asOf) >= start.getTime() && Date.parse(body.asOf) <= finish.getTime());
      assert.deepEqual(body.period, { fromDate: "2026-11-19", toDate: "2026-11-19", from: "2026-11-19T03:00:00.000Z", until: "2026-11-20T03:00:00.000Z", bounds: "[from,until)" });
      assert.deepEqual(body.metrics.byStatus, { pending: 0, scheduled: 0, in_service: 0, completed: 1, no_show: 1, cancelled: 0 });
      assert.equal(body.metrics.occupancy.offeredMinutes, 100); assert.equal(body.metrics.occupancy.occupiedMinutes, 50); assert.equal(body.metrics.occupancy.occupancyRate, .5);
      const row = body.metrics.valuesByCurrency[0]; assert.equal(row.scheduled.amountCents, 10000); assert.equal(row.receivable.amountCents, 5000);
      assert.equal(row.received.amountCents, 9500); assert.equal(row.refunds.amountCents, 1000);
      assert.equal(row.received.temporalBasis, "recorded_approval_or_confirmed_observation_and_local_receipt");
      assert.equal(body.temporalBases.appointments, "appointment_starts_at"); assert.equal(body.temporalBases.receivable, "cohort_obligation_as_of");
      assert.equal(await f.prisma.serviceAppointment.count({ where: { orderId: f.ids.noSlotOrder } }), 0);
      assert.doesNotMatch(JSON.stringify(body), /PRIVATE_METRICS_CONTACT|PRIVATE_PROVIDER_METRICS|requestFingerprint|customerSnapshot|amountBreakdown|statusHistory/);
      assert.deepEqual(await f.snapshot(), before);
    });
    await t.test("the same professional/category filters apply to counts, capacity and finance without foreign leakage", async () => {
      const before = await f.snapshot();
      const a = await f.metrics({ professionalId: f.ids.professionalA, categoryId: f.ids.categoryA }); assert.equal(a.status, 200, JSON.stringify(a.body));
      assert.deepEqual(a.body.filters, { professionalId: f.ids.professionalA, categoryId: f.ids.categoryA });
      assert.equal(a.body.metrics.byStatus.completed, 1); assert.equal(a.body.metrics.byStatus.no_show, 0);
      assert.equal(a.body.metrics.occupancy.offeredMinutes, 40); assert.equal(a.body.metrics.occupancy.occupiedMinutes, 30); assert.equal(a.body.metrics.occupancy.occupancyRate, .75);
      assert.equal(a.body.metrics.valuesByCurrency[0].scheduled.amountCents, 5000); assert.equal(a.body.metrics.valuesByCurrency[0].receivable.amountCents, 5000);
      assert.equal(a.body.metrics.valuesByCurrency[0].received.amountCents, 4500); assert.equal(a.body.metrics.valuesByCurrency[0].refunds.amountCents, 1000);
      const b = await f.metrics({ professionalId: f.ids.professionalB, categoryId: f.ids.categoryB }); assert.equal(b.status, 200, JSON.stringify(b.body));
      assert.equal(b.body.metrics.byStatus.completed, 0); assert.equal(b.body.metrics.byStatus.no_show, 1);
      assert.equal(b.body.metrics.valuesByCurrency[0].received.amountCents, 5000); assert.equal(b.body.metrics.valuesByCurrency[0].receivable.amountCents, 0);
      for (const query of [{ professionalId: f.ids.foreignProfessional }, { categoryId: f.ids.foreignCategory }] as Array<Record<string, string>>) {
        const denied = await f.metrics(query); assert.equal(denied.status, 404); assert.equal(denied.body.code, "service_metrics_filter_not_found");
        assert.doesNotMatch(JSON.stringify(denied.body), /FOREIGN_METRICS/);
      }
      assert.equal((await f.prisma.serviceProfessional.findUniqueOrThrow({ where: { id: f.ids.professionalB } })).timeZone, "UTC");
      assert.deepEqual(await f.snapshot(), before);
    });
    await t.test("original human, buyer, foreign-tenant and scoped-key authorization remains effective", async () => {
      const before = await f.snapshot(); assert.equal((await f.metrics({}, f.admin)).status, 200);
      assert.equal((await f.metrics({}, f.staff)).status, 403); assert.equal((await f.metrics({}, null)).status, 401);
      assert.equal((await f.metrics({}, f.buyer)).status, 401); assert.equal((await f.metrics({}, f.serviceKey)).status, 401);
      assert.equal((await f.metrics({}, f.products)).status, 403);
      assert.equal((await f.get(`/v1/merchants/${f.products.merchant_id}/service-metrics?fromDate=2026-11-19&toDate=2026-11-19`, f.products)).status, 403);
      const noScope = await f.get("/v1/analytics/dashboard?period=month", f.wrongScopeKey); assert.equal(noScope.status, 403); assert.equal(noScope.body.code, "missing_api_key_scope");
      const goodKey = await f.get("/v1/analytics/dashboard?period=month", f.productKey); assert.equal(goodKey.status, 200, JSON.stringify(goodKey.body));
      assert.equal(goodKey.body.data.total_revenue_cents, 12345); assert.equal(goodKey.body.meta.version, "v1");
      const foreignPath = await f.get(`/v1/merchants/${f.products.merchant_id}/analytics/dashboard`, f.services); assert.equal(foreignPath.status, 403);
      assert.deepEqual(await f.snapshot(), before);
    });
    await t.test("every old service total, detail, series and funnel read explicitly directs its own canonical endpoint", async () => {
      const before = await f.snapshot();
      for (const route of f.legacyRoutes(f.services.merchant_id)) {
        const result = await f.get(route.path, route.machine ? f.serviceKey : f.services);
        assert.equal(result.status, 409, route.path + ":" + JSON.stringify(result.body)); assert.equal(result.body.code, "service_metrics_endpoint_required");
        assert.match(result.headers.get("content-type") ?? "", /application\/problem\+json/);
        assert.ok(result.body.detail.includes(`/v1/merchants/${f.services.merchant_id}/service-metrics`)); assert.match(result.body.detail, /fromDate.*toDate.*31.*Brasília/);
        assert.equal(result.body.metrics, undefined); assert.equal(result.body.data, undefined);
      }
      assert.equal(f.legacyRoutes(f.services.merchant_id).length, 19); assert.deepEqual(await f.snapshot(), before);
    });
    await t.test("product checkout/store/series and both analytics surfaces retain their real SQL units and totals", async () => {
      const before = await f.snapshot(), mid = f.products.merchant_id;
      const checkout = await f.get(`/v1/checkout/dashboard/overview/${mid}?period=30d`, f.products);
      assert.equal(checkout.status, 200, JSON.stringify(checkout.body)); assert.equal(checkout.body.orders_completed, 1); assert.equal(checkout.body.conversations_started, 1);
      const store = await f.get(`/v1/checkout/dashboard/store-overview/${mid}?period=30d`, f.products);
      assert.equal(store.status, 200, JSON.stringify(store.body)); assert.equal(store.body.revenue, 123.45); assert.equal(store.body.orders_count, 1); assert.equal(store.body.products_sold, 1);
      assert.equal(store.body.top_products[0].revenue, 123.45);
      const series = await f.get(`/v1/checkout/dashboard/overview/timeseries/${mid}?period=30d`, f.products); assert.equal(series.status, 200, JSON.stringify(series.body));
      assert.equal(series.body.revenue_daily.reduce((sum: number, row: { value: number }) => sum + row.value, 0), 123.45);
      assert.equal(series.body.orders_daily.reduce((sum: number, row: { value: number }) => sum + row.value, 0), 1);
      const merchant = await f.get(`/v1/merchants/${mid}/analytics/dashboard?period=month`, f.products); assert.equal(merchant.status, 200, JSON.stringify(merchant.body));
      assert.equal(merchant.body.totalRevenue, 12345); assert.equal(merchant.body.totalOrders, 1);
      const machine = await f.get("/v1/analytics/dashboard?period=month", f.productKey); assert.equal(machine.status, 200, JSON.stringify(machine.body));
      assert.equal(machine.body.data.total_revenue_cents, merchant.body.totalRevenue); assert.equal(machine.body.data.total_orders, merchant.body.totalOrders);
      const range = new URLSearchParams({ date_from: f.productRange.from, date_to: f.productRange.to });
      const detail = await f.get(`/v1/analytics/products/${f.ids.physicalProduct}?${range}`, f.productKey); assert.equal(detail.status, 200, JSON.stringify(detail.body));
      assert.equal(detail.body.data.product_id, f.ids.physicalProduct); assert.equal(detail.body.data.revenue_cents, 12345); assert.equal(detail.body.data.purchase_count, 1);
      const privateRange = new URLSearchParams({ from: f.productRange.from, to: f.productRange.to });
      const list = await f.get(`/v1/merchants/${mid}/analytics/products?${privateRange}`, f.products); assert.equal(list.status, 200, JSON.stringify(list.body));
      assert.equal(list.body.products[0].revenue, detail.body.data.revenue_cents); assert.equal(list.body.products[0].productId, f.ids.physicalProduct);
      assert.deepEqual(await f.snapshot(), before);
    });
    await t.test("unknown classification fails closed while legacy products and original plan priority remain", async () => {
      const service = await f.prisma.merchant.findUniqueOrThrow({ where: { id: f.services.merchant_id } });
      try {
        await f.prisma.merchant.update({ where: { id: service.id }, data: { businessModeNeedsReview: true } });
        for (const path of [f.metricsPath(), `/v1/checkout/dashboard/overview/${service.id}`, "/v1/analytics/dashboard"]) {
          const result = await f.get(path, path.startsWith("/v1/analytics") ? f.serviceKey : f.services);
          assert.equal(result.status, 409, JSON.stringify(result.body)); assert.equal(result.body.code, "business_mode_classification_required");
        }
      } finally { await f.prisma.merchant.update({ where: { id: service.id }, data: { businessModeNeedsReview: service.businessModeNeedsReview } }); }
      const product = await f.prisma.merchant.findUniqueOrThrow({ where: { id: f.products.merchant_id } });
      try {
        await f.prisma.merchant.update({ where: { id: product.id }, data: { businessModeSelectedAt: null } });
        const legacy = await f.get(`/v1/checkout/dashboard/store-overview/${product.id}?period=30d`, f.products); assert.equal(legacy.status, 200, JSON.stringify(legacy.body)); assert.equal(legacy.body.revenue, 123.45);
        await f.prisma.merchant.update({ where: { id: product.id }, data: { businessModeSelectedAt: product.businessModeSelectedAt, plan: "API" } });
        const denied = await f.get(`/v1/merchants/${product.id}/analytics/dashboard`, f.products); assert.equal(denied.status, 403); assert.equal(denied.body.code, "plan_not_allowed");
      } finally { await f.prisma.merchant.update({ where: { id: product.id }, data: { businessModeSelectedAt: product.businessModeSelectedAt, plan: product.plan } }); }
    });
    await t.test("civil filters enforce 31 inclusive days, caller scope rejection and historical Brasília boundaries", async () => {
      const before = await f.snapshot();
      assert.equal((await f.metrics({ fromDate: "2026-10-31", toDate: "2026-11-30" })).status, 200);
      for (const query of [{ fromDate: "2026-10-30", toDate: "2026-11-30" }, { fromDate: "2026-02-30" }, { merchantId: f.products.merchant_id }, { productId: f.ids.serviceA }] as Array<Record<string, string>>) {
        const result = await f.metrics(query); assert.equal(result.status, query.merchantId ? 403 : 400); assert.equal(result.body.code, query.merchantId ? "tenant_mismatch_query" : "invalid_service_metrics_query");
      }
      const historical = await f.metrics({ fromDate: "2018-11-04", toDate: "2018-11-04" }); assert.equal(historical.status, 200, JSON.stringify(historical.body));
      assert.equal(historical.body.period.from, "2018-11-04T03:00:00.000Z"); assert.equal(historical.body.period.until, "2018-11-05T02:00:00.000Z");
      assert.equal(historical.body.metrics.occupancy.occupancyRate, null); assert.equal(historical.body.metrics.occupancy.rateStatus, "not_calculable");
      assert.deepEqual(historical.body.metrics.byStatus, { pending: 0, scheduled: 0, in_service: 0, completed: 0, no_show: 0, cancelled: 0 });
      for (const row of historical.body.metrics.valuesByCurrency) assert.equal(row.received.amountCents, 0);
      assert.equal(historical.body.dataStatus, "complete");
      assert.deepEqual(await f.snapshot(), before);
    });
    await t.test("unclassified paid evidence stays partial and current cart cannot manufacture service income", async () => {
      const seeded = await f.seedUnclassifiedPayment();
      try {
        let before = await f.snapshot(), result = await f.metrics(); assert.equal(result.status, 200, JSON.stringify(result.body));
        assert.equal(result.body.dataStatus, "partial"); assert.equal(result.body.metrics.valuesByCurrency[0].received.amountCents, null);
        assert.equal(result.body.metrics.valuesByCurrency[0].received.knownAmountCents, 9500); assert.deepEqual(await f.snapshot(), before);
        await f.prisma.checkoutSession.updateMany({ where: { merchantId: f.services.merchant_id, sessionId: seeded.sessionId }, data: { cart: { currency: "BRL", items: [{ productType: "service", price: 999999, quantity: 1 }] } } });
        before = await f.snapshot(); result = await f.metrics(); assert.equal(result.body.dataStatus, "partial");
        assert.equal(result.body.metrics.valuesByCurrency[0].received.amountCents, null); assert.equal(result.body.metrics.valuesByCurrency[0].received.knownAmountCents, 9500);
        assert.doesNotMatch(JSON.stringify(result.body), new RegExp(seeded.intentId)); assert.deepEqual(await f.snapshot(), before);
      } finally { await seeded.close(); }
    });
    await t.test("a real owned SQL read failure is unavailable, never a successful zero snapshot", async () => {
      const before = await f.snapshot();
      await f.runtime.db.sql("ALTER TABLE service_appointments RENAME COLUMN operational_status TO synthetic_metrics_unavailable_status;");
      try { const result = await f.metrics(); assert.equal(result.status, 503, JSON.stringify(result.body)); assert.equal(result.body.code, "service_metrics_unavailable"); assert.equal(result.body.metrics, undefined); }
      finally { await f.runtime.db.sql("ALTER TABLE service_appointments RENAME COLUMN synthetic_metrics_unavailable_status TO operational_status;"); }
      assert.deepEqual(await f.snapshot(), before); const restored = await f.metrics(); assert.equal(restored.status, 200, JSON.stringify(restored.body));
      assert.equal(restored.body.metrics.valuesByCurrency[0].received.amountCents, 9500);
    });
    await t.test("T80 operation summary reads current local balance and historic receipts without authorizing a write", async () => {
      const initial = await f.snapshot(), merchantId = f.services.merchant_id;
      const appointment = await f.prisma.serviceAppointment.findUniqueOrThrow({ where: { id: f.ids.completed } });
      const pending = await f.prisma.appointmentPayment.findFirstOrThrow({ where: { merchantId, appointmentId: appointment.id, mode: "at_attendance" } });
      // A synthetic pre-existing partial receipt is history, not a new partial
      // receipt command. The operator may only settle the remaining balance of 3500 cents.
      const receipt = await f.prisma.attendanceReceipt.create({ data: { merchantId, appointmentPaymentId: pending.id, amountCents: 1500, currency: "BRL", paymentMethod: "historic synthetic",
        operatorId: f.services.user_id, receivedAt: new Date("2026-11-19T12:00:00Z"), idempotencyKey: "historic-t80-" + randomUUID(), requestFingerprint: "synthetic-historic-t80" } });
      try {
        const before = await f.snapshot(), path = (id: string) => `/v1/merchants/${merchantId}/service-appointments/${id}/operation-summary`;
        const start = await f.clock(), result = await f.get(path(appointment.id)), finish = await f.clock(); assert.equal(result.status, 200, JSON.stringify(result.body));
        assert.equal(result.headers.get("cache-control"), "no-store"); assert.ok(Date.parse(result.body.asOf) >= start.getTime() && Date.parse(result.body.asOf) <= finish.getTime());
        assert.deepEqual(result.body, { merchantId, appointmentId: appointment.id, appointmentVersion: appointment.version, asOf: result.body.asOf,
          attendanceActions: [], canReviewCancellation: false, canReviewRescheduling: false, localPayments: [{ paymentId: pending.id, paymentVersion: pending.version,
            currency: "BRL", balanceStatus: "available", receivedCents: 1500, remainingCents: 3500, canRecordReceipt: true }] });
        assert.equal((await f.get(path(appointment.id), f.admin)).status, 200);
        const full = await f.prisma.appointmentPayment.findFirstOrThrow({ where: { merchantId, appointmentId: f.ids.noShow, mode: "at_attendance" } });
        const settled = await f.get(path(f.ids.noShow)); assert.equal(settled.status, 200, JSON.stringify(settled.body));
        assert.deepEqual(settled.body.localPayments, [{ paymentId: full.id, paymentVersion: full.version, currency: "BRL", balanceStatus: "not_payable", receivedCents: 5000, remainingCents: 0, canRecordReceipt: false }]);
        assert.deepEqual(settled.body.attendanceActions, []); assert.equal(settled.body.canReviewCancellation, false); assert.equal(settled.body.canReviewRescheduling, false);
        const scheduled = await f.get(path(f.ids.overlap)); assert.equal(scheduled.status, 200, JSON.stringify(scheduled.body));
        assert.deepEqual(scheduled.body.attendanceActions, ["start_service", "no_show"]); assert.equal(scheduled.body.canReviewCancellation, true); assert.equal(scheduled.body.canReviewRescheduling, true);
        assert.deepEqual(scheduled.body.localPayments, []);
        assert.equal((await f.get(path(appointment.id), f.staff)).status, 403); assert.equal((await f.get(path(appointment.id), f.products)).status, 403);
        const missing = await f.get(path("opaque-appointment-not-present")); assert.equal(missing.status, 404); assert.equal(missing.body.code, "service_appointment_not_found");
        assert.doesNotMatch(JSON.stringify([result.body, settled.body, scheduled.body]), /providerEvidence|providerPaymentId|customerSnapshot|PRIVATE_METRICS_CONTACT|PRIVATE_PROVIDER_METRICS/);
        assert.deepEqual(await f.snapshot(), before);
      } finally { await f.prisma.attendanceReceipt.delete({ where: { id: receipt.id } }); }
      assert.deepEqual(await f.snapshot(), initial);
    });
    assert.equal(f.runtime.evidence().canonicalAppModule, true); assert.equal(f.runtime.evidence().authOverrides, false);
    assert.equal(f.runtime.evidence().repositoryOverrides, false); assert.equal(f.runtime.evidence().providerCalls, 0);
  } finally { await f.close(); }
});
