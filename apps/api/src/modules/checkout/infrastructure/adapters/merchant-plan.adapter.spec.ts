import test from "node:test";
import assert from "node:assert/strict";
import { MerchantPlanAdapter } from "./merchant-plan.adapter.js";

test("uses the persisted Scale plan when Stripe price mapping is unavailable", async () => {
  const adapter = new MerchantPlanAdapter({
    async getBilling() {
      return { status: "active", trialEndsAt: undefined, stripePriceId: undefined, planKey: "scale" };
    },
  } as never);

  assert.deepEqual(await adapter.resolveExperienceFlags("merchant-scale"), {
    showBranding: false,
    voiceEnabled: true,
  });
});
