import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { NotFoundException, ConflictException } from "@nestjs/common";
import { PrismaStockRepository } from "./prisma-stock.repository.js";
import { CatalogVariantService } from "../../application/services/catalog-variant.service.js";

// Requires a disposable database: expiry intentionally processes the global queue.
const clientPath = process.env.READY_PROD_TEST_PRISMA_CLIENT;
const databaseUrl = process.env.READY_PROD_TEST_DATABASE_URL;
describe("catalog isolation and stock conservation (PostgreSQL)", { skip: !clientPath || !databaseUrl }, () => {
  let prisma: any;
  let repository: PrismaStockRepository;
  const merchantId = `audit_${randomUUID()}`;
  const foreignMerchantId = `audit_${randomUUID()}`;
  const products: string[] = [];
  let uploads = 0;
  let mediaService: CatalogVariantService;

  before(async () => {
    const { PrismaClient } = createRequire(import.meta.url)(clientPath!);
    prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } }, transactionOptions: { maxWait: 30000, timeout: 10000 } });
    await prisma.$connect();
    repository = new PrismaStockRepository(prisma);
    mediaService = new CatalogVariantService(prisma, {
      isConfigured: () => true,
      uploadBase64: async () => { uploads++; return { url: "https://example.invalid/audit-image.png" }; },
    } as any);
  });
  after(async () => {
    if (!prisma) return;
    await prisma.stockReservation.deleteMany({ where: { variant: { productId: { in: products } } } });
    await prisma.product.deleteMany({ where: { id: { in: products } } });
    await prisma.$disconnect();
  });

  async function fixture(quantities = [1]) {
    const product = await prisma.product.create({ data: {
      merchantId, name: "Audit fixture", variants: { create: [{ sku: randomUUID(), price: { create: { basePriceInCents: 1000 } },
        stock: { create: quantities.map((quantity, index) => ({ warehouseId: `warehouse_${index}`, quantity })) },
      }] },
    }, include: { variants: { include: { stock: { orderBy: { id: "asc" } } } } } });
    products.push(product.id);
    const variant = product.variants[0];
    return { productId: product.id, variantId: variant.id, stocks: variant.stock };
  }
  function input(variantId: string, idempotencyKey = randomUUID(), quantity = 1) { return { merchantId, variantId, idempotencyKey, quantity }; }
  const balance = (id: string) => prisma.productStock.findUniqueOrThrow({ where: { id } });

  it("permits exactly one of 100 concurrent reservations for one unit", async () => {
    const f = await fixture();
    const results = await Promise.allSettled(Array.from({ length: 100 }, () => repository.reserve(input(f.variantId))));
    assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
    for (const result of results) if (result.status === "rejected") assert.equal(result.reason.message, "insufficient_stock");
    const stock = await balance(f.stocks[0].id);
    assert.equal(stock.quantity, 1);
    assert.equal(stock.reserved, 1);
    assert.equal(await prisma.stockReservation.count({ where: { variantId: f.variantId } }), 1);
  });

  it("serializes duplicate keys and rejects a changed quantity", async () => {
    const f = await fixture([20]);
    const request = input(f.variantId);
    const responses = await Promise.all(Array.from({ length: 30 }, () => repository.reserve(request)));
    assert.equal(new Set(responses.map((response) => response.reservationId)).size, 1);
    assert.equal((await balance(f.stocks[0].id)).reserved, 1);
    await assert.rejects(repository.reserve({ ...request, quantity: 2 }), /reservation_idempotency_conflict/);
  });

  it("denies another merchant before reservation retry or confirmation can mutate stock", async () => {
    const f = await fixture();
    const request = input(f.variantId);
    const reservation = await repository.reserve(request);
    await assert.rejects(repository.reserve({ ...request, merchantId: foreignMerchantId }), /stock_not_found/);
    await assert.rejects(repository.confirm(foreignMerchantId, reservation.reservationId), /reservation_not_found/);
    assert.equal((await balance(f.stocks[0].id)).reserved, 1);
    assert.equal((await balance(f.stocks[0].id)).quantity, 1);
  });

  it("rejects runtime absent tenant on reserve and confirm before entering the worker lock path", async () => {
    const f = await fixture();
    const request = input(f.variantId);
    for (const invalidMerchant of [undefined, null, "", "   "]) {
      await assert.rejects(repository.reserve({ ...request, merchantId: invalidMerchant as never }), /stock_not_found/);
    }
    assert.equal((await balance(f.stocks[0].id)).reserved, 0);
    const reservation = await repository.reserve(request);
    for (const invalidMerchant of [undefined, null, "", "   "]) {
      await assert.rejects(repository.confirm(invalidMerchant as never, reservation.reservationId), /reservation_not_found/);
    }
    const stock = await balance(f.stocks[0].id);
    assert.equal(stock.quantity, 1);
    assert.equal(stock.reserved, 1);
  });

  it("confirms only the reserved warehouse once under concurrent retries", async () => {
    const f = await fixture([2, 2]);
    const request = input(f.variantId);
    const reservation = await repository.reserve(request);
    const row = await prisma.stockReservation.findUniqueOrThrow({ where: { id: reservation.reservationId } });
    await Promise.all(Array.from({ length: 10 }, () => repository.confirm(merchantId, row.id)));
    for (const stock of f.stocks) {
      const updated = await balance(stock.id);
      assert.equal(updated.quantity, stock.id === row.stockId ? 1 : 2);
      assert.equal(updated.reserved, 0);
    }
    const retry = await repository.reserve(request);
    assert.equal(retry.reservationId, row.id);
    assert.equal(await prisma.stockReservation.count({ where: { variantId: f.variantId } }), 1);
  });

  it("competes confirm with expiry and concurrent workers without duplicate release", async () => {
    const f = await fixture([2, 2]);
    const reservation = await repository.reserve(input(f.variantId));
    await prisma.stockReservation.update({ where: { id: reservation.reservationId }, data: { expiresAt: new Date(Date.now() - 1000) } });
    const [confirmation, ...workers] = await Promise.allSettled([
      repository.confirm(merchantId, reservation.reservationId), repository.releaseExpired(), repository.releaseExpired(), repository.releaseExpired(),
    ]);
    assert.equal(confirmation.status, "rejected");
    if (confirmation.status === "rejected") assert.equal(confirmation.reason.message, "reservation_not_active");
    assert.equal(workers.reduce((sum, result) => sum + (result.status === "fulfilled" ? Number(result.value) : 0), 0), 1);
    for (const stock of f.stocks) { const updated = await balance(stock.id); assert.equal(updated.quantity, 2); assert.equal(updated.reserved, 0); }
    assert.equal((await prisma.stockReservation.findUniqueOrThrow({ where: { id: reservation.reservationId } })).status, "EXPIRED");
  });

  it("rolls back the status claim if stock balances are inconsistent", async () => {
    const f = await fixture();
    const reservation = await repository.reserve(input(f.variantId));
    await prisma.productStock.update({ where: { id: f.stocks[0].id }, data: { reserved: 0 } });
    await assert.rejects(repository.confirm(merchantId, reservation.reservationId), /stock_invariant_violation/);
    assert.equal((await prisma.stockReservation.findUniqueOrThrow({ where: { id: reservation.reservationId } })).status, "ACTIVE");
    assert.equal((await balance(f.stocks[0].id)).quantity, 1);
  });

  it("fails closed for legacy reservations without a stock binding", async () => {
    const f = await fixture([2, 2]);
    const reservation = await prisma.stockReservation.create({ data: { variantId: f.variantId, quantity: 1, expiresAt: new Date(Date.now() + 60000) } });
    await assert.rejects(repository.confirm(merchantId, reservation.id), /reservation_stock_unresolved/);
    await prisma.stockReservation.update({ where: { id: reservation.id }, data: { expiresAt: new Date(0) } });
    await repository.releaseExpired();
    assert.equal((await prisma.stockReservation.findUniqueOrThrow({ where: { id: reservation.id } })).status, "ACTIVE");
  });

  it("denies foreign media upload/deletion and mismatched product paths", async () => {
    const f = await fixture();
    const previousUploads = uploads;
    await assert.rejects(mediaService.uploadMedia(foreignMerchantId, { variantId: f.variantId, image: "test" }), NotFoundException);
    assert.equal(uploads, previousUploads);
    const media = await mediaService.uploadMedia(merchantId, { variantId: f.variantId, image: "test" });
    await assert.rejects(mediaService.deleteMedia(foreignMerchantId, media.id), NotFoundException);
    assert.equal(await prisma.productMedia.count({ where: { id: media.id } }), 1);
    await assert.rejects(mediaService.update(foreignMerchantId, f.productId, f.variantId, { basePriceInCents: 1, stockQuantity: 10 }), NotFoundException);
    await assert.rejects(mediaService.update(merchantId, "other-product", f.variantId, { weightGrams: 10 }), NotFoundException);
    assert.equal((await prisma.productPrice.findUniqueOrThrow({ where: { variantId: f.variantId } })).basePriceInCents, 1000);
    assert.equal((await balance(f.stocks[0].id)).quantity, 1);
    await mediaService.deleteMedia(merchantId, media.id);
  });

  it("rolls back variant edits that would put quantity below reservations or broadcast to warehouses", async () => {
    const f = await fixture();
    await repository.reserve(input(f.variantId));
    await assert.rejects(mediaService.update(merchantId, f.productId, f.variantId, { basePriceInCents: 999, stockQuantity: 0 }), ConflictException);
    assert.equal((await prisma.productPrice.findUniqueOrThrow({ where: { variantId: f.variantId } })).basePriceInCents, 1000);
    const multi = await fixture([1, 2]);
    await assert.rejects(mediaService.update(merchantId, multi.productId, multi.variantId, { stockQuantity: 4 }), /stock_warehouse_required/);
    for (const stock of multi.stocks) assert.equal((await balance(stock.id)).quantity, stock.quantity);
  });

  it("conserves stock when an admin quantity change races a reservation", async () => {
    const f = await fixture();
    const outcomes = await Promise.allSettled([
      repository.reserve(input(f.variantId)),
      mediaService.update(merchantId, f.productId, f.variantId, { stockQuantity: 0 }),
    ]);
    assert.equal(outcomes.filter((outcome) => outcome.status === "fulfilled").length, 1);
    const stock = await balance(f.stocks[0].id);
    assert.ok(stock.reserved >= 0 && stock.reserved <= stock.quantity);
    assert.ok((stock.quantity === 0 && stock.reserved === 0) || (stock.quantity === 1 && stock.reserved === 1));
  });

  it("drains multiple expiry pages with concurrent workers and distinct carts", async () => {
    const f = await fixture([205]);
    await prisma.productStock.update({ where: { id: f.stocks[0].id }, data: { reserved: 205 } });
    await prisma.stockReservation.createMany({ data: Array.from({ length: 205 }, () => ({
      variantId: f.variantId, stockId: f.stocks[0].id, cartId: randomUUID(), quantity: 1, expiresAt: new Date(0),
    })) });
    const releases = await Promise.all([repository.releaseExpired(), repository.releaseExpired()]);
    assert.equal(releases.reduce((sum, count) => sum + count, 0), 205);
    const stock = await balance(f.stocks[0].id);
    assert.equal(stock.quantity, 205);
    assert.equal(stock.reserved, 0);
    assert.equal(await prisma.stockReservation.count({ where: { variantId: f.variantId, status: "EXPIRED" } }), 205);
  });
});
