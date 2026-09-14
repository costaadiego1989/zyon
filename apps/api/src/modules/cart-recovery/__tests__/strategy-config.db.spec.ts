import test from "node:test";
import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";
import { PrismaStrategyPreferencesRepository } from "../infrastructure/repositories/prisma-strategy-preferences.repository.js";

// Opt-in only. The fixed disposable localhost database never uses DATABASE_URL.
test("strategy configuration on disposable PostgreSQL", { skip: process.env.CART_RECOVERY_DB_TESTS !== "1" }, async t => {
  const db = new PrismaClient({ datasources: { db: { url: "postgresql://postgres:recovery-local-test@127.0.0.1:55439/recovery_qa" } } });
  const repo = new PrismaStrategyPreferencesRepository(db);
  try {
    await db.$executeRawUnsafe("CREATE TABLE IF NOT EXISTS cart_recovery_strategy_prefs ("
      + "id TEXT PRIMARY KEY, merchant_id TEXT UNIQUE NOT NULL, strategies JSONB NOT NULL DEFAULT '{}', config JSONB, "
      + "created_at TIMESTAMP NOT NULL DEFAULT NOW(), updated_at TIMESTAMP NOT NULL DEFAULT NOW(), "
      + "CONSTRAINT reject_test_coupon CHECK (config->>'coupon_code' IS DISTINCT FROM 'REJECT_TEST_WRITE'))");
    const prefix = "qa-" + Date.now();
    await t.test("partial edits preserve all other links and synchronize selection", async () => {
      await repo.saveConfig(prefix, { active_strategy: "advanced_rule", coupon_code: "SAVE", rule_id: "rule-1" });
      await repo.saveConfig(prefix, { coupon_code: "SAVE20" });
      assert.deepEqual(await repo.getConfig(prefix), { active_strategy: "advanced_rule", coupon_code: "SAVE20", rule_id: "rule-1" });
      assert.equal((await repo.get(prefix)).advanced_rule, true);
    });
    await t.test("concurrent initial links both survive serializable retry", async () => {
      const id = prefix + "-new";
      await Promise.all([repo.saveConfig(id, { coupon_code: "NEW" }), repo.saveConfig(id, { rule_id: "new-rule" })]);
      assert.deepEqual(await repo.getConfig(id), { active_strategy: "offer_coupon", coupon_code: "NEW", rule_id: "new-rule" });
    });
    await t.test("concurrent strategy and coupon edits do not overwrite each other", async () => {
      for (let i = 0; i < 5; i++) {
        await Promise.all([repo.saveConfig(prefix, { active_strategy: "personalized_cross_sell" }), repo.saveConfig(prefix, { coupon_code: "ROUND" + i })]);
        assert.deepEqual(await repo.getConfig(prefix), { active_strategy: "personalized_cross_sell", coupon_code: "ROUND" + i, rule_id: "rule-1" });
        const selected = await repo.get(prefix);
        assert.equal(selected.personalized_cross_sell, true);
        assert.equal(Object.values(selected).filter(Boolean).length, 1);
      }
    });
    await t.test("failed database write changes neither selection nor config", async () => {
      const previous = await repo.getConfig(prefix);
      const selected = await repo.get(prefix);
      await assert.rejects(repo.saveConfig(prefix, { active_strategy: "offer_free_shipping", coupon_code: "REJECT_TEST_WRITE" }));
      assert.deepEqual(await repo.getConfig(prefix), previous);
      assert.deepEqual(await repo.get(prefix), selected);
    });
    await t.test("legacy strategy endpoint and tenant boundaries share the same authority", async () => {
      await repo.save(prefix, { offer_free_shipping: true, personalized_cross_sell: false, offer_coupon: false, advanced_rule: false });
      assert.equal((await repo.getConfig(prefix)).active_strategy, "offer_free_shipping");
      assert.equal((await repo.getConfig(prefix)).rule_id, "rule-1");
      assert.equal((await repo.getConfig(prefix + "-other")).rule_id, undefined);
    });
  } finally { await db.$disconnect(); }
});
