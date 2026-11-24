import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PrismaClient, type ServiceAppointmentStatus } from "@prisma/client";
import { ApiKeyService } from "../src/modules/integrations/domain/api-key.service.js";
import { createServiceTestRuntime } from "./service-test-runtime.mjs";
import { companyHttpFixture } from "./service-company-http-fixture.mjs";

type Auth = { access_token: string; merchant_id?: string; user_id?: string };
// Private owned-storage fixture only. It installs no controller, endpoint,
// repository, guard, provider override or new runtime option.
export async function createServiceMetricsHttpFixture() {
  const runtime = await createServiceTestRuntime({ local: true });
  let prisma: PrismaClient | undefined;
  try {
    const db = prisma = new PrismaClient({ datasources: { db: { url: runtime.db.prismaUrl } } });
    const http = companyHttpFixture(runtime), prefix = "metrics-http-" + randomUUID(), password = "SyntheticPassword123!";
    const services = await http.register(prefix + "-services@example.test", "services"), products = await http.register(prefix + "-products@example.test", "products");
    for (const auth of [services, products]) {
      await db.merchant.update({ where: { id: auth.merchant_id }, data: { plan: "BOTH" } });
      await db.merchantBillingSubscription.upsert({ where: { merchantId: auth.merchant_id }, create: { merchantId: auth.merchant_id, planKey: "growth", status: "active" },
        update: { planKey: "growth", status: "active", stripePriceId: null } });
    }
    const ownerUser = await db.merchantUser.findUniqueOrThrow({ where: { id: services.user_id } }); assert.ok(ownerUser.passwordHash);
    const loginMember = async (role: "admin" | "staff") => {
      const email = prefix + "-" + role + "@example.test";
      const user = await db.merchantUser.create({ data: { merchantId: services.merchant_id, email, passwordHash: ownerUser.passwordHash, role } });
      await db.merchantTeamMember.create({ data: { merchantId: services.merchant_id, userId: user.id, role: role === "admin" ? "ADMIN" : "STAFF", invitedBy: services.user_id } });
      const response = await http.request("/v1/auth/login", { email, password }, undefined, "POST");
      assert.equal(response.status, 201, JSON.stringify(response.body)); assert.equal(response.body.merchant_id, services.merchant_id); assert.equal(response.body.user_id, user.id);
      return response.body as Auth;
    };
    const admin = await loginMember("admin"), staff = await loginMember("staff");
    const buyerAccount = await db.buyerAccount.create({ data: { globalUserId: prefix + "-buyer", email: prefix + "-buyer@example.test", displayName: "Synthetic Metrics Buyer", passwordHash: ownerUser.passwordHash } });
    const buyerLogin = await http.request("/v1/buyer/login", { email: buyerAccount.email, password }, undefined, "POST");
    assert.equal(buyerLogin.status, 201, JSON.stringify(buyerLogin.body)); assert.equal(buyerLogin.body.globalUserId, buyerAccount.globalUserId);
    const buyer: Auth = { access_token: buyerLogin.body.accessToken };
    const apiKey = async (merchantId: string, scopes: string[]) => {
      const key = new ApiKeyService().generate("test");
      await db.merchantApiKey.create({ data: { id: randomUUID(), merchantId, name: "Synthetic metrics read", keyHash: key.keyHash, keyPrefix: key.keyPrefix, scopes, environment: "test" } });
      return { access_token: key.rawKey, merchant_id: merchantId } satisfies Auth;
    };
    const productKey = await apiKey(products.merchant_id, ["analytics:read"]), serviceKey = await apiKey(services.merchant_id, ["analytics:read"]), wrongScopeKey = await apiKey(services.merchant_id, ["catalog:read"]);
    const ids = { professionalA: prefix + "-professional-a", professionalB: prefix + "-professional-b", categoryA: prefix + "-category-a", categoryB: prefix + "-category-b",
      serviceA: prefix + "-service-a", serviceB: prefix + "-service-b", variantA: prefix + "-variant-a", variantB: prefix + "-variant-b",
      foreignCategory: prefix + "-foreign-category", foreignProfessional: prefix + "-foreign-professional", noSlotIntent: prefix + "-no-slot-intent", noSlotOrder: prefix + "-no-slot-order",
      completed: prefix + "-completed", noShow: prefix + "-no-show", overlap: prefix + "-overlap", upper: prefix + "-upper", physicalProduct: prefix + "-physical-product", physicalVariant: prefix + "-physical-variant" };
    const merchantId = services.merchant_id, at = new Date("2026-11-19T12:00:00Z");
    await db.serviceBusinessPolicy.upsert({ where: { merchantId }, create: { merchantId, admissionsEnabled: true, holdEnabled: false, holdMinutes: null, paymentMode: "at_attendance", version: 1, configuredAt: at },
      update: { admissionsEnabled: true, holdEnabled: false, holdMinutes: null, paymentMode: "at_attendance", version: 1, configuredAt: at } });
    for (const suffix of ["A", "B"] as const) {
      const categoryId = suffix === "A" ? ids.categoryA : ids.categoryB, professionalId = suffix === "A" ? ids.professionalA : ids.professionalB;
      const productId = suffix === "A" ? ids.serviceA : ids.serviceB, variantId = suffix === "A" ? ids.variantA : ids.variantB;
      await db.productCategory.create({ data: { id: categoryId, merchantId, name: "Synthetic category " + suffix, slug: "metrics-" + suffix.toLowerCase() } });
      await db.product.create({ data: { id: productId, merchantId, type: "service", name: "Synthetic service " + suffix, categoryId,
        variants: { create: { id: variantId, sku: prefix + "-" + suffix, price: { create: { basePriceInCents: 99900, currency: "BRL" } } } } } });
      await db.serviceProfessional.create({ data: { id: professionalId, merchantId, publicName: "Synthetic professional " + suffix, timeZone: suffix === "A" ? "America/Sao_Paulo" : "UTC", isPublished: true } });
      await db.professionalService.create({ data: { merchantId, professionalId, productId } });
      await db.professionalAvailability.create({ data: { merchantId, professionalId, weekday: 4, startMinute: suffix === "A" ? 0 : 180, endMinute: suffix === "A" ? 60 : 240,
        timeZone: suffix === "A" ? "America/Sao_Paulo" : "UTC" } });
    }
    await db.professionalAvailability.create({ data: { merchantId, professionalId: ids.professionalA, weekday: 4, startMinute: 0, endMinute: 30, timeZone: "America/Sao_Paulo" } });
    await db.availabilityException.create({ data: { merchantId, professionalId: ids.professionalA, kind: "block", startsAt: new Date("2026-11-19T03:40:00Z"), endsAt: new Date("2026-11-19T04:00:00Z"), timeZone: "America/Sao_Paulo", actorId: services.user_id } });
    const appointment = async (id: string, start: string, suffix: "A" | "B", status: ServiceAppointmentStatus) => {
      const startsAt = new Date(start), endsAt = new Date(startsAt.getTime() + 20 * 60_000);
      return db.serviceAppointment.create({ data: { id, merchantId, professionalId: suffix === "A" ? ids.professionalA : ids.professionalB,
        productId: suffix === "A" ? ids.serviceA : ids.serviceB, variantId: suffix === "A" ? ids.variantA : ids.variantB,
        startsAt, endsAt, durationMinutes: 20, timeZone: suffix === "A" ? "America/Sao_Paulo" : "UTC", priceInCents: 5000, currency: "BRL",
        customerSnapshot: { name: "PRIVATE_METRICS_CONTACT", email: "private-metrics@example.test" }, origin: "manual", operationalStatus: status,
        policyVersion: 1, policySnapshot: { version: 1, paymentMode: "at_attendance", holdEnabled: false }, idempotencyKey: id, requestFingerprint: "synthetic:" + id, confirmedAt: startsAt,
        ...(status === "completed" ? { startedAt: startsAt, completedAt: endsAt } : status === "no_show" ? { noShowAt: endsAt } : {}) } });
    };
    await appointment(ids.overlap, "2026-11-19T02:50:00Z", "A", "scheduled");
    await appointment(ids.completed, "2026-11-19T03:10:00Z", "A", "completed");
    await appointment(ids.noShow, "2026-11-19T03:00:00Z", "B", "no_show");
    await appointment(ids.upper, "2026-11-20T03:00:00Z", "A", "scheduled");
    await db.appointmentPayment.create({ data: { merchantId, appointmentId: ids.completed, mode: "at_attendance", amountCents: 5000, currency: "BRL", status: "pending", idempotencyKey: prefix + "-unpaid", requestFingerprint: prefix + "-unpaid" } });
    const paid = await db.appointmentPayment.create({ data: { merchantId, appointmentId: ids.noShow, mode: "at_attendance", amountCents: 5000, currency: "BRL", status: "approved", receivedAt: at,
      idempotencyKey: prefix + "-local-paid", requestFingerprint: prefix + "-local-paid" } });
    await db.attendanceReceipt.create({ data: { merchantId, appointmentPaymentId: paid.id, amountCents: 5000, currency: "BRL", paymentMethod: "cash", operatorId: services.user_id,
      receivedAt: at, idempotencyKey: prefix + "-receipt", requestFingerprint: prefix + "-receipt" } });
    const sessionId = prefix + "-no-slot-session", providerId = "PRIVATE_PROVIDER_METRICS-" + prefix;
    await db.checkoutSession.create({ data: { merchantId, sessionId, globalUserId: buyerAccount.globalUserId, conversationId: sessionId, cart: { currency: "BRL", items: [] }, createdAt: at, updatedAt: at } });
    await db.paymentIntent.create({ data: { id: ids.noSlotIntent, merchantId, sessionId, idempotencyKey: ids.noSlotIntent, method: "pix", status: "approved", amountCents: 4700, approvedAmountCents: 4700,
      currency: "BRL", providerPaymentId: providerId, amountBreakdown: { version: 1, currency: "BRL", itemsSubtotalCents: 5000, discountCents: 500, shippingCents: 0, platformFeeCents: 200, totalCents: 4700 },
      statusHistory: [{ status: "approved", occurredAt: at.toISOString() }] } });
    await db.completedOrder.create({ data: { id: ids.noSlotOrder, merchantId, sessionId, externalOrderId: providerId, orderTotal: 45, currency: "BRL", completedAt: at, shippingCents: 0,
      lineItemsJson: [{ snapshotVersion: 2, lineId: prefix + "-no-slot-unit", productType: "service", fulfillmentStrategy: "scheduled_service", variantId: ids.variantA, sku: prefix + "-A", unitPriceCents: 5000, quantity: 1, schedule: { professionalId: ids.professionalA } }] } });
    for (const sequence of [1, 2]) await db.paymentSettlement.create({ data: { merchantId, paymentIntentId: ids.noSlotIntent, sequence, provider: "synthetic", status: "confirmed", currency: "BRL",
      plannedGrossCents: 4700, plannedPlatformFeeCents: 200, plannedMerchantNetCents: 4500, plannedProviderFeeCents: 0, confirmedGrossCents: 4700,
      confirmedPlatformFeeCents: 200, confirmedMerchantNetCents: 4500, confirmedProviderFeeCents: 0, occurredAt: at, confirmedAt: at } });
    await db.return.create({ data: { merchantId, orderId: ids.noSlotOrder, buyerId: buyerAccount.globalUserId, reason: "OTHER", imageUrls: [], status: "REFUND_COMPLETED",
      refund: { create: { paymentIntentId: ids.noSlotIntent, providerRefundId: prefix + "-confirmed-refund", amountInCents: 1000, status: "COMPLETED", processedAt: at } } } });
    await db.productCategory.create({ data: { id: ids.foreignCategory, merchantId: products.merchant_id, name: "FOREIGN_METRICS_CATEGORY", slug: "foreign-metrics" } });
    await db.serviceProfessional.create({ data: { id: ids.foreignProfessional, merchantId: products.merchant_id, publicName: "FOREIGN_METRICS_PROFESSIONAL", timeZone: "UTC", isActive: false } });
    await db.product.create({ data: { id: ids.physicalProduct, merchantId: products.merchant_id, name: "Synthetic physical product", type: "physical",
      variants: { create: { id: ids.physicalVariant, sku: prefix + "-physical", price: { create: { basePriceInCents: 12345, currency: "BRL" } } } } } });
    const clock = async () => (await db.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AS now`)[0]!.now;
    const observedNow = await clock(), productAt = new Date(observedNow.getTime() - 60_000), physicalSession = prefix + "-physical-session";
    await db.checkoutSession.create({ data: { merchantId: products.merchant_id, sessionId: physicalSession, globalUserId: buyerAccount.globalUserId, conversationId: physicalSession,
      cart: { currency: "BRL", total: 123.45, items: [{ sku: prefix + "-physical", product_id: ids.physicalProduct, name: "Synthetic physical product", quantity: 1, price: 123.45 }] }, createdAt: productAt, updatedAt: productAt } });
    await db.paymentIntent.create({ data: { id: prefix + "-physical-intent", merchantId: products.merchant_id, sessionId: physicalSession, idempotencyKey: prefix + "-physical-intent", method: "pix", status: "approved",
      amountCents: 12345, approvedAmountCents: 12345, currency: "BRL", providerPaymentId: prefix + "-physical-order",
      amountBreakdown: { version: 1, currency: "BRL", itemsSubtotalCents: 12345, discountCents: 0, shippingCents: 0, platformFeeCents: 0, totalCents: 12345 },
      statusHistory: [{ status: "approved", occurredAt: productAt.toISOString() }] } });
    await db.completedOrder.create({ data: { merchantId: products.merchant_id, sessionId: physicalSession, externalOrderId: prefix + "-physical-order", orderTotal: 123.45, currency: "BRL", shippingCents: 0, completedAt: productAt,
      lineItemsJson: [{ snapshotVersion: 2, lineId: prefix + "-physical-unit", productType: "physical", variantId: ids.physicalVariant, sku: prefix + "-physical", name: "Synthetic physical product", unitPriceCents: 12345, quantity: 1 }] } });
    await db.checkoutEvent.create({ data: { merchantId: products.merchant_id, sessionId: physicalSession, eventName: "order_completed", metadata: {}, occurredAt: productAt } });
    const yesterday = new Date(Date.UTC(observedNow.getUTCFullYear(), observedNow.getUTCMonth(), observedNow.getUTCDate() - 1));
    const month = new Date(Date.UTC(observedNow.getUTCFullYear(), observedNow.getUTCMonth(), 1));
    await db.storeMetricDaily.create({ data: { merchantId: products.merchant_id, date: yesterday, conversations: 1, orders: 1, revenueInCents: 12345, avgOrderValue: 12345, conversionRate: 1 } });
    await db.storeProductMetric.create({ data: { merchantId: products.merchant_id, productId: ids.physicalProduct, month, impressions: 1, addToCart: 1, purchases: 1, revenue: 12345 } });
    const get = (path: string, auth: Auth | null = services) => http.request(path, undefined, auth?.access_token, "GET");
    const metricsPath = (query: Record<string, string> = {}) => `/v1/merchants/${merchantId}/service-metrics?${new URLSearchParams({ fromDate: "2026-11-19", toDate: "2026-11-19", ...query })}`;
    const metrics = (query: Record<string, string> = {}, auth: Auth | null = services) => get(metricsPath(query), auth);
    const legacyRoutes = (id: string) => [
      ...["overview", "store-overview", "overview/timeseries"].map(part => ({ path: `/v1/checkout/dashboard/${part}/${id}?period=30d`, machine: false })),
      ...[`/v1/checkout/funnel/${id}`, `/v1/checkout/funnel/${id}/sessions`].map(path => ({ path, machine: false })),
      ...["", "/sessions"].map(suffix => ({ path: `/v1/storefront/funnel/${id}${suffix}`, machine: false })),
      ...["dashboard", "overview", "products", "offers", "payments", "customers"].map(part => ({ path: `/v1/merchants/${id}/analytics/${part}`, machine: false })),
      ...["dashboard", "products", `products/${ids.serviceA}`, "offers/roi", "payments", "customers"].map(part => ({ path: `/v1/analytics/${part}`, machine: true })),
    ];
    const snapshot = async () => {
      const where = { merchantId: { in: [merchantId, products.merchant_id] } }, orderBy = { id: "asc" as const };
      const values = await Promise.all([db.serviceAppointment.findMany({ where, orderBy }), db.appointmentPayment.findMany({ where, orderBy }), db.attendanceReceipt.findMany({ where, orderBy }),
        db.paymentIntent.findMany({ where, orderBy }), db.paymentSettlement.findMany({ where, orderBy }), db.completedOrder.findMany({ where, orderBy }), db.checkoutSession.findMany({ where, orderBy }),
        db.product.findMany({ where, orderBy }), db.professionalAvailability.findMany({ where, orderBy }), db.availabilityException.findMany({ where, orderBy }),
        db.inventoryItem.findMany({ where, orderBy }), db.inventoryMovement.findMany({ where, orderBy }), db.storeMetricDaily.findMany({ where, orderBy }), db.storeProductMetric.findMany({ where, orderBy }),
        db.return.findMany({ where, orderBy }), db.returnRefund.findMany({ where: { return: where }, orderBy })]);
      return JSON.parse(JSON.stringify(values));
    };
    const seedUnclassifiedPayment = async () => {
      const id = prefix + "-ambiguous", sessionId = id + "-session";
      await db.checkoutSession.create({ data: { merchantId, sessionId, globalUserId: buyerAccount.globalUserId, conversationId: sessionId, cart: { currency: "BRL", items: [{ productType: "physical", quantity: 1, price: 45 }] }, createdAt: at, updatedAt: at } });
      await db.paymentIntent.create({ data: { id, merchantId, sessionId, idempotencyKey: id, method: "pix", status: "approved", amountCents: 4700, approvedAmountCents: 4700, currency: "BRL",
        amountBreakdown: { version: 1, currency: "BRL", itemsSubtotalCents: 5000, discountCents: 500, shippingCents: 0, platformFeeCents: 200, totalCents: 4700 }, statusHistory: [{ status: "approved", occurredAt: at.toISOString() }] } });
      return { intentId: id, sessionId, close: async () => { await db.paymentIntent.delete({ where: { id } }); await db.checkoutSession.deleteMany({ where: { merchantId, sessionId } }); } };
    };
    const close = async () => {
      const errors: unknown[] = []; try { await db.$disconnect(); } catch (error) { errors.push(error); }
      try { await runtime.close(); } catch (error) { errors.push(error); }
      if (errors.length) throw new AggregateError(errors, "service_metrics_http_cleanup_failed");
      assert.deepEqual(runtime.cleanupEvidence(), { appClosed: true, remainingContainers: 0, remainingBridgeSockets: 0 });
    };
    return { runtime, prisma: db, services, products, admin, staff, buyer, productKey, serviceKey, wrongScopeKey, ids,
      get, metrics, metricsPath, legacyRoutes, snapshot, clock, seedUnclassifiedPayment, close,
      productRange: { from: month.toISOString(), to: new Date(observedNow.getTime() + 86_400_000).toISOString() } };
  } catch (error) {
    const errors: unknown[] = [error]; try { if (prisma) await prisma.$disconnect(); } catch (cleanup) { errors.push(cleanup); }
    try { await runtime.close(); } catch (cleanup) { errors.push(cleanup); }
    if (errors.length > 1) throw new AggregateError(errors, "service_metrics_http_setup_cleanup_failed"); throw error;
  }
}
