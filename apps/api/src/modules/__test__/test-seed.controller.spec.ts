import test from "node:test";
import assert from "node:assert/strict";
import { TestSeedController } from "./test-seed.controller.js";

test("TestSeedController.seed: returns merchantId with e2e_ prefix, embedToken, and productId", () => {
  const controller = new TestSeedController();
  const result = controller.seed();
  assert.ok(result.merchantId.startsWith("e2e_"), "merchantId must have e2e_ prefix");
  assert.ok(typeof result.embedToken === "string" && result.embedToken.length > 10, "embedToken must be non-empty");
  assert.equal(result.productId, "e2e_product_001");
});

test("TestSeedController.seed: each call returns a unique merchantId", () => {
  const controller = new TestSeedController();
  const r1 = controller.seed();
  const r2 = controller.seed();
  assert.notEqual(r1.merchantId, r2.merchantId, "merchantId must be unique per call");
  assert.notEqual(r1.embedToken, r2.embedToken, "embedToken must be unique per call");
});

test("TestSeedController.seed: throws when NODE_ENV=production", () => {
  const prev = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  try {
    const controller = new TestSeedController();
    assert.throws(() => controller.seed());
  } finally {
    process.env.NODE_ENV = prev;
  }
});
