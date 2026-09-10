import assert from "node:assert/strict";
import { BadRequestException } from "@nestjs/common";
import test from "node:test";
import { InventoryDashboardController } from "./inventory-dashboard.controller.js";

function setup() {
  const calls: Array<Record<string, unknown>> = [];
  const connectCrm = {
    async execute(input: Record<string, unknown>) {
      calls.push(input);
      return { id: "crm_connection_1", status: "connected" };
    },
  };
  const unavailable = {} as never;
  const controller = new InventoryDashboardController(
    unavailable, unavailable, unavailable, unavailable, unavailable, unavailable,
    unavailable, unavailable, unavailable, unavailable, unavailable, unavailable,
    connectCrm as never, unavailable, unavailable, unavailable, unavailable, unavailable,
  );
  return { calls, controller };
}

const request = { user: { userId: "user_1", merchantId: "merchant_1", email: "owner@example.test", role: "owner" as const } };

test("InventoryDashboardController forwards the canonical CRM accessToken", async () => {
  const { calls, controller } = setup();

  await controller.connectCrmProvider(request, "hubspot", {
    accessToken: " canonical-token ",
    refreshToken: "refresh-token",
    config: { pipeline: "default" },
  });

  assert.deepEqual(calls, [{
    merchantId: "merchant_1",
    provider: "hubspot",
    accessToken: "canonical-token",
    refreshToken: "refresh-token",
    config: { pipeline: "default" },
  }]);
});

test("InventoryDashboardController accepts the legacy CRM token field during migration", async () => {
  const { calls, controller } = setup();

  await controller.connectCrmProvider(request, "pipedrive", { token: " legacy-token " });

  assert.equal(calls[0]?.accessToken, "legacy-token");
});

test("InventoryDashboardController rejects a CRM connection without a credential", async () => {
  const { controller } = setup();

  await assert.rejects(
    () => controller.connectCrmProvider(request, "rdstation", {}),
    (error: unknown) => error instanceof BadRequestException && error.message === "crm_access_token_required",
  );
});
