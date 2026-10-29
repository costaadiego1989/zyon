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

test("legacy mismatched selected reminder and incomplete coupon config becomes the reminder", async () => {
  const repo = repository({
    config: { active_strategy: "offer_coupon" },
    strategies: { personalized_cross_sell: true },
  });

  assert.deepEqual(await repo.getConfig("merchant"), {
    active_strategy: "personalized_cross_sell",
    coupon_code: undefined,
    rule_id: undefined,
  });
});

test("a legacy selected coupon without a code becomes the safe reminder", async () => {
  const repo = repository({
    config: { active_strategy: "offer_coupon" },
    strategies: { offer_coupon: true },
  });

  assert.deepEqual(await repo.getConfig("merchant"), {
    active_strategy: "personalized_cross_sell",
    coupon_code: undefined,
    rule_id: undefined,
  });
});

test("an incomplete advanced rule becomes the safe reminder", async () => {
  const repo = repository({
    config: { active_strategy: "advanced_rule" },
    strategies: { advanced_rule: true },
  });

  assert.deepEqual(await repo.getConfig("merchant"), {
    active_strategy: "personalized_cross_sell",
    coupon_code: undefined,
    rule_id: undefined,
  });
});

test("an unsupported legacy strategy becomes the safe reminder", async () => {
  const repo = repository({
    config: { active_strategy: "retired_strategy" },
    strategies: {},
  });

  assert.deepEqual(await repo.getConfig("merchant"), {
    active_strategy: "personalized_cross_sell",
    coupon_code: undefined,
    rule_id: undefined,
  });
});
