import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { CatalogVariantService } from "./catalog-variant.service.js";
import { PrismaProductRepository } from "../../infrastructure/repositories/prisma-product.repository.js";
import { PrismaInventoryRepository } from "../../../inventory/infrastructure/repositories/prisma-inventory.repository.js";
import { RecordMovementUseCase } from "../../../inventory/application/use-cases/record-movement.use-case.js";
import { PrismaStockRepository } from "../../infrastructure/repositories/prisma-stock.repository.js";
import { PrismaStorefrontCartRepository } from "../../../storefront/infrastructure/repositories/prisma-storefront-cart.repository.js";
import { assertCartStock } from "./cart-stock-authority.js";

const databaseUrl = process.env.READY_PROD_TEST_DATABASE_URL;
describe("final catalog/inventory regressions (disposable PostgreSQL)", { skip: !databaseUrl }, () => {
  let prisma: PrismaClient;
  let products: PrismaProductRepository;
  let variants: CatalogVariantService;
  let inventory: PrismaInventoryRepository;
  before(async () => {
    const url = new URL(databaseUrl!);
    assert.equal(url.hostname, "127.0.0.1"); assert.equal(url.port, "5433");
    assert.match(url.pathname, /^\/zyon_catalog_qa_20261006_[a-f0-9]{10}$/);
    prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } }, transactionOptions: { maxWait: 30000, timeout: 15000 } });
    await prisma.$connect(); products = new PrismaProductRepository(prisma); inventory = new PrismaInventoryRepository(prisma);
    variants = new CatalogVariantService(prisma, { isConfigured: () => true, uploadBase64: async () => ({ url: "https://example.invalid/fixture.png" }) } as never);
  });
  after(async () => { await prisma?.$disconnect(); });
  async function fixture(type = "physical", quantity = 3) {
    const merchantId = `qa_final_${randomUUID()}`;
    await prisma.merchant.create({ data: { id: merchantId, name: "Isolated catalog QA" } });
    const product = await products.create({ merchantId, name: "QA", type, metadata: type === "digital" ? { downloadUrl: "https://example.invalid/file" } : undefined,
      variants: [{ sku: "red", attributes: { Cor: "Red" }, basePriceInCents: 1700, costInCents: 500, weightGrams: 100, stockQuantity: quantity }] });
    return { merchantId, productId: product.id, variantId: product.variants[0].id, product };
  }
  const replacement = (f: Awaited<ReturnType<typeof fixture>>) => ({ id: f.variantId, sku: "red", attributes: { Cor: "Red" }, basePriceInCents: 1700, costInCents: 500, weightGrams: 100 });
  async function balance(f: Awaited<ReturnType<typeof fixture>>) {
    return { item: await prisma.inventoryItem.findFirstOrThrow({ where: { merchantId: f.merchantId, sku: "red" } }), stock: await prisma.productStock.findFirstOrThrow({ where: { variantId: f.variantId } }) };
  }
  async function movement(f: Awaited<ReturnType<typeof fixture>>, quantity: number, kind = "ENTRY") {
    const b = await balance(f);
    return new RecordMovementUseCase(inventory, {} as never, {} as never).execute({ merchantId: f.merchantId, itemId: b.item.id, kind, quantity, source: "manual" });
  }

  it("persists renamed SKU, attributes, addition and retirement with stable IDs and ledger", async () => {
    const f = await fixture();
    const added = await variants.replace(f.merchantId, f.productId, [replacement(f), { sku: "blue", attributes: { Cor: "Blue" }, basePriceInCents: 2500, weightGrams: 100, stockQuantity: 1 }]);
    const blueId = added.variants[1].id;
    const saved = await variants.replace(f.merchantId, f.productId, [{ ...replacement(f), sku: "red-edited", attributes: { Cor: "Edited" }, basePriceInCents: 1947, stockQuantity: 2 }, { sku: "green", attributes: { Cor: "Green" }, basePriceInCents: 2100, weightGrams: 100, stockQuantity: 4 }]);
    const loaded = await products.findById(f.merchantId, f.productId);
    assert.deepEqual(loaded!.variants.map(v => v.sku).sort(), ["green", "red-edited"]);
    assert.equal(loaded!.variants.find(v => v.sku === "red-edited")!.id, f.variantId);
    assert.deepEqual(loaded!.variants.find(v => v.id === f.variantId)!.attributes, { Cor: "Edited" });
    assert.equal((await prisma.productVariant.findUniqueOrThrow({ where: { id: blueId } })).isActive, false);
    assert.equal(await prisma.inventoryItem.count({ where: { merchantId: f.merchantId, sku: "red" } }), 0);
    assert.equal((await prisma.inventoryItem.findFirstOrThrow({ where: { merchantId: f.merchantId, sku: "red-edited" } })).quantity, 2);
    assert.equal((await prisma.inventoryItem.findFirstOrThrow({ where: { merchantId: f.merchantId, sku: "green" } })).quantity, 4);
    await variants.uploadMedia(f.merchantId, { variantId: saved.variants[1].id, image: "fixture-base64" });
    assert.equal((await prisma.productMedia.findFirstOrThrow({ where: { variantId: saved.variants[1].id } })).url, "https://example.invalid/fixture.png");
    await assert.rejects(variants.uploadMedia(f.merchantId, { variantId: f.productId, image: "fixture-base64" }), /variant_not_found/);
  });

  it("rejects foreign IDs, duplicate SKUs and empty active sets without altering offers", async () => {
    const f = await fixture(), other = await fixture();
    await assert.rejects(variants.replace(f.merchantId, f.productId, [{ ...replacement(f), id: other.variantId }]), /invalid_variant_id/);
    await assert.rejects(variants.replace(f.merchantId, f.productId, []), /at_least_one_variant_required/);
    await assert.rejects(variants.replace(f.merchantId, f.productId, [replacement(f), { ...replacement(f), id: undefined }]), /duplicate_sku_in_product/);
    assert.equal((await products.findById(f.merchantId, f.productId))!.variants.length, 1);
  });

  it("rolls back the entire variant set when a later stock change violates a reserve", async () => {
    const f = await fixture();
    const first = await variants.replace(f.merchantId, f.productId, [replacement(f), { sku: "blue", attributes: {}, basePriceInCents: 2500, weightGrams: 100, stockQuantity: 2 }]);
    const blue = first.variants[1]; await prisma.productStock.updateMany({ where: { variantId: blue.id }, data: { reserved: 2 } });
    await assert.rejects(variants.replace(f.merchantId, f.productId, [{ ...replacement(f), basePriceInCents: 9999 }, { id: blue.id, sku: "blue", attributes: {}, basePriceInCents: 2500, weightGrams: 100, stockQuantity: 1 }], { name: "Must rollback", description: "Must rollback" }), /stock_quantity_below_reserved/);
    assert.equal((await products.findById(f.merchantId, f.productId))!.variants.find(v => v.id === f.variantId)!.basePriceInCents, 1700);
    assert.equal((await products.findById(f.merchantId, f.productId))!.name, "QA");
    await assert.rejects(variants.replace(f.merchantId, f.productId, [replacement(f)]), /stock_reserved_variant_cannot_be_removed/);
    await assert.rejects(variants.replace(f.merchantId, f.productId, [replacement(f), { id: blue.id, sku: "blue-renamed", attributes: {}, basePriceInCents: 2500, weightGrams: 100 }]), /stock_reserved_sku_cannot_be_changed/);
  });

  it("projects a manual movement synchronously and retains its signed delta", async () => {
    const f = await fixture(); await movement(f, 2); let b = await balance(f);
    assert.equal(b.item.quantity, 5); assert.equal(b.stock.quantity, 5);
    await movement(f, 2, "ADJUSTMENT"); b = await balance(f);
    assert.equal(b.item.quantity, 3); assert.equal(b.stock.quantity, 3);
    assert.deepEqual((await prisma.inventoryMovement.findMany({ where: { merchantId: f.merchantId }, orderBy: { createdAt: "asc" } })).map(m => m.quantity), [3, 2, -2]);
  });

  it("serializes concurrent movements and catalog adjustment without ledger divergence", async () => {
    const f = await fixture(); await Promise.all(Array.from({ length: 10 }, () => movement(f, 1)));
    let b = await balance(f); assert.equal(b.item.quantity, 13); assert.equal(b.stock.quantity, 13);
    await Promise.all([movement(f, 2), variants.replace(f.merchantId, f.productId, [{ ...replacement(f), stockQuantity: 7 }])]);
    b = await balance(f); assert.equal(b.item.quantity, b.stock.quantity); assert.ok([7, 9].includes(b.item.quantity));
  });

  it("rolls back movement, ledger and projection below a reserve or ambiguous warehouse", async () => {
    const f = await fixture(); let b = await balance(f);
    await prisma.productStock.update({ where: { id: b.stock.id }, data: { reserved: 2 } });
    await assert.rejects(movement(f, 2, "ADJUSTMENT"), /stock_quantity_below_reserved/);
    assert.equal((await balance(f)).item.quantity, 3); assert.equal(await prisma.inventoryMovement.count({ where: { merchantId: f.merchantId } }), 1);
    await prisma.productStock.create({ data: { variantId: f.variantId, warehouseId: "second", quantity: 4 } });
    await assert.rejects(movement(f, 1), /stock_warehouse_required/);
    b = await balance(f); assert.equal(b.item.quantity, 3);
  });

  it("edits commercial cost separately from inventory average and clears description", async () => {
    const f = await fixture(); const before = await balance(f);
    await variants.update(f.merchantId, f.productId, f.variantId, { costInCents: 700 });
    assert.equal((await products.findById(f.merchantId, f.productId))!.variants[0].costInCents, 700);
    assert.equal((await balance(f)).item.avgCostCents, before.item.avgCostCents);
    await variants.update(f.merchantId, f.productId, f.variantId, { costInCents: null });
    assert.equal((await products.findById(f.merchantId, f.productId))!.variants[0].costInCents, null);
    await products.update(f.merchantId, f.productId, { description: "Before" }); await products.update(f.merchantId, f.productId, { description: "" });
    assert.equal((await products.findById(f.merchantId, f.productId))!.description, "");
  });

  it("filters status before pagination and totals the complete filtered set", async () => {
    const f = await fixture(); await products.softDelete(f.merchantId, f.productId);
    await prisma.product.createMany({ data: Array.from({ length: 28 }, (_, i) => ({ id: `pagination_${randomUUID()}`, merchantId: f.merchantId, name: `QA ${i}`, isActive: i % 2 === 0 })) });
    const active = await products.search({ merchantId: f.merchantId, status: "active", limit: 5, offset: 5 });
    assert.equal(active.products.length, 5); assert.ok(active.products.every(p => p.isActive)); assert.equal(active.total, 14);
    assert.deepEqual(active.totals, { total: 14, inactive: 0, inStock: 0 });
    const inactive = await products.search({ merchantId: f.merchantId, status: "inactive", limit: 5, offset: 10 });
    assert.equal(inactive.products.length, 4); assert.equal(inactive.total, 14); assert.equal(inactive.totals!.inactive, 14); assert.equal(inactive.nextCursor, undefined);
    const stocked = await fixture();
    const summary = await products.search({ merchantId: stocked.merchantId, status: "all", limit: 1 }); assert.equal(summary.totals!.inStock, 1);
    await prisma.productStock.updateMany({ where: { variantId: stocked.variantId }, data: { reserved: 3 } });
    assert.equal((await products.search({ merchantId: stocked.merchantId, status: "all" })).totals!.inStock, 0);
  });

  it("public categories exclude inactive categories and deleted/inactive products", async () => {
    const f = await fixture();
    const active = await prisma.productCategory.create({ data: { merchantId: f.merchantId, name: "Active", slug: "active" } });
    await prisma.productCategory.create({ data: { merchantId: f.merchantId, name: "Paused", slug: "paused", isActive: false } });
    await products.update(f.merchantId, f.productId, { categoryId: active.id });
    await prisma.product.create({ data: { merchantId: f.merchantId, categoryId: active.id, name: "Paused product", isActive: false } });
    await prisma.product.create({ data: { merchantId: f.merchantId, categoryId: active.id, name: "Deleted product", deletedAt: new Date() } });
    assert.equal((await products.listCategories(f.merchantId)).length, 2);
    assert.deepEqual((await products.listCategories(f.merchantId, { publicOnly: true })).map(c => [c.name, c.productCount]), [["Active", 1]]);
  });

  it("native cart guard aggregates by variant, subtracts reserves and exempts intangible stock", async () => {
    const f = await fixture("food", 2);
    await assert.rejects(assertCartStock(prisma, f.merchantId, [{ sku: "red", variantId: f.variantId, quantity: 1 }, { sku: "red", variantId: f.variantId, quantity: 2 }]), /cart_insufficient_stock/);
    await assertCartStock(prisma, f.merchantId, [{ sku: "red", variantId: f.variantId, quantity: 2 }]);
    const other = await fixture(); await assert.rejects(assertCartStock(prisma, other.merchantId, [{ sku: "red", variantId: f.variantId, quantity: 1 }]), /cart_product_unavailable/);
    for (const type of ["digital", "service"]) { const intangible = await fixture(type, 0); await assertCartStock(prisma, intangible.merchantId, [{ sku: "red", variantId: intangible.variantId, quantity: 1 }]); }
  });

  it("real cart admission rejects accumulated additions and quantity edits per variant", async () => {
    const f = await fixture("physical", 2), carts = new PrismaStorefrontCartRepository(prisma), sessionId = randomUUID();
    const item = { variantId: f.variantId, productId: f.productId, sku: "red", name: "QA", unitPriceCents: 1700, quantity: 1 };
    await carts.addItem(f.merchantId, sessionId, item); await carts.addItem(f.merchantId, sessionId, item);
    await assert.rejects(carts.addItem(f.merchantId, sessionId, item), /variant_out_of_stock/);
    await assert.rejects(carts.updateItemQuantity(f.merchantId, sessionId, f.variantId, 3), /variant_out_of_stock/);
    assert.equal((await carts.getOrCreate(f.merchantId, sessionId)).items[0].quantity, 2);
    const concurrentSession = randomUUID();
    const outcomes = await Promise.allSettled(Array.from({ length: 8 }, () => carts.addItem(f.merchantId, concurrentSession, item)));
    assert.equal(outcomes.filter(outcome => outcome.status === "fulfilled").length, 2);
    assert.equal(outcomes.filter(outcome => outcome.status === "rejected" && /variant_out_of_stock/.test(String(outcome.reason))).length, 6);
    const concurrentCart = await carts.getOrCreate(f.merchantId, concurrentSession);
    assert.equal(concurrentCart.items.length, 1); assert.equal(concurrentCart.items[0].quantity, 2); assert.equal(concurrentCart.total, 3400);
  });

  it("concurrent reservation of one unit admits exactly one request and blocks reducing reserved stock", async () => {
    const f = await fixture("physical", 1), stock = new PrismaStockRepository(prisma);
    const outcomes = await Promise.allSettled(Array.from({ length: 20 }, () => stock.reserve({ merchantId: f.merchantId, variantId: f.variantId, quantity: 1, idempotencyKey: randomUUID() })));
    assert.equal(outcomes.filter(o => o.status === "fulfilled").length, 1);
    assert.equal((await balance(f)).stock.reserved, 1);
    await assert.rejects(movement(f, 1, "ADJUSTMENT"), /stock_quantity_below_reserved/);
    assert.equal((await balance(f)).item.quantity, 1);
  });
});
