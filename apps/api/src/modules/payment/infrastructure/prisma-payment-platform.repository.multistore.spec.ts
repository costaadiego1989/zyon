import assert from "node:assert/strict";
import test from "node:test";
import { PrismaPaymentPlatformRepository } from "./prisma-payment-platform.repository.js";

test("a child store reads and creates billing only for its Scale billing account", async () => {
  const trialLookups: string[] = [];
  const createdBilling: Array<Record<string, unknown>> = [];
  const activeSubscription = {
    merchantId: "account_store", stripeCustomerId: "cus_account", stripeSubscriptionId: "sub_account", stripePriceId: "price_scale",
    provider: "stripe", planKey: "scale", status: "active", trialEndsAt: null, currentPeriodEnd: null, cancelAtPeriodEnd: false,
    asaasCustomerId: null, asaasSubscriptionId: null, pendingPlanKey: null, pendingUpgradePlanKey: null, pendingUpgradeAmountCents: null,
    pendingUpgradeRequestedAt: null, billingAmountCents: null, billingCycle: "monthly", billingDiscountPercent: 0, pendingBillingCycle: null,
    pendingBillingAmountCents: null, pendingBillingDiscountPercent: null, lastBillingEventAt: null, lastBillingPaymentId: null,
    lastBillingPaymentDueAt: null, pendingPlanEffectiveAt: null, providerCancellationScheduledAt: null, createdAt: new Date(), updatedAt: new Date(),
  };
  const prisma = {
    merchant: { findUnique: async () => ({ billingAccountMerchantId: "account_store" }) },
    merchantBillingSubscription: {
      findUnique: async ({ where }: { where: { merchantId: string } }) => { trialLookups.push(where.merchantId); return activeSubscription; },
      create: async ({ data }: { data: Record<string, unknown> }) => { createdBilling.push(data); return { ...activeSubscription, ...data }; },
    },
  } as never;
  const repository = new PrismaPaymentPlatformRepository(prisma);

  const billing = await repository.getOrCreateTrial("child_store", 14);
  assert.equal(billing.merchantId, "account_store");
  assert.deepEqual(trialLookups, ["account_store"]);
  assert.deepEqual(createdBilling, []);
});
