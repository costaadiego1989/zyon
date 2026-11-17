import "reflect-metadata";
import assert from "node:assert/strict";
import test from "node:test";
import type { ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { PrismaClient } from "@prisma/client";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import type { TenantPrincipal, TenantPrincipalRequest } from "../../../../shared/auth/tenant-principal.js";
import { TenantContextService } from "../../../../shared/tenant/tenant-context.service.js";
import { TenantAccessGuard } from "../../../integrations/presentation/http/tenant-access.guard.js";
import { ManageSupportNotificationSettingsUseCase } from "../../application/manage-support-notification-settings.use-case.js";
import { SupportNotificationSettingsController, UpdateSupportNotificationSettingsDto } from "./support-notification-settings.controller.js";

const human = (role: "owner" | "admin" | "staff", tenantId = "merchant-a"): TenantPrincipal => ({
  kind: "human", tenantId, userId: "operator-a", email: "synthetic@example.test", role,
});
const service = (scopes: readonly string[]): TenantPrincipal => ({
  kind: "service", tenantId: "merchant-a", credentialId: "synthetic-key", environment: "test", scopes,
});
function context(method: "get" | "save", principal?: TenantPrincipal): ExecutionContext {
  const request: TenantPrincipalRequest = principal ? { tenantPrincipal: principal } : {};
  return {
    getHandler: () => SupportNotificationSettingsController.prototype[method],
    getClass: () => SupportNotificationSettingsController,
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}
function denial(status: number, message: string) {
  return (error: unknown): boolean => {
    assert.equal((error as { getStatus(): number }).getStatus(), status);
    assert.equal((error as Error).message, message);
    return true;
  };
}
function readFixture() {
  const tenant = new TenantContextService();
  const rows = new Map([
    ["merchant-a", { fallbackWhatsapp: "+12125550183", version: 3, updatedAt: new Date("2030-01-01T00:00:00Z") }],
    ["merchant-b", { fallbackWhatsapp: "+12125550184", version: 7, updatedAt: new Date("2030-01-02T00:00:00Z") }],
  ]);
  let calls = 0;
  const prisma = { supportNotificationSetting: { findUnique: async ({ where }: { where: { merchantId: string } }) => {
    calls += 1;
    return rows.get(where.merchantId) ?? null;
  } } };
  const controller = new SupportNotificationSettingsController(
    new ManageSupportNotificationSettingsUseCase(prisma as unknown as PrismaClient, tenant),
  );
  return { controller, rows, calls: () => calls,
    within: <T>(work: () => T) => tenant.run({ merchantId: "merchant-a", userId: "operator-a", role: "owner" }, work) };
}

test("HUM-09 private recipient controller", async t => {
  const guard = new TenantAccessGuard(new Reflector());
  await t.test("owners and admins may read and update the private setting", () => {
    for (const role of ["owner", "admin"] as const) {
      for (const method of ["get", "save"] as const) assert.equal(guard.canActivate(context(method, human(role))), true);
    }
  });
  await t.test("staff cannot read or update the private recipient", () => {
    for (const method of ["get", "save"] as const) {
      assert.throws(() => guard.canActivate(context(method, human("staff"))), denial(403, "tenant_role_required"));
    }
  });
  await t.test("an absent principal grants neither read nor update", () => {
    for (const method of ["get", "save"] as const) {
      assert.throws(() => guard.canActivate(context(method)), denial(401, "missing_tenant_principal"));
    }
  });
  await t.test("a support read key cannot update the private setting", () => {
    const principal = service(["support:read"]);
    assert.equal(guard.canActivate(context("get", principal)), true);
    assert.throws(() => guard.canActivate(context("save", principal)), denial(403, "missing_api_key_scope"));
  });
  await t.test("a support write key cannot disclose the private setting through GET", () => {
    const principal = service(["support:write"]);
    assert.equal(guard.canActivate(context("save", principal)), true);
    assert.throws(() => guard.canActivate(context("get", principal)), denial(403, "missing_api_key_scope"));
  });
  await t.test("an unrelated configuration scope grants no private support access", () => {
    for (const method of ["get", "save"] as const) {
      assert.throws(() => guard.canActivate(context(method, service(["configuration:read", "configuration:write"]))), denial(403, "missing_api_key_scope"));
    }
  });
  await t.test("the actual request DTO accepts a phone and explicit null", async () => {
    for (const fallbackPhone of ["+1 (212) 555-0183", null]) {
      const dto = plainToInstance(UpdateSupportNotificationSettingsDto, { fallbackPhone });
      assert.deepEqual(await validate(dto, { whitelist: true, forbidNonWhitelisted: true }), []);
      assert.deepEqual(dto.fallbackPhone, fallbackPhone);
    }
  });
  await t.test("missing, invalid and forged DTO fields are rejected before the use case", async () => {
    for (const body of [{}, { fallbackPhone: undefined }, { fallbackPhone: 123 }, { fallbackPhone: "x".repeat(41) },
      { fallbackPhone: "+12125550183", merchantId: "merchant-b" }]) {
      const dto = plainToInstance(UpdateSupportNotificationSettingsDto, body);
      const errors = await validate(dto, { whitelist: true, forbidNonWhitelisted: true });
      assert.ok(errors.length > 0, JSON.stringify(body));
      const expectedProperty = "merchantId" in body ? "merchantId" : "fallbackPhone";
      assert.ok(errors.some(error => error.property === expectedProperty && Object.keys(error.constraints ?? {}).length > 0));
    }
  });
  await t.test("GET derives the tenant from the principal and returns only its actual private record", async () => {
    const f = readFixture(), before = structuredClone([...f.rows]);
    const request = { tenantPrincipal: human("owner"), merchantId: "merchant-b", query: { merchantId: "merchant-b" } };
    assert.deepEqual(await f.within(() => f.controller.get(request)), {
      channel: "whatsapp", fallbackPhone: "+12125550183", version: 3, updatedAt: "2030-01-01T00:00:00.000Z",
    });
    assert.deepEqual([...f.rows], before);
  });
  await t.test("a principal inconsistent with tenant context cannot read or mutate any recipient", async () => {
    const f = readFixture(), before = structuredClone([...f.rows]);
    const request = { tenantPrincipal: human("owner", "merchant-b") };
    await f.within(async () => {
      await assert.rejects(f.controller.get(request), denial(403, "support_notification_scope_mismatch"));
      await assert.rejects(f.controller.save(request, { fallbackPhone: null }), denial(403, "support_notification_scope_mismatch"));
    });
    assert.equal(f.calls(), 0);
    assert.deepEqual([...f.rows], before);
  });
});
