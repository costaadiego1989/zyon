import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { PrismaInventorySaleRepository } from "../infrastructure/repositories/prisma-inventory-sale.repository.js";
import { InventoryWebhookEmitterService } from "../application/services/inventory-webhook-emitter.service.js";
import { PrismaIntegrationsRepository } from "../../integrations/infrastructure/prisma-integrations.repository.js";
import type { SaleCompletedEvent } from "../domain/events/sale-completed.event.js";

const clientPath = process.env.READY_PROD_TEST_PRISMA_CLIENT;
const databaseUrl = process.env.READY_PROD_TEST_DATABASE_URL;
describe("inventory paid-sale conservation and durable receipt (PostgreSQL)", { skip: !clientPath || !databaseUrl }, () => {
  let prisma: any; let other: any;
  const merchants: string[] = [];
  before(async () => {
    const { PrismaClient } = createRequire(import.meta.url)(clientPath!);
    const config = { datasources: { db: { url: databaseUrl } }, transactionOptions: { maxWait: 30000, timeout: 15000 } };
    prisma = new PrismaClient(config); other = new PrismaClient(config);
  });
  after(async () => {
    if (!prisma) return;
    await prisma.outboxMessage.deleteMany({ where: { merchantId: { in: merchants } } });
    await prisma.inventorySaleReceipt.deleteMany({ where: { merchantId: { in: merchants } } });
    await prisma.inventoryItem.deleteMany({ where: { merchantId: { in: merchants } } });
    await prisma.merchant.deleteMany({ where: { id: { in: merchants } } });
    await prisma.$disconnect(); await other.$disconnect();
  });
  async function fixture(quantity = 10, reserved = 0) {
    const merchantId = `inventory_stage3_${randomUUID()}`; merchants.push(merchantId);
    await prisma.merchant.create({ data: { id: merchantId, name: "Inventory fixture" } });
    const location = await prisma.inventoryLocation.create({ data: { merchantId, name: "Warehouse", isDefault: true } });
    const item = await prisma.inventoryItem.create({ data: { merchantId, sku: "SKU", productName: "Fixture", locationId: location.id, quantity, reserved, lowStockThreshold: 4 } });
    const sale: SaleCompletedEvent = { merchantId, orderId: `order_${randomUUID()}`, items: [{ sku: "SKU", quantity: 3 }], totalCents: 900, timestamp: "2026-09-06T01:00:00.000Z" };
    return { merchantId, location, item, sale, repo: new PrismaInventorySaleRepository(prisma) };
  }
  it("twenty concurrent deliveries through two replicas debit once and commit one receipt plus three jobs", async () => {
    const f = await fixture(10);
    const results = await Promise.all(Array.from({ length: 20 }, (_, index) => new PrismaInventorySaleRepository(index % 2 ? prisma : other).apply(f.sale)));
    assert.equal(results.filter(result => !result.idempotent).length, 1);
    assert.equal((await prisma.inventoryItem.findUnique({ where: { id: f.item.id } })).quantity, 7);
    assert.equal(await prisma.inventoryMovement.count({ where: { merchantId: f.merchantId } }), 1);
    assert.equal(await prisma.inventorySaleReceipt.count({ where: { merchantId: f.merchantId } }), 1);
    assert.equal(await prisma.outboxMessage.count({ where: { merchantId: f.merchantId } }), 3);
  });
  it("independent orders racing the final available stock conserve reserved units", async () => {
    const f = await fixture(6, 3);
    const outcomes = await Promise.allSettled(Array.from({ length: 20 }, () => f.repo.apply({ ...f.sale, orderId: randomUUID() })));
    assert.equal(outcomes.filter(outcome => outcome.status === "fulfilled").length, 1);
    const item = await prisma.inventoryItem.findUnique({ where: { id: f.item.id } });
    assert.equal(item.quantity, 3); assert.equal(item.reserved, 3);
    assert.equal(await prisma.inventoryAlert.count({ where: { merchantId: f.merchantId } }), 1);
  });
  it("a missing second SKU rolls back first SKU debit, movement, alert, receipt and jobs", async () => {
    const f = await fixture(5);
    await assert.rejects(f.repo.apply({ ...f.sale, items: [...f.sale.items, { sku: "ZZ_MISSING", quantity: 1 }] }), /inventory_item_not_found/);
    assert.equal((await prisma.inventoryItem.findUnique({ where: { id: f.item.id } })).quantity, 5);
    for (const table of ["inventoryMovement", "inventoryAlert", "inventorySaleReceipt", "outboxMessage"]) assert.equal(await prisma[table].count({ where: { merchantId: f.merchantId } }), 0);
  });
  it("failure while inserting the integration job rolls back the entire transaction", async () => {
    const f = await fixture(5);
    const faulty = { $transaction: (callback: any) => prisma.$transaction((tx: any) => callback(new Proxy(tx, { get(target, property) {
      if (property === "outboxMessage") return { create: async () => { throw new Error("injected_outbox_failure"); } };
      const value = target[property]; return typeof value === "function" ? value.bind(target) : value;
    } }))) };
    await assert.rejects(new PrismaInventorySaleRepository(faulty as never).apply(f.sale), /injected_outbox_failure/);
    assert.equal((await prisma.inventoryItem.findUnique({ where: { id: f.item.id } })).quantity, 5);
    for (const table of ["inventoryMovement", "inventoryAlert", "inventorySaleReceipt", "outboxMessage"]) assert.equal(await prisma[table].count({ where: { merchantId: f.merchantId } }), 0);
    assert.equal((await f.repo.apply(f.sale)).idempotent, false);
  });
  it("same order with changed quantity conflicts while timestamp redelivery and grouped duplicate SKU are idempotent", async () => {
    const f = await fixture();
    await f.repo.apply({ ...f.sale, items: [{ sku: "SKU", quantity: 1 }, { sku: "SKU", quantity: 2 }] });
    assert.equal((await f.repo.apply({ ...f.sale, timestamp: "2026-09-07T01:00:00.000Z" })).idempotent, true);
    await assert.rejects(f.repo.apply({ ...f.sale, items: [{ sku: "SKU", quantity: 4 }] }), /idempotency_conflict/);
    assert.equal((await prisma.inventoryItem.findUnique({ where: { id: f.item.id } })).quantity, 7);
  });
  it("two warehouses debit only the explicitly owned allocation", async () => {
    const f = await fixture();
    const second = await prisma.inventoryLocation.create({ data: { merchantId: f.merchantId, name: "Secondary", isDefault: false } });
    const secondItem = await prisma.inventoryItem.create({ data: { merchantId: f.merchantId, sku: "SKU", productName: "Fixture", locationId: second.id, quantity: 20 } });
    await f.repo.apply({ ...f.sale, items: [{ sku: "SKU", quantity: 3, locationId: second.id }] });
    assert.equal((await prisma.inventoryItem.findUnique({ where: { id: f.item.id } })).quantity, 10);
    assert.equal((await prisma.inventoryItem.findUnique({ where: { id: secondItem.id } })).quantity, 17);
  });
  it("foreign warehouse references and corrupted cross-tenant item/location links cannot be debited", async () => {
    const f = await fixture(); const foreign = await fixture();
    await assert.rejects(f.repo.apply({ ...f.sale, items: [{ sku: "SKU", quantity: 1, locationId: foreign.location.id }] }), /location_missing/);
    await prisma.inventoryItem.create({ data: { merchantId: f.merchantId, sku: "FOREIGN_LOCATION", productName: "Corrupt fixture", locationId: foreign.location.id, quantity: 20 } });
    await assert.rejects(f.repo.apply({ ...f.sale, items: [{ sku: "FOREIGN_LOCATION", quantity: 1, locationId: foreign.location.id }] }), /location_missing/);
    assert.equal((await prisma.inventoryItem.findUnique({ where: { id: foreign.item.id } })).quantity, 10);
    const applied = await f.repo.apply(f.sale);
    assert.equal(await f.repo.findReceipt(foreign.merchantId, applied.receiptId), undefined);
  });
  it("ambiguous or missing default warehouse and malformed quantities fail without effects", async () => {
    const f = await fixture();
    await prisma.inventoryLocation.create({ data: { merchantId: f.merchantId, name: "Other default", isDefault: true } });
    await assert.rejects(f.repo.apply(f.sale), /location_missing_or_ambiguous/);
    await prisma.inventoryLocation.updateMany({ where: { merchantId: f.merchantId }, data: { isDefault: false } });
    await assert.rejects(f.repo.apply(f.sale), /location_missing_or_ambiguous/);
    for (const quantity of [0, -1, 1.5, Number.NaN]) await assert.rejects(f.repo.apply({ ...f.sale, items: [{ sku: "SKU", quantity }] }), /invalid/);
    await assert.rejects(f.repo.apply({ ...f.sale, merchantId: undefined as never }), /invalid/);
    assert.equal(await prisma.inventoryMovement.count({ where: { merchantId: f.merchantId } }), 0);
  });
  it("same order identifier in separate tenants creates independent receipts and movements", async () => {
    const f = await fixture(); const otherTenant = await fixture();
    const first = await f.repo.apply(f.sale); const second = await otherTenant.repo.apply({ ...otherTenant.sale, orderId: f.sale.orderId });
    assert.notEqual(first.receiptId, second.receiptId);
    assert.equal((await prisma.inventoryItem.findUnique({ where: { id: f.item.id } })).quantity, 7);
    assert.equal((await prisma.inventoryItem.findUnique({ where: { id: otherTenant.item.id } })).quantity, 7);
  });
  it("webhook job replay persists one delivery per endpoint and item", async () => {
    const f = await fixture(); const sale = await f.repo.apply(f.sale);
    await prisma.merchantWebhookEndpoint.create({ data: { id: randomUUID(), merchantId: f.merchantId, url: "https://example.invalid/hook", enabled: true, events: ["inventory.item.decremented"], signingSecret: "fixture" } });
    const emitter = new InventoryWebhookEmitterService(new PrismaIntegrationsRepository(prisma));
    await Promise.all(Array.from({ length: 10 }, () => emitter.emitWebhooks(sale)));
    assert.equal(await prisma.merchantWebhookDelivery.count({ where: { merchantId: f.merchantId } }), 1);
    assert.equal(await prisma.inventoryMovement.count({ where: { merchantId: f.merchantId } }), 1);
  });
});
