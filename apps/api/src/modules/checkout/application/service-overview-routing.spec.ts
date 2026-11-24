import "reflect-metadata";
import assert from "node:assert/strict";
import test from "node:test";
import { HttpException, type ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { ProductAnalyticsGuard } from "./service-overview-routing.js";
import { CheckoutController } from "../presentation/http/checkout.controller.js";
import { StorefrontController } from "../../storefront/presentation/http/storefront.controller.js";
import { AnalyticsController } from "../../store-analytics/presentation/http/analytics.controller.js";
import { AnalyticsV1Controller } from "../../public-api/analytics/presentation/http/analytics-v1.controller.js";
import { GetDashboardOverviewUseCase, GetStoreOverviewUseCase, GetTimeseriesUseCase } from "./use-cases/dashboard.use-cases.js";
import { GetDashboardMetricsUseCase } from "../../store-analytics/application/use-cases/get-dashboard-metrics.use-case.js";
import { AuthGuard } from "../../auth/presentation/auth.guard.js";
import { MerchantOwnershipGuard } from "../../auth/presentation/merchant-ownership.guard.js";
import { StaffReadableGuard } from "../../auth/presentation/staff-readable.guard.js";
import { RequirePlanGuard } from "../../../shared/guards/require-plan.guard.js";
import { TenantCredentialGuard } from "../../integrations/presentation/http/tenant-credential.guard.js";
import { TenantAccessGuard } from "../../integrations/presentation/http/tenant-access.guard.js";
import { parseServiceMetricsQuery } from "../../operations/application/read-service-metrics.use-case.js";
import { toProblemDetails } from "../../../shared/http/problem-details.filter.js";

const tenantId = "metrics-product-a";
const human = { kind: "human" as const, tenantId, userId: "owner-a", email: "synthetic@example.test", role: "owner" as const };
function request(principal: unknown, params: Record<string, string> = {}) {
  return { tenantPrincipal: principal, params, user: { merchantId: tenantId, userId: "owner-a", role: "owner" }, query: {} };
}
function context(controller: Function, method: string, req: object): ExecutionContext {
  return { getClass: () => controller, getHandler: () => controller.prototype[method], switchToHttp: () => ({ getRequest: () => req }) } as unknown as ExecutionContext;
}
const guardedRoutes: Array<[Function, string, Record<string, string>]> = [
  ...["overview", "storeOverview", "timeseries", "funnel", "funnelSessions"].map(method => [CheckoutController, method, { merchantId: tenantId }] as [Function, string, Record<string, string>]),
  ...["getFunnel", "getFunnelSessions"].map(method => [StorefrontController, method, { merchantId: tenantId }] as [Function, string, Record<string, string>]),
  ...["dashboard", "overview", "products", "offers", "payments", "customers"].map(method => [AnalyticsController, method, { mid: tenantId }] as [Function, string, Record<string, string>]),
  ...["dashboard", "products", "productDetail", "offersRoi", "payments", "customers"].map(method => [AnalyticsV1Controller, method, {}] as [Function, string, Record<string, string>]),
];
function fixture(overrides: Record<string, unknown> = {}) {
  const state = { row: { businessMode: "products", businessModeSelectedAt: new Date("2026-11-01T12:00:00Z"), businessModeNeedsReview: false, ...overrides } as Record<string, unknown> | null,
    services: 0, reservations: 0, failure: null as Error | null, duringRead: null as (() => void) | null };
  const reads: Array<{ model: string; input: unknown }> = [];
  const tx = { merchant: { findUnique: async (input: unknown) => { reads.push({ model: "merchant", input }); state.duringRead?.(); if (state.failure) throw state.failure; return state.row; } },
    product: { count: async (input: unknown) => { reads.push({ model: "product", input }); return state.services; } },
    serviceReservation: { count: async (input: unknown) => { reads.push({ model: "reservation", input }); return state.reservations; } } };
  let transactions = 0;
  const prisma = { ...tx, $transaction: async (work: (client: typeof tx) => Promise<unknown>, options: unknown) => {
    transactions++; assert.deepEqual(options, { isolationLevel: "RepeatableRead" }); return work(tx);
  } };
  return { state, reads, prisma, transactions: () => transactions, guard: new ProductAnalyticsGuard(prisma as never) };
}
const rejected = (status: number, code: string) => (error: unknown) => error instanceof HttpException && error.getStatus() === status
  && (typeof error.getResponse() === "string" ? error.getResponse() === code : (error.getResponse() as { code?: string; message?: string }).code === code || (error.getResponse() as { message?: string }).message === code);

test("T91", async t => {
  await t.test("guards the real total, detail, series and funnel routes after their original authorization", () => {
    for (const [controller, method] of guardedRoutes) {
      const guards = [...(Reflect.getMetadata("__guards__", controller) ?? []), ...(Reflect.getMetadata("__guards__", controller.prototype[method]) ?? [])];
      assert.equal(guards.at(-1), ProductAnalyticsGuard, controller.name + "." + method);
      const previous = controller === AnalyticsV1Controller ? [TenantCredentialGuard, TenantAccessGuard]
        : controller === AnalyticsController ? [AuthGuard, RequirePlanGuard]
          : controller === CheckoutController && ["funnel", "funnelSessions"].includes(method) ? [AuthGuard, MerchantOwnershipGuard, StaffReadableGuard]
            : [AuthGuard, MerchantOwnershipGuard];
      assert.deepEqual(guards.slice(0, -1), previous);
    }
    assert.equal(Reflect.getMetadata("__guards__", CheckoutController.prototype.start), undefined);
    assert.equal(Reflect.getMetadata("__guards__", StorefrontController.prototype.getCart), undefined);
  });
  await t.test("selected products keep original checkout results, periods, units and analytic mapper", async () => {
    const f = fixture(), req = request(human, { merchantId: tenantId });
    assert.equal(await f.guard.canActivate(context(CheckoutController, "overview", req)), true);
    const calls: unknown[][] = [], overview = { merchant_id: tenantId, orders_completed: 2, conversion_rate_with_agent: .25 }, store = { revenue: 123.45, orders_count: 2 }, series = { revenue_daily: [{ date: "2026-11-19", value: 123.45 }] };
    const model = { overview: async (...args: unknown[]) => { calls.push(["overview", ...args]); return overview; },
      storeOverview: async (...args: unknown[]) => { calls.push(["store", ...args]); return store; }, timeseries: async (...args: unknown[]) => { calls.push(["series", ...args]); return series; } };
    const checkout = Object.create(CheckoutController.prototype) as CheckoutController;
    Object.assign(checkout, {
      getDashboardOverview: new GetDashboardOverviewUseCase(model as never), getStoreOverview: new GetStoreOverviewUseCase(model as never), getTimeseries: new GetTimeseriesUseCase(model as never),
    });
    assert.equal(await checkout.overview(tenantId, "30d"), overview); assert.equal(await checkout.storeOverview(tenantId, "30d"), store); assert.equal(await checkout.timeseries(tenantId, "30d"), series);
    assert.deepEqual(calls, [["overview", tenantId, "30d"], ["store", tenantId, "30d"], ["series", tenantId, "30d"]]);
    let count = 0; const dailyCalls: unknown[][] = [];
    const current = [{ date: new Date("2026-11-19T03:00:00Z"), revenueInCents: 15000, orders: 3, conversations: 10 }];
    const previous = [{ date: new Date("2026-11-12T03:00:00Z"), revenueInCents: 10000, orders: 2, conversations: 5 }];
    const metrics = new GetDashboardMetricsUseCase({ getDailyMetrics: async (...args: unknown[]) => { dailyCalls.push(args); return count++ % 2 === 0 ? current : previous; } } as never);
    const analytics = new AnalyticsController(metrics, {} as never, {} as never, {} as never, {} as never, {} as never);
    const expected = { totalRevenue: 15000, totalOrders: 3, avgOrderValue: 5000, conversionRate: .3, conversations: 10,
      trend: { revenueDelta: 50, ordersDelta: 50 }, daily: current };
    assert.equal(await f.guard.canActivate(context(AnalyticsController, "dashboard", request(human, { mid: tenantId }))), true);
    assert.deepEqual(await analytics.dashboard(req, tenantId, "week"), expected);
    const publicAnalytics = new AnalyticsV1Controller(metrics, {} as never, {} as never, {} as never, {} as never, {} as never);
    const keyReq = request({ kind: "service", tenantId, credentialId: "synthetic-key", environment: "test", scopes: ["analytics:read"] });
    const publicContext = context(AnalyticsV1Controller, "dashboard", keyReq);
    assert.equal(new TenantAccessGuard(new Reflector()).canActivate(publicContext), true);
    assert.equal(await f.guard.canActivate(publicContext), true);
    assert.deepEqual(await publicAnalytics.dashboard(keyReq, "week"), { total_revenue_cents: 15000, total_orders: 3, avg_order_value_cents: 5000, conversion_rate: .3,
      conversations: 10, trend: { revenue_delta: 50, orders_delta: 50 }, daily: [{ date: "2026-11-19", revenue_cents: 15000, orders: 3, conversations: 10 }] });
    assert.ok(dailyCalls.every(args => args[0] === tenantId && args[1] instanceof Date && args[2] instanceof Date));
    assert.equal(f.reads.length, 3); assert.ok(f.reads.every(read => read.model === "merchant"));
  });
  await t.test("service totals, details, series and funnels never enter a legacy read model", async () => {
    let legacyReads = 0;
    for (const [controller, method, params] of guardedRoutes) {
      const f = fixture({ businessMode: "services" });
      const req = { ...request(human, params), query: { period: "90d", fromDate: "2026-11-19", toDate: "2026-11-19", professionalId: "professional-a", categoryId: "category-a" } };
      await assert.rejects(async () => { await f.guard.canActivate(context(controller, method, req)); legacyReads++; }, error => {
        assert.ok(rejected(409, "service_metrics_endpoint_required")(error));
        const problem = toProblemDetails(error, "corr-metrics"); assert.equal(problem.code, "service_metrics_endpoint_required");
        assert.match(problem.detail!, /\/v1\/merchants\/metrics-product-a\/service-metrics/); assert.match(problem.detail!, /fromDate.*toDate/);
        assert.match(problem.detail!, /31.*Brasília/); assert.doesNotMatch(JSON.stringify(problem), /professional-a|category-a|90d/); return true;
      });
      assert.equal(f.reads.length, 1); assert.equal(f.transactions(), 1);
    }
    assert.equal(legacyReads, 0);
    const canonical = parseServiceMetricsQuery({ fromDate: "2026-11-19", toDate: "2026-11-19", professionalId: "professional-a", categoryId: "category-a" });
    assert.equal(canonical.from.toISOString(), "2026-11-19T03:00:00.000Z"); assert.equal(canonical.until.toISOString(), "2026-11-20T03:00:00.000Z");
    assert.equal(canonical.professionalId, "professional-a"); assert.equal(canonical.categoryId, "category-a");
    assert.throws(() => parseServiceMetricsQuery({ fromDate: "2026-01-01", toDate: "2026-03-31" }), rejected(400, "invalid_service_metrics_query"));
  });
  await t.test("legacy products remain compatible while unknown and ambiguous classification fails closed", async () => {
    const ctx = context(CheckoutController, "overview", request(human, { merchantId: tenantId }));
    const legacy = fixture({ businessModeSelectedAt: null }); assert.equal(await legacy.guard.canActivate(ctx), true); assert.equal(legacy.reads.length, 3);
    assert.deepEqual(legacy.reads[1]!.input, { where: { merchantId: tenantId, type: "service" } });
    assert.deepEqual(legacy.reads[2]!.input, { where: { merchantId: tenantId } });
    for (const overrides of [{ businessModeNeedsReview: true }, { businessMode: undefined }, { businessMode: "unknown" }, { businessMode: "services", businessModeSelectedAt: null }]) {
      const f = fixture(overrides); await assert.rejects(f.guard.canActivate(ctx), rejected(409, "business_mode_classification_required"));
    }
    for (const field of ["services", "reservations"] as const) {
      const f = fixture({ businessModeSelectedAt: null }); f.state[field] = 1;
      await assert.rejects(f.guard.canActivate(ctx), rejected(409, "business_mode_classification_required")); assert.ok(f.reads.length <= 3);
    }
    const missing = fixture(); missing.state.row = null; await assert.rejects(missing.guard.canActivate(ctx), rejected(404, "merchant_not_found"));
    const failed = fixture(); const error = new Error("synthetic DB unavailable"); failed.state.failure = error;
    await assert.rejects(failed.guard.canActivate(ctx), candidate => candidate === error);
  });
  await t.test("existing ownership, role, plan and scoped-key denials cannot become service access", async () => {
    const f = fixture();
    await assert.rejects(f.guard.canActivate(context(AnalyticsController, "dashboard", request(human, { mid: "foreign" }))), rejected(403, "access_denied")); assert.equal(f.reads.length, 0);
    assert.throws(() => new MerchantOwnershipGuard().canActivate(context(CheckoutController, "overview", request(human, { merchantId: "foreign" }))), rejected(403, "cross_tenant_access_denied"));
    for (const principal of [undefined, { kind: "buyer", tenantId }, { ...human, role: "buyer" }, { ...human, tenantId: "" }]) {
      await assert.rejects(f.guard.canActivate(context(CheckoutController, "overview", request(principal, { merchantId: tenantId }))));
    }
    const privateRead = context(AnalyticsV1Controller, "dashboard", request({ kind: "service", tenantId, credentialId: "key", environment: "test", scopes: ["catalog:read"] }));
    assert.throws(() => new TenantAccessGuard(new Reflector()).canActivate(privateRead), rejected(403, "missing_api_key_scope"));
    const staff = context(AnalyticsV1Controller, "dashboard", request({ ...human, role: "staff" }));
    assert.throws(() => new TenantAccessGuard(new Reflector()).canActivate(staff), rejected(403, "tenant_role_required"));
    const planGuard = new RequirePlanGuard(new Reflector(), { merchant: { findUnique: async () => ({ id: tenantId, plan: "API" }) } } as never);
    await assert.rejects(planGuard.canActivate(context(AnalyticsController, "dashboard", request(human, { mid: tenantId }))), rejected(403, "plan_not_allowed"));
    assert.equal(f.transactions(), 0);
  });
  await t.test("the authenticated tenant is captured and a changed request cannot admit another scope", async () => {
    const f = fixture(), req = request(human, { merchantId: tenantId });
    f.state.duringRead = () => { req.tenantPrincipal = { ...human, tenantId: "foreign" }; };
    await assert.rejects(f.guard.canActivate(context(CheckoutController, "overview", req)), rejected(403, "access_denied"));
    assert.equal(f.reads.length, 1); assert.deepEqual((f.reads[0]!.input as { where: object }).where, { id: tenantId });
    const changedRole = fixture(), roleReq = request({ ...human }, { merchantId: tenantId });
    changedRole.state.duringRead = () => { (roleReq.tenantPrincipal as { role: string }).role = "buyer"; };
    await assert.rejects(changedRole.guard.canActivate(context(CheckoutController, "overview", roleReq)), rejected(403, "access_denied"));
  });
});
