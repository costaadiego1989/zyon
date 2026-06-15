import "reflect-metadata";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { TenantAccessGuard } from "./tenant-access.guard.js";
import { TENANT_ACCESS_METADATA } from "./tenant-access.decorator.js";

describe("TenantAccessGuard", () => {
  it("allows a console admin and a service key with the required scope", () => {
    const guard = new TenantAccessGuard(new Reflector());

    assert.equal(
      guard.canActivate(
        context({
          kind: "human",
          tenantId: "mrc_1",
          userId: "usr_1",
          email: "admin@example.com",
          role: "admin",
        }),
      ),
      true,
    );
    assert.equal(
      guard.canActivate(
        context({
          kind: "service",
          tenantId: "mrc_1",
          credentialId: "key_1",
          environment: "test",
          scopes: ["commerce:read"],
        }),
      ),
      true,
    );
  });

  it("rejects a service key without the required scope", () => {
    const guard = new TenantAccessGuard(new Reflector());

    assert.throws(
      () =>
        guard.canActivate(
          context({
            kind: "service",
            tenantId: "mrc_1",
            credentialId: "key_1",
            environment: "test",
            scopes: ["catalog:read"],
          }),
        ),
      /missing_api_key_scope/,
    );
  });
});

function context(tenantPrincipal: Record<string, unknown>): ExecutionContext {
  const handler = () => undefined;
  Reflect.defineMetadata(
    TENANT_ACCESS_METADATA,
    { serviceScopes: ["commerce:read"] },
    handler,
  );
  return {
    getHandler: () => handler,
    getClass: () => class CommerceController {},
    switchToHttp: () => ({
      getRequest: () => ({ tenantPrincipal }),
    }),
  } as unknown as ExecutionContext;
}
