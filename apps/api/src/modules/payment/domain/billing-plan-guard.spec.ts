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
      sessionsPerMonth: 0,
      aiConversationsPerMonth: 0,
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

test("PlanLimitGuard blocks when next monthly usage exceeds plan limit", async () => {
  const svc = metering("starter", { sessionsPerMonth: 50 });
  await assert.rejects(
    () => svc.assertAllowed("mrc_1", { kind: "limit", key: "sessionsPerMonth" }),
    (err: unknown) => err instanceof ForbiddenException && JSON.stringify(err.getResponse()).includes("plan_limit_exceeded"),
  );
});

test("PlanLimitGuard allows unlimited Scale limits", async () => {
  const svc = metering("scale", { ordersPerMonth: 999_999 });
  await svc.assertAllowed("mrc_1", { kind: "limit", key: "ordersPerMonth" });
});

test("PlanLimitGuard blocks unavailable features", async () => {
  const svc = metering("growth", {});
  await assert.rejects(
    () => svc.assertAllowed("mrc_1", { kind: "feature", key: "faceBiometry" }),
    (err: unknown) => err instanceof ForbiddenException && JSON.stringify(err.getResponse()).includes("plan_feature_unavailable"),
  );
});
