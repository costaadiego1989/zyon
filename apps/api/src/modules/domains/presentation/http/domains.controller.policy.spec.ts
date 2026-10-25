import "reflect-metadata";
import assert from "node:assert/strict";
import test from "node:test";
import { GUARDS_METADATA } from "@nestjs/common/constants.js";
import { AuthGuard } from "../../../auth/presentation/auth.guard.js";
import {
  PLAN_LIMIT_REQUIREMENT,
  PlanLimitGuard,
} from "../../../payment/domain/billing-plan-guard.js";
import { DomainsController } from "./domains.controller.js";

test("domain reads are available to authenticated merchants without granting domain mutations", () => {
  const controllerGuards = Reflect.getMetadata(GUARDS_METADATA, DomainsController) as unknown[];
  assert.ok(controllerGuards.includes(AuthGuard));
  assert.ok(!controllerGuards.includes(PlanLimitGuard));
  assert.equal(Reflect.getMetadata(PLAN_LIMIT_REQUIREMENT, DomainsController.prototype.list), undefined);

  for (const handler of [
    DomainsController.prototype.register,
    DomainsController.prototype.verify,
    DomainsController.prototype.remove,
  ]) {
    assert.deepEqual(Reflect.getMetadata(PLAN_LIMIT_REQUIREMENT, handler), {
      kind: "feature",
      key: "customDomain",
    });
    assert.ok((Reflect.getMetadata(GUARDS_METADATA, handler) as unknown[]).includes(PlanLimitGuard));
  }
});
