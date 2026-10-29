import { test } from "node:test";
import { deepEqual, equal } from "node:assert/strict";
import { PromptVariantEntity, type PromptVariantSnapshot } from "../prompt-variant.entity.js";

test("PromptVariantEntity - create with applied_rule_id", () => {
  const variant = PromptVariantEntity.create({
    experiment_id: "exp-1",
    name: "Treatment with Rule",
    system_prompt: "You are a helpful assistant.",
    weight: 50,
    is_control: false,
    applied_rule_id: "rule-123",
  });

  const snapshot = variant.snapshot();
  equal(snapshot.applied_rule_id, "rule-123");
  equal(snapshot.name, "Treatment with Rule");
  equal(snapshot.is_control, false);
});

test("PromptVariantEntity - create without applied_rule_id (backward-compat)", () => {
  const variant = PromptVariantEntity.create({
    experiment_id: "exp-1",
    name: "Control Variant",
    system_prompt: "You are helpful.",
    weight: 50,
    is_control: true,
  });

  const snapshot = variant.snapshot();
  equal(snapshot.applied_rule_id, null);
  equal(snapshot.is_control, true);
});

test("PromptVariantEntity - rehydrate preserves applied_rule_id", () => {
  const snapshot: PromptVariantSnapshot = {
    id: "var-1",
    experiment_id: "exp-1",
    name: "Variant with Rule",
    system_prompt: "System prompt",
    weight: 50,
    is_control: false,
    applied_rule_id: "rule-456",
    created_at: "2026-08-31T00:00:00Z",
    updated_at: "2026-08-31T00:00:00Z",
  };

  const variant = PromptVariantEntity.rehydrate(snapshot);
  equal(variant.applied_rule_id, "rule-456");
  equal(variant.id, "var-1");
});

test("PromptVariantEntity - rehydrate with null applied_rule_id", () => {
  const snapshot: PromptVariantSnapshot = {
    id: "var-2",
    experiment_id: "exp-1",
    name: "Control Variant",
    system_prompt: "System prompt",
    weight: 50,
    is_control: true,
    applied_rule_id: null,
    created_at: "2026-08-31T00:00:00Z",
    updated_at: "2026-08-31T00:00:00Z",
  };

  const variant = PromptVariantEntity.rehydrate(snapshot);
  equal(variant.applied_rule_id, null);
});

test("PromptVariantEntity - getter returns applied_rule_id", () => {
  const variant = PromptVariantEntity.create({
    experiment_id: "exp-1",
    name: "Test Variant",
    system_prompt: "Test",
    weight: 50,
    is_control: false,
    applied_rule_id: "rule-789",
  });

  equal(variant.applied_rule_id, "rule-789");
});

test("PromptVariantEntity - snapshot includes applied_rule_id field", () => {
  const variant = PromptVariantEntity.create({
    experiment_id: "exp-1",
    name: "Test Variant",
    system_prompt: "Test",
    weight: 50,
    is_control: false,
    applied_rule_id: "rule-abc",
  });

  const snapshot = variant.snapshot();
  deepEqual(Object.keys(snapshot).sort(), [
    "applied_rule_id",
    "created_at",
    "experiment_id",
    "id",
    "is_control",
    "name",
    "system_prompt",
    "updated_at",
    "weight",
  ]);
});
