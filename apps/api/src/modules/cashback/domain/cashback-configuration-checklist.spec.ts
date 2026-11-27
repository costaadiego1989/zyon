import test from "node:test";
import assert from "node:assert/strict";
import { cashbackConfigurationChecklist } from "./cashback-configuration-checklist.js";
import { CASHBACK_CONFIGURATION_FIELDS } from "./cashback-configuration-step.js";
import { configurationRules } from "../infrastructure/__tests__/cashback-configuration.fixture.js";

test("CBX-38 the checklist exposes all17 canonical labelled decisions with exact groups units and pending state", () => {
  const result = cashbackConfigurationChecklist({});
  assert.equal(result.total, 17); assert.equal(result.completed, 0); assert.equal(result.nextField, "earnRateBps"); assert.deepEqual(result.items.map(i => i.field), CASHBACK_CONFIGURATION_FIELDS);
  assert.deepEqual(result.items[0], { field: "earnRateBps", label: "Ganho", group: "earn", kind: "percent", unit: "percent", completed: false });
  assert.deepEqual(result.items.map(i => i.group), [...Array(5).fill("earn"), ...Array(3).fill("release"), ...Array(3).fill("redeem"), ...Array(5).fill("combination"), "terms"]);
  assert.ok(result.items.every(i => i.label && !i.completed && !Object.hasOwn(i, "value")));
  assert.equal(result.items[1]!.unit, "BRL"); assert.equal(result.items[6]!.unit, "days"); assert.equal(result.items[11]!.kind, "boolean"); assert.equal(result.items[13]!.kind, "choice"); assert.equal(result.items[16]!.kind, "text");
});
test("explicit false null and zero are completed persisted values and not missing defaults", () => {
  const result = cashbackConfigurationChecklist({ minimumEarnCents: 0, expiryDays: null, combination: { allowCoupons: false } });
  assert.equal(result.completed, 3); assert.equal(result.nextField, "earnRateBps");
  assert.deepEqual(result.items.filter(i => i.completed).map(({ field, value }) => ({ field, value })), [{ field: "minimumEarnCents", value: 0 }, { field: "expiryDays", value: null }, { field: "combination.allowCoupons", value: false }]);
});
test("a full explicit canonical draft completes all items and returns no next decision", () => {
  const result = cashbackConfigurationChecklist(configurationRules);
  assert.equal(result.completed, 17); assert.equal(result.total, 17); assert.equal(result.nextField, null); assert.ok(result.items.every(i => i.completed));
  assert.equal(result.items.find(i => i.field === "earnRateBps")!.value, 500); assert.equal(result.items.find(i => i.field === "terms")!.value, configurationRules.terms);
});
test("an amendment changes only the projected current value without stale checklist state", () => {
  const before = cashbackConfigurationChecklist(configurationRules), after = cashbackConfigurationChecklist({ ...configurationRules, earnRateBps: 900 });
  assert.equal(before.items[0]!.value, 500); assert.equal(after.items[0]!.value, 900); assert.deepEqual(after.items.slice(1), before.items.slice(1)); assert.equal(after.nextField, null);
});
test("the checklist cannot mutate a frozen source draft and retains the full terms", () => {
  const terms = "Regulamento completo ".repeat(450), draft = Object.freeze({ earnRateBps: 500, terms, combination: Object.freeze({ allowCoupons: false }) });
  const result = cashbackConfigurationChecklist(draft); assert.equal(result.items.find(i => i.field === "terms")!.value, terms);
  result.items[0]!.value = 700; assert.equal(draft.earnRateBps, 500); assert.equal(draft.combination.allowCoupons, false); assert.equal(draft.terms, terms);
});
