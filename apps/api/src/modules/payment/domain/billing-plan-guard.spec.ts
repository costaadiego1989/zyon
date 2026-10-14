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
      voiceSessions: 0,
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

test("BillingPlanMeteringService reports the current calendar-month voice reservations", async () => {
  const voicePeriods: unknown[] = [];
  const count = async () => 0;
  const service = new BillingPlanMeteringService({
    completedOrder: { count },
    merchantCommerceConnection: { count },
    merchantWebhookEndpoint: { count },
    merchantTeamMember: { count },
    crossSellPromotion: { count },
    coupon: { count },
    merchantVoiceSessionQuotaPeriod: {
      findUnique: async (input: unknown) => {
        voicePeriods.push(input);
        return { usedSessions: 42 };
      },
    },
  } as never);

  const usage = await service.getUsage(" merchant_1 ", new Date("2026-09-20T12:00:00.000Z"));

  assert.equal(usage.voiceSessions, 42);
  assert.deepEqual(voicePeriods, [{
    where: { merchantId_periodStart: { merchantId: "merchant_1", periodStart: new Date("2026-09-01T00:00:00.000Z") } },
    select: { usedSessions: true },
  }]);
});

test("BillingPlanMeteringService counts only active team memberships for seat limits", async () => {
  let teamMemberWhere: unknown;
  const count = async () => 0;
  const service = new BillingPlanMeteringService({
    completedOrder: { count },
    merchantCommerceConnection: { count },
    merchantWebhookEndpoint: { count },
    merchantTeamMember: { count: async (input: { where: unknown }) => { teamMemberWhere = input.where; return 1; } },
    crossSellPromotion: { count },
    coupon: { count },
    merchantVoiceSessionQuotaPeriod: { findUnique: async () => null },
  } as never);

  const usage = await service.getUsage("merchant_1", new Date("2026-09-20T12:00:00.000Z"));

  assert.equal(usage.teamMembers, 1);
  assert.deepEqual(teamMemberWhere, { merchantId: "merchant_1", user: { disabledAt: null } });
});

test("BillingPlanMeteringService resolves a child store entitlement from its billing account", async () => {
  const subscriptionQueries: unknown[] = [];
  const service = new BillingPlanMeteringService({
    merchant: {
      findUnique: async () => ({ billingAccountMerchantId: "billing_account" }),
    },
    merchantBillingSubscription: {
      findUnique: async (input: unknown) => {
        subscriptionQueries.push(input);
        return {
          merchantId: "billing_account",
          stripeCustomerId: null,
          stripeSubscriptionId: null,
          stripePriceId: null,
          planKey: "scale",
          status: "active",
          trialEndsAt: null,
          currentPeriodEnd: null,
          cancelAtPeriodEnd: false,
          createdAt: new Date("2026-09-01T00:00:00.000Z"),
          updatedAt: new Date("2026-09-01T00:00:00.000Z"),
        };
      },
    },
  } as never);

  assert.equal(await service.getEffectivePlan("child_store"), "scale");
  assert.deepEqual(subscriptionQueries, [{ where: { merchantId: "billing_account" } }]);
});

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
test("PlanLimitGuard enforces active team seats for Free and paid plans", async () => {
  await withoutBillingBypass(async () => {
    await assert.rejects(
      () => metering("starter", { teamMembers: 1 }).assertAllowed("mrc_1", { kind: "limit", key: "teamMembers" }),
      (err: unknown) => err instanceof ForbiddenException && JSON.stringify(err.getResponse()).includes("plan_limit_exceeded"),
    );
    await metering("starter179", { teamMembers: 1 }).assertAllowed("mrc_1", { kind: "limit", key: "teamMembers" });
    await assert.rejects(
      () => metering("starter179", { teamMembers: 2 }).assertAllowed("mrc_1", { kind: "limit", key: "teamMembers" }),
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
