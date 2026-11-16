import assert from "node:assert/strict";
import test from "node:test";
import { StoreBuilderCatalogController as CatalogController } from "./catalog.controller.js";
import { CreateCategoryUseCase } from "../../application/use-cases/create-category.use-case.js";

function fixture(parentMerchant = "athom") {
  const records: any[] = [];
  const prisma = { productCategory: { findUnique: async ({ where }: any) => where.id === "parent"
    ? { id: "parent", merchantId: parentMerchant } : null,
    create: async ({ data }: any) => { const row = { id: "child", ...data, isActive: true, sortOrder: 0,
      createdAt: new Date(), updatedAt: new Date() }; records.push(row); return row; } } };
  const controller = Object.assign(Object.create(CatalogController.prototype), {
    createCategory: new CreateCategoryUseCase(prisma as never),
  }) as CatalogController;
  return { controller, records };
}

for (const spelling of ["snake", "camel"] as const) {
  const fields = spelling === "snake" ? { parent_id: "parent", image_url: "https://example.test/category.png" }
    : { parentId: "parent", imageUrl: "https://example.test/category.png" };
  test("category create preserves parent and image using " + spelling + " case", async () => {
    const f = fixture();
    const result = await f.controller.createCat("athom", { name: "Acessórios", ...fields });
    assert.equal(f.records.length, 1);
    assert.equal(f.records[0].merchantId, "athom");
    assert.equal(f.records[0].parentId, "parent");
    assert.equal(f.records[0].imageUrl, "https://example.test/category.png");
    assert.equal(result.parent_id, "parent");
    assert.equal(result.image_url, "https://example.test/category.png");
  });
  test("category create rejects a foreign parent using " + spelling + " case", async () => {
    const f = fixture("other");
    await assert.rejects(f.controller.createCat("athom", { name: "Acessórios", ...fields }), /parent_category_not_found/);
    assert.deepEqual(f.records, []);
  });
}
