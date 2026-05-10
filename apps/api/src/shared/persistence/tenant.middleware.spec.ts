import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { TenantContextService } from "../tenant/tenant-context.service.js";
import { registerTenantMiddleware } from "./tenant.middleware.js";

type Params = Record<string, unknown>;

function makeStubPrisma() {
  const captured: Params[] = [];
  const prisma = {
    $use(fn: (p: Params, next: (p: Params) => Promise<unknown>) => Promise<unknown>) {
      (prisma as any)._middleware = fn;
    },
    async _invoke(params: Params) {
      const next = async (p: Params) => { captured.push(p); return null; };
      return (prisma as any)._middleware(params, next);
    },
    _captured: captured,
  };
  return prisma;
}

describe("registerTenantMiddleware", () => {
  it("injects merchantId filter when ALS context is active", async () => {
    const svc = new TenantContextService();
    const prisma = makeStubPrisma() as any;
    registerTenantMiddleware(prisma, svc);

    await svc.run({ merchantId: "mrc_abc", userId: "u1", role: "owner" }, async () => {
      await prisma._invoke({ action: "findMany", model: "CheckoutSession", args: { where: { status: "open" } } });
    });

    assert.equal(prisma._captured.length, 1);
    assert.deepEqual((prisma._captured[0].args as any).where, { status: "open", merchantId: "mrc_abc" });
  });

  it("passes through without context (unauthenticated / no ALS)", async () => {
    const svc = new TenantContextService();
    const prisma = makeStubPrisma() as any;
    registerTenantMiddleware(prisma, svc);

    await prisma._invoke({ action: "findMany", model: "CheckoutSession", args: { where: {} } });

    assert.deepEqual((prisma._captured[0].args as any).where, {});
  });

  it("passes through for non-scoped models", async () => {
    const svc = new TenantContextService();
    const prisma = makeStubPrisma() as any;
    registerTenantMiddleware(prisma, svc);

    await svc.run({ merchantId: "mrc_abc", userId: "u1", role: "owner" }, async () => {
      await prisma._invoke({ action: "findMany", model: "Merchant", args: { where: {} } });
    });

    assert.deepEqual((prisma._captured[0].args as any).where, {});
  });
});
