import "reflect-metadata";
import assert from "node:assert/strict";
import { test } from "node:test";
import { ForbiddenException, NotFoundException, UnauthorizedException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { GUARDS_METADATA } from "@nestjs/common/constants.js";
import { StorefrontController } from "./storefront.controller.js";
import { CheckoutController } from "../../../checkout/presentation/http/checkout.controller.js";
import { UpdateBudgetRequestStatusUseCase } from "../../application/use-cases/update-budget-request-status.use-case.js";
import { NonProductionRouteGuard } from "../../../../shared/http/non-production-route.guard.js";
import { AuthGuard } from "../../../auth/presentation/auth.guard.js";
import { MerchantOwnershipGuard } from "../../../auth/presentation/merchant-ownership.guard.js";

const request = { tenantPrincipal: { kind: "human" as const, tenantId: "merchant-a", userId: "user-a", email: "a@example.test", role: "owner" as const } };

test("production enables only dashboard handlers and retains their authentication and ownership guards", () => {
  const previous = process.env.NODE_ENV;
  const legacy = process.env.ENABLE_LEGACY_ROUTES;
  process.env.NODE_ENV = "production";
  delete process.env.ENABLE_LEGACY_ROUTES;
  try {
    const guard = new NonProductionRouteGuard(new Reflector());
    for (const [controller, names] of [
      [StorefrontController, ["getFunnel", "getFunnelSessions", "handleListBudgetRequests", "handleUpdateBudgetStatus"]],
      [CheckoutController, ["overview", "storeOverview", "timeseries", "rules", "update", "funnel", "funnelSessions"]],
    ] as const) {
      for (const name of names) {
        const handler = (controller.prototype as any)[name];
        assert.equal(guard.canActivate({ getHandler: () => handler, getClass: () => controller } as never), true);
        const guards = Reflect.getMetadata(GUARDS_METADATA, handler) as any[];
        assert.ok(guards.includes(AuthGuard), name);
        if (!name.startsWith("handle")) assert.ok(guards.includes(MerchantOwnershipGuard), name);
      }
    }
    assert.throws(() => guard.canActivate({ getHandler: () => StorefrontController.prototype.handleCreateBudgetRequest, getClass: () => StorefrontController } as never), NotFoundException);
    const ownership = new MerchantOwnershipGuard();
    assert.throws(() => ownership.canActivate({ switchToHttp: () => ({ getRequest: () => ({ ...request, params: { merchantId: "merchant-b" } }) }) } as never), ForbiddenException);
  } finally {
    if (previous === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previous;
    if (legacy === undefined) delete process.env.ENABLE_LEGACY_ROUTES; else process.env.ENABLE_LEGACY_ROUTES = legacy;
  }
});

test("budget listing uses the authenticated tenant and refuses a different query tenant", async () => {
  const calls: string[] = [];
  const controller = Object.assign(Object.create(StorefrontController.prototype), { listBudgetRequests: { execute: async (id: string) => { calls.push(id); return []; } } });
  await controller.handleListBudgetRequests(request, "merchant-a");
  await controller.handleListBudgetRequests(request);
  await assert.rejects(controller.handleListBudgetRequests(request, "merchant-b"), ForbiddenException);
  await assert.rejects(controller.handleListBudgetRequests({}), UnauthorizedException);
  assert.deepEqual(calls, ["merchant-a", "merchant-a"]);
});

test("budget status changes cannot find or update another tenant's request", async () => {
  const writes: any[] = [];
  const useCase = new UpdateBudgetRequestStatusUseCase({ budgetRequest: {
    findFirst: async ({ where }: any) => where.id === "budget-a" && where.merchantId === "merchant-a" ? { id: "budget-a" } : null,
    update: async (input: any) => { writes.push(input); return { id: input.where.id, status: input.data.status }; },
  } } as any);
  await assert.rejects(useCase.execute("budget-a", "approved", "merchant-b"), NotFoundException);
  assert.equal(writes.length, 0);
  await useCase.execute("budget-a", "approved", "merchant-a");
  assert.deepEqual(writes[0].where, { id: "budget-a", merchantId: "merchant-a" });
});
