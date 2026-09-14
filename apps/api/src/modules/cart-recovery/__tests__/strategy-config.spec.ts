import test from "node:test";
import assert from "node:assert/strict";
import { UpdateStrategyConfigUseCase } from "../application/use-cases/update-strategy-config.use-case.js";
import { UpdateStrategyPreferencesUseCase } from "../application/use-cases/update-strategy-preferences.use-case.js";
import { InMemoryStrategyPreferencesRepository } from "../infrastructure/repositories/in-memory-strategy-preferences.repository.js";
import { TOGGLEABLE_STRATEGY_KEYS } from "../domain/values/recovery-strategy.js";

for (const strategy of TOGGLEABLE_STRATEGY_KEYS) {
  test("configuration preserves links and synchronizes selection: " + strategy, async () => {
    const repo = new InMemoryStrategyPreferencesRepository();
    const update = new UpdateStrategyConfigUseCase(repo);
    await update.execute({ merchantId: "shop-a", active_strategy: "advanced_rule", coupon_code: "SAVE", rule_id: "rule-1" });
    assert.deepEqual(await update.execute({ merchantId: "shop-a", active_strategy: strategy }), {
      active_strategy: strategy, coupon_code: "SAVE", rule_id: "rule-1",
    });
    const prefs = await repo.get("shop-a");
    assert.equal(prefs[strategy], true);
    assert.equal(Object.values(prefs).filter(Boolean).length, 1);
    const changed = await update.execute({ merchantId: "shop-a", rule_id: " rule-2 " });
    assert.equal(changed.active_strategy, strategy);
    assert.equal(changed.coupon_code, "SAVE");
    assert.equal(changed.rule_id, "rule-2");
    assert.equal((await repo.getConfig("shop-b")).rule_id, undefined);
  });
}

test("legacy strategy endpoint updates scanner config without deleting links", async () => {
  const repo = new InMemoryStrategyPreferencesRepository();
  await repo.saveConfig("shop", { coupon_code: "SAVE", rule_id: "rule-1" });
  await new UpdateStrategyPreferencesUseCase(repo).execute({ merchantId: "shop", strategies: { advanced_rule: true } });
  assert.deepEqual(await repo.getConfig("shop"), { active_strategy: "advanced_rule", coupon_code: "SAVE", rule_id: "rule-1" });
});

for (const patch of [{ active_strategy: "invented" }, { active_strategy: null }, { coupon_code: 10 }, { rule_id: {} }]) {
  test("invalid recovery configuration is rejected: " + JSON.stringify(patch), async () => {
    const repo = new InMemoryStrategyPreferencesRepository();
    const before = await repo.getConfig("shop");
    await assert.rejects(new UpdateStrategyConfigUseCase(repo).execute({ merchantId: "shop", ...patch } as any));
    assert.deepEqual(await repo.getConfig("shop"), before);
  });
}
