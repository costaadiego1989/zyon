import test from "node:test";
import assert from "node:assert/strict";
import { ForbiddenException } from "@nestjs/common";
import { BillingPlanMeteringService } from "./billing-plan-guard.js";
import type { BillingPlan } from "./payment-platform.types.js";

function metering(plan: BillingPlan, usage: Partial<Awaited<ReturnType<BillingPlanMeteringService["getUsage"]>>>): BillingPlanMeteringService {
  const svc = Object.create(BillingPlanMeteringService.prototype) as BillingPlanMeteringService;
  Object.assign(svc, {
    getEffectivePlan: async () => plan,
    getUsage: async () => ({
      periodStart: "2026-07-01T00:00:00.000Z",
      ordersPerMonth: 0,
      commerceConnections: 0,
      webhookEndpoints: 0,
      teamMembers: 0,
      crossSellPromotions: 0,
      activeCoupons: 0,
      ...usage,
    }),
  });
  return svc;
}

async function withoutBillingBypass(run: () => Promise<void>): Promise<void> {
  const previous = process.env.BILLING_BYPASS;
  delete process.env.BILLING_BYPASS;
  try {
    await run();
  } finally {
    if (previous === undefined) delete process.env.BILLING_BYPASS;
    else process.env.BILLING_BYPASS = previous;
  }
}

test("PlanLimitGuard preserves connection limits", async () => {
  await withoutBillingBypass(async () => {
    const svc = metering("starter", { commerceConnections: 1 });
    await assert.rejects(
      () => svc.assertAllowed("mrc_1", { kind: "limit", key: "commerceConnections" }),
      (err: unknown) => err instanceof ForbiddenException && JSON.stringify(err.getResponse()).includes("plan_limit_exceeded"),
    );
  });
});
test("PlanLimitGuard leaves order admission to OrderQuotaService", async () => {
  await withoutBillingBypass(async () => {
    for (const plan of ["starter", "growth", "scale"] as const) {
      await metering(plan, { ordersPerMonth: 999_999 }).assertAllowed(
        "mrc_1",
        { kind: "limit", key: "ordersPerMonth" },
      );
    }
  });
});

test("PlanLimitGuard blocks unavailable features", async () => {
  await withoutBillingBypass(async () => {
    const svc = metering("starter", {});
    await assert.rejects(
      () => svc.assertAllowed("mrc_1", { kind: "feature", key: "cryptoPayments" }),
      (err: unknown) => err instanceof ForbiddenException && JSON.stringify(err.getResponse()).includes("plan_feature_unavailable"),
    );
  });
});

test("custom domains require Growth, including during the Free trial", async () => {
  await withoutBillingBypass(async () => {
    for (const plan of ["starter"] as const) {
      await assert.rejects(
        () => metering(plan, {}).assertAllowed("mrc_test", { kind: "feature", key: "customDomain" }),
        (error: unknown) => error instanceof ForbiddenException && (error.getResponse() as { required_plan: string }).required_plan === "growth",
      );
    }
    await metering("growth", {}).assertAllowed("mrc_test", { kind: "feature", key: "customDomain" });
    await metering("scale", {}).assertAllowed("mrc_test", { kind: "feature", key: "customDomain" });
  });
});
