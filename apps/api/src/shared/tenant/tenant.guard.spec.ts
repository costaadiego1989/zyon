import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Reflector } from "@nestjs/core";
import { IS_PUBLIC_KEY, TenantGuard } from "./tenant.guard.js";

function makeContext(overrides: {
  user?: { merchantId: string; userId: string; role: string } | null;
  handler?: object;
  controllerClass?: object;
}) {
  const user = overrides.user !== undefined ? overrides.user : { merchantId: "mrc_1", userId: "usr_1", role: "owner" };
  return {
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
    getHandler: () => overrides.handler ?? function namedHandler() {},
    getClass: () => overrides.controllerClass ?? class SomeController {},
  } as any;
}

describe("TenantGuard", () => {
  it("allows authenticated request", () => {
    const reflector = new Reflector();
    const guard = new TenantGuard(reflector);
    assert.equal(guard.canActivate(makeContext({})), true);
  });

  it("allows public routes (IS_PUBLIC_KEY metadata)", () => {
    const reflector = new Reflector();
    const guard = new TenantGuard(reflector);

    const handler = function publicHandler() {};
    Reflect.defineMetadata(IS_PUBLIC_KEY, true, handler);

    assert.equal(guard.canActivate(makeContext({ user: null, handler })), true);
  });

  it("allows request without user (unauthenticated routes pass to AuthGuard)", () => {
    const reflector = new Reflector();
    const guard = new TenantGuard(reflector);
    assert.equal(guard.canActivate(makeContext({ user: null })), true);
  });
});
