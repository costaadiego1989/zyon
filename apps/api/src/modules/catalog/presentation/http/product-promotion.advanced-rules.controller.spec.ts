import "reflect-metadata";
import assert from "node:assert/strict";
import test from "node:test";
import { GUARDS_METADATA } from "@nestjs/common/constants.js";
import {
  PLAN_LIMIT_REQUIREMENT,
  PlanLimitGuard,
} from "../../../payment/infrastructure/billing/billing-plan-guard.js";
import { ProductPromotionController } from "./product-promotion.controller.js";

test("advanced product rules require the advancedRules plan feature for reads and writes", () => {
  for (const handler of [
    ProductPromotionController.prototype.getRules,
    ProductPromotionController.prototype.upsertRules,
  ]) {
    assert.deepEqual(Reflect.getMetadata(PLAN_LIMIT_REQUIREMENT, handler), {
      kind: "feature",
      key: "advancedRules",
    });
    assert.ok((Reflect.getMetadata(GUARDS_METADATA, handler) as unknown[]).includes(PlanLimitGuard));
  }
});
