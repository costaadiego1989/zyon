import assert from "node:assert/strict";
import test from "node:test";
import { UpdateMerchantThemeUseCase } from "./update-merchant-theme.use-case.js";

test("store settings preserves all supported policies and tenant isolation on company/social save", async () => {
  const state = new Map<string, unknown>([["other", { company: { name: "Other" } }]]);
  const service = new UpdateMerchantThemeUseCase({ updateStoreSettings: async (id: string, value: unknown) => {
    state.set(id, structuredClone(value)); return value;
  } } as never);
  const policies = Object.fromEntries(["privacy", "terms", "returns", "shipping", "warranty", "payment", "general"].map(key => [key, ` ${key} text `]));
  await service.updateStoreSettings("athom", { company: { name: "Athom" }, social: { instagram: "https://example.com/athom" }, policies });
  assert.deepEqual(state.get("athom"), { company: { name: "Athom" }, social: { instagram: "https://example.com/athom" },
    policies: Object.fromEntries(Object.keys(policies).map(key => [key, `${key} text`])) });
  assert.deepEqual(state.get("other"), { company: { name: "Other" } });
});

test("store settings rejects unknown policies and invalid values without saving", async () => {
  const writes: unknown[] = [];
  const service = new UpdateMerchantThemeUseCase({ updateStoreSettings: async (...args: unknown[]) => { writes.push(args); } } as never);
  for (const policies of [{ execute: "override" }, { warranty: 12 }, { payment: null }, { general: "x".repeat(10001) }])
    await assert.rejects(service.updateStoreSettings("athom", { policies }), /invalid_store_policy/);
  assert.deepEqual(writes, []);
});

test("store settings preserves supported policies at the inclusive text limit", async () => {
  const state = new Map<string, unknown>([["other", { policies: { warranty: "Other warranty" } }]]);
  const service = new UpdateMerchantThemeUseCase({ updateStoreSettings: async (id: string, value: unknown) => {
    state.set(id, structuredClone(value)); return value;
  } } as never);
  const text = "x".repeat(10000);
  await service.updateStoreSettings("athom", { policies: { warranty: text } });
  assert.deepEqual(state.get("athom"), { policies: { warranty: text } });
  assert.deepEqual(state.get("other"), { policies: { warranty: "Other warranty" } });
});
