import test from "node:test";
import assert from "node:assert/strict";
import { createCheckoutExperienceConfig } from "../../modules/checkout/infrastructure/checkout-experience.config.factory.js";
import { readBuyerServiceFeeCents } from "../../modules/payment/infrastructure/stripe-env.js";

test("checkout display and payment collection resolve the same buyer service fee", () => {
  const cases: Array<{ env: NodeJS.ProcessEnv; cents: number }> = [
    { env: {} as NodeJS.ProcessEnv, cents: 99 },
    { env: { PLATFORM_FEE_BRL: "invalid" } as NodeJS.ProcessEnv, cents: 99 },
    { env: { PLATFORM_FEE_BRL: "-1" } as NodeJS.ProcessEnv, cents: 99 },
    { env: { PLATFORM_FEE_BRL: "1,23" } as NodeJS.ProcessEnv, cents: 123 },
  ];

  for (const { env, cents } of cases) {
    assert.equal(readBuyerServiceFeeCents(env), cents);
    assert.equal(createCheckoutExperienceConfig(env).platformFeeBrl, cents / 100);
  }
});
