import assert from "node:assert/strict";
import test from "node:test";
import { ForbiddenException } from "@nestjs/common";
import { PublicStorefrontAccessService } from "./public-storefront-access.service.js";

function billing(subscription: unknown) {
  return { getSubscription: async () => subscription } as never;
}

test("permits an active trial and an active paid subscription to serve the public store", async () => {
  const trial = new PublicStorefrontAccessService(billing({
    status: "trialing",
    trialEndsAt: "2030-01-02T00:00:00.000Z",
    planKey: "starter",
  }));
  await trial.assertMerchantCanServe("merchant_trial", new Date("2030-01-01T00:00:00.000Z"));

  const paid = new PublicStorefrontAccessService(billing({
    status: "active",
    planKey: "growth",
  }));
  await paid.assertMerchantCanServe("merchant_paid", new Date("2030-01-01T00:00:00.000Z"));
});

test("blocks an expired trial with the public-site redirect contract", async () => {
  const access = new PublicStorefrontAccessService(billing({
    status: "starter",
    trialEndsAt: "2029-12-31T00:00:00.000Z",
    planKey: "starter",
  }));

  await assert.rejects(
    () => access.assertMerchantCanServe("merchant_expired", new Date("2030-01-01T00:00:00.000Z")),
    (error: unknown) => {
      assert.ok(error instanceof ForbiddenException);
      assert.deepEqual(error.getResponse(), {
        code: "store_subscription_required",
        redirect_url: "https://www.zyon-payments.com.br/",
      });
      return true;
    },
  );
});
