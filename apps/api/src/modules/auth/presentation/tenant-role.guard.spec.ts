import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ForbiddenException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { RequireTenantRoles } from "./tenant-role.decorator.js";
import { TenantRoleGuard } from "./tenant-role.guard.js";

describe("TenantRoleGuard", () => {
  it("allows a human principal with the declared role", () => {
    class DeveloperController {}
    RequireTenantRoles("owner", "admin")(DeveloperController);

    const guard = new TenantRoleGuard(new Reflector());
    assert.equal(
      guard.canActivate(contextFor(DeveloperController, "admin")),
      true,
    );
  });

  it("rejects service principals from human-only operations", () => {
    class DeveloperController {}
    RequireTenantRoles("owner")(DeveloperController);

    const guard = new TenantRoleGuard(new Reflector());
    assert.throws(
      () => guard.canActivate(serviceContextFor(DeveloperController)),
      ForbiddenException,
    );
  });
});

function contextFor(controller: Function, role: "owner" | "admin" | "staff") {
  return {
    getClass: () => controller,
    getHandler: () => function handler() {},
    switchToHttp: () => ({
      getRequest: () => ({
        tenantPrincipal: {
          kind: "human",
          tenantId: "mrc_1",
          userId: "usr_1",
          email: "owner@example.com",
          role,
        },
      }),
    }),
  } as never;
}

function serviceContextFor(controller: Function) {
  return {
    getClass: () => controller,
    getHandler: () => function handler() {},
    switchToHttp: () => ({
      getRequest: () => ({
        tenantPrincipal: {
          kind: "service",
          tenantId: "mrc_1",
          credentialId: "mak_1",
          environment: "test",
          scopes: ["audit:read"],
        },
      }),
    }),
  } as never;
}
