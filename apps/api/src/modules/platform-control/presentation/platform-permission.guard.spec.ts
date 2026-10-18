import assert from "node:assert/strict";
import test from "node:test";
import { ForbiddenException } from "@nestjs/common";
import { setPlatformPrincipal, type PlatformPrincipalRequest } from "./platform-principal.js";
import { PlatformPermissionGuard } from "./platform-permission.guard.js";

test("platform permission guard fails closed for an operator without the required permission", () => {
  const request: PlatformPrincipalRequest = {};
  setPlatformPrincipal(request, {
    operatorId: "support_1",
    email: "support@zyon.test",
    role: "support_ops",
  });
  const reflector = {
    getAllAndOverride: () => ["platform:billing:read"],
  };
  const guard = new PlatformPermissionGuard(reflector as any);
  const context = {
    getHandler: () => class Handler {},
    getClass: () => class Controller {},
    switchToHttp: () => ({ getRequest: () => request }),
  };

  assert.throws(() => guard.canActivate(context as any), ForbiddenException);
});
