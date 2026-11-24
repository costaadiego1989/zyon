import "reflect-metadata";
import assert from "node:assert/strict";
import test from "node:test";
import { BadRequestException, ConflictException, ForbiddenException, NotFoundException, ServiceUnavailableException,
  type ExecutionContext } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import { ServiceMetricsController } from "./service-metrics.controller.js";
import { ReadServiceMetricsUseCase, parseServiceMetricsQuery } from "../../application/read-service-metrics.use-case.js";
import type { ServiceMetricsSnapshot } from "../../domain/service-metrics.js";
import { AuthGuard } from "../../../auth/presentation/auth.guard.js";
import { MerchantOwnershipGuard } from "../../../auth/presentation/merchant-ownership.guard.js";
import { TENANT_ROLES_METADATA } from "../../../auth/presentation/tenant-role.decorator.js";
import { setTenantPrincipal, type TenantPrincipalRequest } from "../../../../shared/auth/tenant-principal.js";

const page = <T>(items: T[] = []) => ({ items, coverage: "complete" as const });
const actor = { merchantId: "m", userId: "owner", role: "owner" };
const query = { fromDate: "2026-11-19", toDate: "2026-11-19" };
function snapshot(): ServiceMetricsSnapshot {
  return { merchantId: "m", period: { from: new Date("2026-11-19T03:00:00Z"), until: new Date("2026-11-20T03:00:00Z") },
    filters: { professionalId: null, categoryId: null }, timeZone: "America/Sao_Paulo", asOf: new Date("2026-11-21T12:00:00Z"),
    snapshotBasis: "current_repeatable_read", categoryBasis: "current_product_category", financialTimeBasis: "retained_evidence_requires_reduction",
    financialClassificationCoverage: "complete", localReceiptTimeBasis: "operator_recorded_received_at", refundCoverage: "requires_financial_evidence",
    cohort: [], appointments: page(), appointmentPayments: page(), localReceipts: page(), onlinePayments: page(), unclassifiedPaidPayments: page(),
    settlements: page(), settlementEntries: page(), refunds: page(), availability: page(), exceptions: page() };
}
function fixture(result: ServiceMetricsSnapshot | null = snapshot()) {
  let merchant: Record<string, unknown> = { businessMode: "services", businessModeSelectedAt: new Date(), businessModeNeedsReview: false };
  let reads = 0, receivedScope: unknown, readError: unknown;
  const prisma = { $transaction: async (work: (tx: unknown) => Promise<unknown>) => work({
    merchant: { findUnique: async (scope: unknown) => { assert.deepEqual(scope, { where: { id: "m" }, select: {
      businessMode: true, businessModeSelectedAt: true, businessModeNeedsReview: true } }); return merchant; } },
    product: { count: async () => 0 }, serviceReservation: { count: async () => 0 },
  }) } as unknown as PrismaClient;
  const useCase = new ReadServiceMetricsUseCase(prisma, { read: async scope => {
    reads++; receivedScope = scope; if (readError) throw readError; return result;
  } });
  return { useCase, controller: new ServiceMetricsController(useCase), reads: () => reads, scope: () => receivedScope,
    merchant: (value: Record<string, unknown>) => { merchant = value; }, error: (value: unknown) => { readError = value; } };
}
function ownerRequest(role: "owner" | "admin" | "staff" = "owner") {
  const request: TenantPrincipalRequest = {};
  setTenantPrincipal(request, { kind: "human", tenantId: "m", userId: "owner", email: "owner@example.test", role });
  return request;
}

