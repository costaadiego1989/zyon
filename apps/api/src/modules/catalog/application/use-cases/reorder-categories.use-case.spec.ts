import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ReorderCategoriesUseCase } from "./reorder-categories.use-case.js";

function makePrisma() {
  const updates: Array<{ id: string; sortOrder: number }> = [];
  return {
    productCategory: {
      findMany: async ({ where }: { where: { id: { in: string[] }; merchantId: string } }) => where.id.in.map((id) => ({ id })),
      update: ({ where, data }: { where: { id: string }; data: { sortOrder: number } }) => {
        updates.push({ id: where.id, sortOrder: data.sortOrder });
        return Promise.resolve({});
      },
    },
    $transaction: async (operations: Promise<unknown>[]) => Promise.all(operations),
    updates,
  };
}

describe("ReorderCategoriesUseCase", () => {
  it("accepts the dashboard payload with items", async () => {
    const prisma = makePrisma();
    const useCase = new ReorderCategoriesUseCase(prisma as any);

    await useCase.execute("mrc_1", { items: [{ id: "cat_2", sort_order: 0 }, { id: "cat_1", sort_order: 1 }] });

    assert.deepEqual(prisma.updates, [{ id: "cat_2", sortOrder: 0 }, { id: "cat_1", sortOrder: 1 }]);
  });

  it("keeps accepting the legacy array payload", async () => {
    const prisma = makePrisma();
    const useCase = new ReorderCategoriesUseCase(prisma as any);

    await useCase.execute("mrc_1", [{ id: "cat_1", sort_order: 3 }]);

    assert.deepEqual(prisma.updates, [{ id: "cat_1", sortOrder: 3 }]);
  });
});
