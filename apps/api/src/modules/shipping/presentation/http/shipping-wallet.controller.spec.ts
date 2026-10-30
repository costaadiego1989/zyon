import "reflect-metadata";
import assert from "node:assert/strict";
import { test } from "node:test";
import { Reflector } from "@nestjs/core";
import { ShippingWalletController } from "./shipping-wallet.controller.js";
import { TenantAccessGuard } from "../../../integrations/presentation/http/tenant-access.guard.js";

test("wallet endpoints derive the merchant exclusively from the authenticated principal", async () => {
  const calls: unknown[] = [];
  const controller = new ShippingWalletController({ get: async (...args: unknown[]) => calls.push(args), configure: async (...args: unknown[]) => calls.push(args) } as never);
  const request = { tenantPrincipal: { kind: "human" as const, tenantId: "authenticated-merchant", role: "owner" as const, userId: "owner", email: "owner@example.test" }, user: { merchantId: "spoofed-merchant" } };
  const settings = { enabled: true, thresholdCents: 10000, emailEnabled: false };
  await controller.get(request, "1"); await controller.configure(request, settings);
  assert.deepEqual(calls, [["authenticated-merchant", true], ["authenticated-merchant", settings]]);
  assert.throws(() => controller.get({}), /missing_tenant_principal/);
});

test("wallet financial data and configuration require an owner or admin human session", () => {
  const guard = new TenantAccessGuard(new Reflector());
  function context(principal: unknown, method = ShippingWalletController.prototype.get) {
    return { getClass: () => ShippingWalletController, getHandler: () => method,
      switchToHttp: () => ({ getRequest: () => ({ tenantPrincipal: principal }) }) } as never;
  }
  for (const role of ["owner", "admin"]) assert.equal(guard.canActivate(context({ kind: "human", tenantId: "a", role })), true);
  for (const method of [ShippingWalletController.prototype.get, ShippingWalletController.prototype.configure]) {
    assert.throws(() => guard.canActivate(context({ kind: "human", tenantId: "a", role: "staff" }, method)), /tenant_role_required/);
    assert.throws(() => guard.canActivate(context({ kind: "service", tenantId: "a", scopes: ["orders:read", "configuration:write"] }, method)), /human_session_required/);
  }
});
