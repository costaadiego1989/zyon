import test from "node:test";
import assert from "node:assert/strict";
import { PrismaProductRepository } from "./prisma-product.repository.js";

test("name page queries only the tenant's public active non-deleted names with stable cursor and sentinel", async () => {
  const calls: any[] = [];
  const repo = new PrismaProductRepository({ product: { findMany: async (query: unknown) => {
    calls.push(query); return [{ id: "p1", name: "Primeiro" }, { id: "p2", name: "Segundo" }, { id: "p3", name: "Próximo" }];
  } } } as never);
  const result = await repo.listPublicNames({ merchantId: "merchant", limit: 2, cursor: "p0" });
  assert.deepEqual(calls, [{ where: { merchantId: "merchant", isActive: true, deletedAt: null },
    select: { id: true, name: true }, orderBy: { id: "asc" }, take: 3, cursor: { id: "p0" }, skip: 1 }]);
  assert.deepEqual(result, { items: [{ id: "p1", name: "Primeiro" }, { id: "p2", name: "Segundo" }], nextCursor: "p2" });
});

test("a final name page has no continuation and excessive limits remain bounded", async () => {
  const calls: any[] = [];
  const repo = new PrismaProductRepository({ product: { findMany: async (query: unknown) => { calls.push(query); return [{ id: "p1", name: "Único" }]; } } } as never);
  const result = await repo.listPublicNames({ merchantId: "merchant", limit: 9999 });
  assert.deepEqual(result, { items: [{ id: "p1", name: "Único" }] });
  assert.equal(calls[0].take, 101); assert.equal("cursor" in calls[0], false); assert.equal("include" in calls[0], false);
});
