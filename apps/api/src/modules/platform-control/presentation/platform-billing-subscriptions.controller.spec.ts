import assert from "node:assert/strict";
import test from "node:test";
import { BadRequestException } from "@nestjs/common";
import { PlatformBillingSubscriptionsController } from "./platform-billing-subscriptions.controller.js";
import { setPlatformPrincipal, type PlatformPrincipalRequest } from "./platform-principal.js";

test("maps an invalid subscription filter to HTTP 400 without tenant authentication", async () => {
  const controller = new PlatformBillingSubscriptionsController({
    execute: async () => { throw new Error("platform_billing_invalid_status"); },
  } as never);
  const request: PlatformPrincipalRequest & { correlationId?: string } = { correlationId: "corr_1" };
  setPlatformPrincipal(request, {
    operatorId: "operator_1",
    email: "operator@example.com",
    role: "billing_ops",
  });

  await assert.rejects(
    () => controller.list({ status: "paid" }, request),
    error => error instanceof BadRequestException && error.getStatus() === 400,
  );
});
