import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { TenantContextService } from "./tenant-context.service.js";

describe("TenantContextService", () => {
  it("run propagates context inside async fn", async () => {
    const svc = new TenantContextService();
    const ctx = { merchantId: "mrc_x", userId: "usr_1", role: "owner" };
    const result = await svc.run(ctx, async () => {
      await Promise.resolve();
      return svc.get();
    });
    assert.deepEqual(result, ctx);
  });

  it("get returns null outside run", () => {
    const svc = new TenantContextService();
    assert.equal(svc.get(), null);
  });

  it("nested run shadows outer context", async () => {
    const svc = new TenantContextService();
    const outer = { merchantId: "mrc_outer", userId: "u1", role: "owner" };
    const inner = { merchantId: "mrc_inner", userId: "u2", role: "admin" };
    let innerSeen: unknown;
    await svc.run(outer, async () => {
      await svc.run(inner, async () => {
        innerSeen = svc.get();
      });
      assert.deepEqual(svc.get(), outer);
    });
    assert.deepEqual(innerSeen, inner);
  });
});
