import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ForbiddenException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { StaffReadable } from "./staff-readable.decorator.js";
import { StaffReadableGuard } from "./staff-readable.guard.js";

describe("StaffReadableGuard", () => {
  it("allows staff on a @StaffReadable() handler", () => {
    class C {}
    StaffReadable()(C as never, "handler" as never, undefined as never);
    // note: apply to method via Reflector metadata

    const guard = new StaffReadableGuard(new Reflector());
    assert.equal(
      guard.canActivate(ctxFor("staff")),
      true,
    );
  });

  it("rejects service principals", () => {
    const guard = new StaffReadableGuard(new Reflector());
    assert.throws(() => guard.canActivate(serviceCtx()), ForbiddenException);
  });
});

function ctxFor(role: "owner" | "admin" | "staff") {
  return {
    getHandler: () => function handler() {},
    getClass: () => class C {},
    switchToHttp: () => ({
      getRequest: () => ({
        tenantPrincipal: { kind: "human", tenantId: "mrc_1", userId: "usr_1", email: "u@x.com", role },
      }),
    }),
  } as never;
}

function serviceCtx() {
  return {
    getHandler: () => function handler() {},
    getClass: () => class C {},
    switchToHttp: () => ({
      getRequest: () => ({
        tenantPrincipal: { kind: "service", tenantId: "mrc_1", credentialId: "mak_1", environment: "test", scopes: [] },
      }),
    }),
  } as never;
}
