import assert from "node:assert/strict";
import { ForbiddenException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { describe, it } from "node:test";
import {
  IS_PUBLIC_KEY,
  PublicRoute,
  TenantGuard,
  tenantContextFromPrincipal,
  type TenantRequest,
  validateTenantRequest,
} from "./tenant.guard.js";

const merchantPrincipal = {
  merchantId: "mrc_1",
  userId: "usr_1",
  role: "owner",
};

function makeContext(
  request: TenantRequest,
  overrides: {
    handler?: object;
    controllerClass?: object;
  } = {},
) {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => overrides.handler ?? function namedHandler() {},
    getClass: () => overrides.controllerClass ?? class SomeController {},
  } as never;
}

describe("TenantGuard", () => {
  it("accepts a valid merchant principal with matching tenant inputs", () => {
    const guard = new TenantGuard(new Reflector());
    assert.equal(
      guard.canActivate(
        makeContext({
          user: merchantPrincipal,
          params: { merchantId: "mrc_1" },
          query: { merchant_id: ["mrc_1"] },
          body: [{ merchantId: "mrc_1" }, { merchant_id: "mrc_1" }],
        }),
      ),
      true,
    );
  });

  it("rejects conflicting tenant values from params, query, or body", () => {
    for (const request of [
      { user: merchantPrincipal, params: { merchantId: "mrc_other" } },
      { user: merchantPrincipal, query: { merchant_id: "mrc_other" } },
      { user: merchantPrincipal, body: { merchantId: "mrc_other" } },
      {
        user: merchantPrincipal,
        body: { merchantId: "mrc_1", merchant_id: "mrc_other" },
      },
    ]) {
      assert.throws(
        () => validateTenantRequest(request),
        ForbiddenException,
      );
    }
  });

  it("rejects malformed merchant principals", () => {
    for (const principal of [
      { merchantId: "", userId: "usr_1", role: "owner" },
      { merchantId: "mrc_1", role: "owner" },
      { merchantId: "mrc_1", userId: "usr_1", role: "buyer" },
      { userId: "usr_1", role: "admin" },
      "merchant-principal",
    ]) {
      assert.throws(
        () => tenantContextFromPrincipal(principal),
        ForbiddenException,
      );
    }
  });

  it("allows requests without a principal for downstream route guards", () => {
    const guard = new TenantGuard(new Reflector());
    assert.equal(guard.canActivate(makeContext({})), true);
    assert.equal(validateTenantRequest({}), null);
  });

  it("allows buyer principals without merchantId", () => {
    const buyer = {
      globalUserId: "buyer_1",
      email: "buyer@example.com",
    };
    assert.equal(
      validateTenantRequest({
        user: buyer,
        body: { merchant_id: "merchant_selected_by_buyer" },
      }),
      null,
    );
  });

  it("allows public routes before authentication runs", () => {
    const reflector = new Reflector();
    const guard = new TenantGuard(reflector);
    const handler = function publicHandler() {};
    Reflect.defineMetadata(IS_PUBLIC_KEY, true, handler);

    assert.equal(
      guard.canActivate(
        makeContext(
          {
            user: { merchantId: "", userId: "", role: "owner" },
            body: { merchant_id: "mrc_other" },
          },
          { handler },
        ),
      ),
      true,
    );
  });

  it("PublicRoute decorator sets the public metadata flag", () => {
    const handler = function decoratedHandler() {};
    PublicRoute()(handler, "decoratedHandler", {
      value: handler,
    } as PropertyDescriptor);

    assert.equal(Reflect.getMetadata(IS_PUBLIC_KEY, handler), true);
  });
});
