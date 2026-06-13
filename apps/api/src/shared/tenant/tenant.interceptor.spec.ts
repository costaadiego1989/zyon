import assert from "node:assert/strict";
import {
  type CallHandler,
  type ExecutionContext,
  ForbiddenException,
} from "@nestjs/common";
import { defer, firstValueFrom, of } from "rxjs";
import { describe, it } from "node:test";
import { TenantContextService } from "./tenant-context.service.js";
import { TenantInterceptor } from "./tenant.interceptor.js";
import type { TenantRequest } from "./tenant.guard.js";

const merchantPrincipal = {
  merchantId: "mrc_1",
  userId: "usr_1",
  role: "admin",
};

function makeContext(request: TenantRequest): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as ExecutionContext;
}

describe("TenantInterceptor", () => {
  it("runs downstream handling inside merchant ALS context", async () => {
    const tenantCtx = new TenantContextService();
    const interceptor = new TenantInterceptor(tenantCtx);
    let observed = tenantCtx.get();
    const next: CallHandler = {
      handle: () =>
        defer(() => {
          observed = tenantCtx.get();
          return of("ok");
        }),
    };

    const result = await firstValueFrom(
      interceptor.intercept(
        makeContext({
          user: merchantPrincipal,
          params: { merchantId: "mrc_1" },
        }),
        next,
      ),
    );

    assert.equal(result, "ok");
    assert.deepEqual(observed, merchantPrincipal);
    assert.equal(tenantCtx.get(), null);
  });

  it("rejects a tenant mismatch after controller guards populate user", () => {
    const interceptor = new TenantInterceptor(new TenantContextService());
    const next: CallHandler = { handle: () => of("should_not_run") };

    assert.throws(
      () =>
        interceptor.intercept(
          makeContext({
            user: merchantPrincipal,
            query: { merchant_id: "mrc_other" },
          }),
          next,
        ),
      ForbiddenException,
    );
  });

  it("rejects an invalid merchant principal", () => {
    const interceptor = new TenantInterceptor(new TenantContextService());
    const next: CallHandler = { handle: () => of("should_not_run") };

    assert.throws(
      () =>
        interceptor.intercept(
          makeContext({
            user: { merchantId: "mrc_1", userId: "", role: "owner" },
          }),
          next,
        ),
      ForbiddenException,
    );
  });

  it("keeps buyer and principal-free requests outside merchant ALS", async () => {
    for (const request of [
      {
        user: {
          globalUserId: "buyer_1",
          email: "buyer@example.com",
        },
        body: { merchant_id: "buyer_selected_merchant" },
      },
      {},
    ]) {
      const tenantCtx = new TenantContextService();
      const interceptor = new TenantInterceptor(tenantCtx);
      let observed: ReturnType<TenantContextService["get"]> | undefined;
      const next: CallHandler = {
        handle: () =>
          defer(() => {
            observed = tenantCtx.get();
            return of("ok");
          }),
      };

      assert.equal(
        await firstValueFrom(
          interceptor.intercept(makeContext(request), next),
        ),
        "ok",
      );
      assert.equal(observed, null);
    }
  });
});
