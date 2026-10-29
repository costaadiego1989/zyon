import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ForbiddenException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { STAFF_READABLE_METADATA } from "./staff-readable.decorator.js";
import { StaffReadableGuard } from "./staff-readable.guard.js";

/**
 * Build a context whose handler is decorated with @StaffReadable()
 * via Reflector metadata. This mirrors what NestJS does at boot time
 * without relying on the TypeScript decorator runtime.
 */
function ctxWithStaffReadable(roleOrKind: "owner" | "admin" | "staff" | "service"): Parameters<StaffReadableGuard["canActivate"]>[0] {
  const handler = function handler() {};
  const cls = class C {};
  // Pre-seed the metadata that the decorator would set
  Reflect.defineMetadata(STAFF_READABLE_METADATA, true, handler);
  return {
    getHandler: () => handler,
    getClass: () => cls,
    switchToHttp: () => ({
      getRequest: () => ({
        tenantPrincipal: roleOrKind === "service"
          ? { kind: "service", tenantId: "mrc_1", credentialId: "mak_1", environment: "test", scopes: [] }
          : { kind: "human", tenantId: "mrc_1", userId: "usr_1", email: "u@x.com", role: roleOrKind },
      }),
    }),
  } as never;
}

function ctxUndecorated(role: "owner" | "admin" | "staff"): Parameters<StaffReadableGuard["canActivate"]>[0] {
  const handler = function handler() {};
  const cls = class C {};
  // no metadata → guard passes through
  return {
    getHandler: () => handler,
    getClass: () => cls,
    switchToHttp: () => ({
      getRequest: () => ({
        tenantPrincipal: { kind: "human", tenantId: "mrc_1", userId: "usr_1", email: "u@x.com", role },
      }),
    }),
  } as never;
}

describe("StaffReadableGuard", () => {
  const guard = new StaffReadableGuard(new Reflector());

  it("allows owner on a @StaffReadable() handler", () => {
    assert.equal(guard.canActivate(ctxWithStaffReadable("owner")), true);
  });

  it("allows admin on a @StaffReadable() handler", () => {
    assert.equal(guard.canActivate(ctxWithStaffReadable("admin")), true);
  });

  it("allows staff on a @StaffReadable() handler", () => {
    assert.equal(guard.canActivate(ctxWithStaffReadable("staff")), true);
  });

  it("bypasses service principals (governed by their API key scopes)", () => {
    assert.equal(guard.canActivate(ctxWithStaffReadable("service")), true);
  });

  it("passes through when handler is not decorated (no @StaffReadable)", () => {
    assert.equal(guard.canActivate(ctxUndecorated("staff")), true);
  });

  it("rejects unknown human roles (e.g. buyer)", () => {
    // Use a brand-new context so no stale state from prior tests interferes
    const handler = function handler() {};
    const cls = class C {};
    Reflect.defineMetadata(STAFF_READABLE_METADATA, true, handler);
    const ctx = {
      getHandler: () => handler,
      getClass: () => cls,
      switchToHttp: () => ({
        getRequest: () => ({
          tenantPrincipal: { kind: "human", tenantId: "mrc_1", userId: "u", email: "e", role: "buyer" },
        }),
      }),
    } as never;
    let threw = false;
    let caughtName = "";
    try {
      guard.canActivate(ctx);
    } catch (err) {
      threw = true;
      caughtName = err instanceof Error ? err.constructor.name : String(err);
    }
    assert.equal(threw, true, `expected throw but got none (caughtName=${caughtName})`);
    assert.equal(caughtName, "ForbiddenException");
  });
});
