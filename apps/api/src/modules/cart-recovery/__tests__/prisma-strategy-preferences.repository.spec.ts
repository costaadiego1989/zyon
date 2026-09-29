import test from "node:test";
import assert from "node:assert/strict";
import { PrismaStrategyPreferencesRepository } from "../infrastructure/repositories/prisma-strategy-preferences.repository.js";

function repository(row: { config: unknown; strategies: unknown }) {
  return new PrismaStrategyPreferencesRepository({
    cartRecoveryStrategyPref: {
      findUnique: async () => row,
    },
  } as any);
}

test("legacy unselected coupon default becomes the dispatchable reminder", async () => {
  const repo = repository({
    config: { active_strategy: "offer_coupon" },
    strategies: {},
  });

  assert.deepEqual(await repo.getConfig("merchant"), {
    active_strategy: "personalized_cross_sell",
    coupon_code: undefined,
    rule_id: undefined,
  });
});

test("an explicit coupon selection remains paused until a coupon is configured", async () => {
  const repo = repository({
    config: { active_strategy: "offer_coupon" },
    strategies: { offer_coupon: true },
  });

  assert.deepEqual(await repo.getConfig("merchant"), {
    active_strategy: "offer_coupon",
    coupon_code: undefined,
    rule_id: undefined,
  });
});