// KPI-01/05/07, ATEND-08. Full JWT/HTTP/DB proof remains the later native gate.
// Every assertion is inside this exact root, selected completely by ^T87$.
test("T87", async () => {
  const oneDay = parseServiceMetricsQuery(query);
  assert.equal(oneDay.from.toISOString(), "2026-11-19T03:00:00.000Z");
  assert.equal(oneDay.until.toISOString(), "2026-11-20T03:00:00.000Z");
  const month = parseServiceMetricsQuery({ fromDate: "2026-01-01", toDate: "2026-01-31" });
  assert.equal(month.until.toISOString(), "2026-02-01T03:00:00.000Z");
  const historical = parseServiceMetricsQuery({ fromDate: "2018-11-04", toDate: "2018-11-04" });
  assert.equal(historical.from.toISOString(), "2018-11-04T03:00:00.000Z");
  assert.equal(historical.until.toISOString(), "2018-11-05T02:00:00.000Z");
  for (const invalid of [null, [], {}, { ...query, fromDate: "2026-02-30" }, { ...query, toDate: "2026-11-18" },
    { fromDate: "2026-01-01", toDate: "2026-02-01" }, { ...query, fromDate: "2026-11-19T00:00:00Z" },
    { ...query, professionalId: ["p"] }, { ...query, professionalId: "" }, { ...query, categoryId: " c " },
    { ...query, categoryId: "c".repeat(192) }, ...["merchantId", "actor", "userId", "timeZone", "asOf", "pageSize", "maxRows", "cursor"].map(key => ({ ...query, [key]: "forged" }))])
    assert.throws(() => parseServiceMetricsQuery(invalid), BadRequestException);

  const guards = Reflect.getMetadata("__guards__", ServiceMetricsController);
  assert.ok(guards.includes(AuthGuard)); assert.ok(guards.includes(MerchantOwnershipGuard));
  assert.deepEqual(Reflect.getMetadata(TENANT_ROLES_METADATA, ServiceMetricsController.prototype.read), ["owner", "admin"]);
  // Metadata wiring only. The final served HTTP test must check the actual
  // response header; this assertion is not a wire-level cache proof.
  assert.deepEqual(Reflect.getMetadata("__headers__", ServiceMetricsController.prototype.read), [{ name: "Cache-Control", value: "no-store" }]);
  const foreignRequest = { ...ownerRequest(), params: { mid: "foreign" } };
  const context = { switchToHttp: () => ({ getRequest: () => foreignRequest }) } as unknown as ExecutionContext;
  assert.throws(() => new MerchantOwnershipGuard().canActivate(context), ForbiddenException);
  const access = fixture();
  await assert.rejects(() => access.controller.read({}, query), /missing_tenant_principal/);
  await assert.rejects(() => access.controller.read(ownerRequest("staff"), query), ForbiddenException);
  const service: TenantPrincipalRequest = {};
  setTenantPrincipal(service, { kind: "service", tenantId: "m", credentialId: "key", environment: "test", scopes: ["analytics:read"] });
  await assert.rejects(() => access.controller.read(service, query), BadRequestException);
  assert.equal(access.reads(), 0);
  access.merchant({ businessMode: "products", businessModeSelectedAt: new Date(), businessModeNeedsReview: false });
  await assert.rejects(() => access.controller.read(ownerRequest(), query), ForbiddenException);
  access.merchant({ businessMode: "services", businessModeSelectedAt: new Date(), businessModeNeedsReview: true });
  await assert.rejects(() => access.controller.read(ownerRequest(), query), ConflictException);
  assert.equal(access.reads(), 0);

  const combined = snapshot(); combined.filters = { professionalId: "p", categoryId: "c" };
  const canonical = fixture(combined);
  const response = await canonical.controller.read(ownerRequest("admin"), { ...query, professionalId: "p", categoryId: "c" });
  assert.deepEqual(canonical.scope(), { merchantId: "m", from: oneDay.from, until: oneDay.until,
    professionalId: "p", categoryId: "c", pageSize: 200, maxRows: 10000 });
  assert.equal(response.businessMode, "services"); assert.equal(response.timeZone, "America/Sao_Paulo");
  assert.equal(response.asOf, "2026-11-21T12:00:00.000Z");
  assert.deepEqual(response.filters, combined.filters);
  assert.equal(response.period.from, "2026-11-19T03:00:00.000Z");
  assert.equal(response.period.until, "2026-11-20T03:00:00.000Z");
  assert.equal(response.dataStatus, "complete"); assert.equal(response.metrics?.occupancy.occupancyRate, null);
  assert.deepEqual(response.temporalBases, { appointments: "appointment_starts_at", occupancy: "overlap_clipped_to_period",
    receivable: "cohort_obligation_as_of", received: "recorded_approval_or_confirmed_observation_and_local_receipt", refunds: "refund_processed_at" });
  const mutableActor = { ...actor };
  let copiedReadTenant: string | undefined;
  const actorMutationPrisma = { $transaction: async (work: (tx: unknown) => Promise<unknown>) => {
    const authorized = await work({ merchant: { findUnique: async (input: { where: { id: string } }) => {
      assert.equal(input.where.id, "m");
      return { businessMode: "services", businessModeSelectedAt: new Date(), businessModeNeedsReview: false };
    } }, product: { count: async () => 0 }, serviceReservation: { count: async () => 0 } });
    mutableActor.merchantId = "foreign"; mutableActor.userId = "other"; mutableActor.role = "staff";
    return authorized;
  } } as unknown as PrismaClient;
  const immutableScope = new ReadServiceMetricsUseCase(actorMutationPrisma, { read: async scope => {
    copiedReadTenant = scope.merchantId;
    assert.equal(scope.merchantId, "m");
    return snapshot();
  } });
  const immutableResponse = await immutableScope.execute(mutableActor, query);
  assert.equal(mutableActor.merchantId, "foreign", "the authorization fixture really changed the caller's object");
  assert.equal(copiedReadTenant, "m");
  assert.equal(immutableResponse.merchantId, "m");
  assert.equal(immutableResponse.dataStatus, "complete");

  const values = snapshot();
  values.localReceipts.items = [{ id: "receipt", merchantId: "m", appointmentPaymentId: "balance", appointmentId: "a", professionalId: "p",
    categoryId: "c", amountCents: 5000, currency: "BRL", receivedAt: new Date("2026-11-19T12:00:00Z") },
    { id: "usd", merchantId: "m", appointmentPaymentId: "usd", appointmentId: "usd", professionalId: "p", categoryId: "c",
      amountCents: 300, currency: "USD", receivedAt: new Date("2026-11-19T12:00:00Z") }];
  values.refunds.items = [{ id: "private-refund-id", merchantId: "m", paymentIntentId: "private-provider-intent", returnId: "return", orderId: "order",
    amountCents: 1000, currency: "BRL", providerRefundId: "private-provider-refund-id", status: "COMPLETED", processedAt: new Date("2026-11-19T13:00:00Z") }];
  values.exceptions.items = [{ id: "private-capacity-source", professionalId: "p", kind: "one_off", timeZone: "UTC",
    startsAt: new Date("2026-11-19T10:00:00Z"), endsAt: new Date("2026-11-19T12:00:00Z") }];
  const complete = await fixture(values).useCase.execute(actor, query);
  assert.equal(complete.currency, null); assert.deepEqual(complete.currencies, ["BRL", "USD"]);
  assert.equal(complete.metrics?.valuesByCurrency[0]?.received.amountCents, 5000);
  assert.equal(complete.metrics?.valuesByCurrency[0]?.refunds.amountCents, 1000);
  assert.equal(complete.metrics?.valuesByCurrency[1]?.received.amountCents, 300);
  assert.equal(complete.metrics?.valuesByCurrency[0]?.received.temporalBasis, complete.temporalBases.received);
  assert.equal(complete.metrics?.occupancy.offeredMinutes, 120);
  assert.equal(complete.metrics?.occupancy.professionals.reduce((sum, row) => sum + row.offeredMinutes, 0), 120);
  assert.ok(!JSON.stringify(complete).includes("private-"));
  values.localReceipts.coverage = "partial";
  const partial = await fixture(values).useCase.execute(actor, query);
  assert.equal(partial.dataStatus, "partial");
  assert.equal(partial.metrics?.valuesByCurrency[0]?.received.amountCents, null);
  assert.equal(partial.metrics?.valuesByCurrency[0]?.received.knownAmountCents, 5000);
  const unknown = snapshot(); unknown.financialClassificationCoverage = "partial";
  unknown.unclassifiedPaidPayments.items = [{ id: "private-unknown-payment", merchantId: "m", sessionId: "private-session", status: "approved",
    currency: "BRL", amountCents: 10200, approvedAmountCents: 10200, providerPaymentId: "private-provider-id",
    amountBreakdown: null, statusHistory: [], classification: "unproven", firstConfirmedSettlementOccurredAt: null,
    firstConfirmedSettlementConfirmedAt: null }];
  const unknownResponse = await fixture(unknown).useCase.execute(actor, query);
  assert.equal(unknownResponse.dataStatus, "partial");
  assert.equal(unknownResponse.metrics?.valuesByCurrency[0]?.received.amountCents, null);
  assert.equal(unknownResponse.metrics?.valuesByCurrency[0]?.received.knownAmountCents, 0);
  assert.ok(!JSON.stringify(unknownResponse).includes("private-"));
  const unavailable = await fixture(null).useCase.execute(actor, query);
  assert.equal(unavailable.dataStatus, "unavailable"); assert.equal(unavailable.metrics, null); assert.equal(unavailable.asOf, null);
  const foreignSnapshot = snapshot(); foreignSnapshot.merchantId = "foreign";
  await assert.rejects(() => fixture(foreignSnapshot).useCase.execute(actor, query), ServiceUnavailableException);
  const filteredError = fixture(); filteredError.error(new Error("service_metrics_filter_not_found"));
  await assert.rejects(() => filteredError.useCase.execute(actor, { ...query, professionalId: "foreign" }), NotFoundException);
  const failed = fixture(); const privateFailure = new Error("private-db-failure"); failed.error(privateFailure);
  await assert.rejects(() => failed.useCase.execute(actor, query), (error: unknown) => {
    assert.ok(error instanceof ServiceUnavailableException);
    assert.equal(error.cause, privateFailure);
    assert.ok(!JSON.stringify(error.getResponse()).includes("private-db-failure"));
    return true;
  });
});
