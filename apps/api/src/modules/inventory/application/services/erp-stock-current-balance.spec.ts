import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { createHash } from "node:crypto";
import { ErpSyncService } from "./erp-sync.service.js";

function arrange(t: TestContext, provider: "tiny" | "bling" | "omie") {
  const connection = { id: "connection_a", merchantId: "merchant_a", provider, status: "connected", directionMode: "bidirectional" };
  const mapping = { sku: "SKU", variantId: "variant_a", externalProductId: "123", externalLocationId: "0" };
  const state = {
    connection: true, mappings: [mapping], locations: [{ id: "warehouse_a", isDefault: true }],
    item: { id: "item_a", quantity: 7, reserved: 0 }, stock: { quantity: 7, reserved: 0 }, locked: false, reads: 0,
  };
  const event = { merchantId: connection.merchantId, orderId: "order_a", items: [{ sku: "SKU", variantId: "variant_a", productType: "physical", quantity: 1 }] };
  const receipt = { id: "receipt_a", orderId: event.orderId, payload: event,
    result: { items: [{ sku: "SKU", itemId: "item_a", locationId: "warehouse_a", quantity: 1, remainingQuantity: 9 }] } };
  const tx = {
    $queryRaw: async () => { state.locked = true; return [{ id: connection.merchantId }]; },
    erpConnection: { findFirst: async ({ where }: any) => {
      assert.equal(state.locked, true); assert.equal(where.merchantId, connection.merchantId);
      assert.equal(where.id, connection.id); assert.equal(where.provider, provider); assert.equal(where.status, "connected");
      return state.connection ? { id: connection.id } : null;
    } },
    erpProductMapping: { findMany: async ({ where }: any) => {
      assert.equal(state.locked, true); assert.equal(where.merchantId, connection.merchantId); assert.equal(where.connectionId, connection.id); assert.equal(where.sku, "SKU"); return state.mappings;
    } },
    productVariant: { findMany: async ({ where }: any) => {
      assert.equal(state.locked, true); assert.equal(where.product.merchantId, connection.merchantId); assert.equal(where.product.type, "physical");
      return [{ id: "variant_a", stock: [state.stock] }];
    } },
    inventoryLocation: { findMany: async ({ where }: any) => {
      assert.equal(state.locked, true); assert.equal(where.merchantId, connection.merchantId); assert.equal(where.isActive, true); return state.locations;
    } },
    inventoryItem: { findMany: async ({ where }: any) => {
      assert.equal(state.locked, true); assert.equal(where.merchantId, connection.merchantId); assert.equal(where.sku, "SKU"); assert.equal(where.locationId, "warehouse_a");
      state.reads++; return [state.item];
    } },
  };
  const prisma = {
    inventorySaleReceipt: { findFirst: async () => receipt },
    productVariant: { findMany: async () => [{ id: "variant_a", sku: "SKU" }] },
    fiscalSaleSnapshot: { findMany: async () => [] },
    erpProductMapping: { findFirst: async () => mapping },
    $transaction: async (work: (transaction: typeof tx) => Promise<number>) => {
      try { return await work(tx); } finally { state.locked = false; }
    },
  };
  const service = new ErpSyncService(prisma as never) as any;
  // This unit isolates balance authority; real job dispatch/uncertainty runs in PostgreSQL proofs.
  t.mock.method(service, "withDurableAbsoluteStockWrite", async (_job: unknown, _connection: unknown, _input: unknown, work: () => Promise<void>) => work());
  const writes: Array<{ quantity: number; key: string }> = [];
  const record = (_connection: unknown, _id: string, quantity: number, key: string) => {
    assert.equal(state.locked, false, "merchant transaction must end before stock HTTP"); writes.push({ quantity, key });
  };
  t.mock.method(service, "pushTinySnapshot", async (...args: unknown[]) => record(...args as [unknown, string, number, string]));
  t.mock.method(service, "pushBlingSnapshot", async (...args: unknown[]) => record(...args as [unknown, string, number, string]));
  t.mock.method(service, "pushOmieSale", async (_connection: unknown, _id: string, quantity: number, _orderId: string, key: string) => { writes.push({ quantity, key }); });
  t.mock.method(service, "blingToken", async () => "synthetic-token");
  t.mock.method(service, "blingDefaultDepositId", async () => 456);
  return { service, state, writes, connection, prisma, push: () => service.pushSale(connection, connection.merchantId, receipt.id) };
}

for (const provider of ["tiny", "bling"] as const) test(`${provider} absolute sale reads current canonical balance instead of historical receipt`, async t => {
  const f = arrange(t, provider);
  await f.push(); f.state.item.quantity = 5; f.state.stock.quantity = 5; await f.push();
  assert.deepEqual(f.writes.map(row => row.quantity), [7, 5]);
  assert.equal(f.state.reads, 2);
  const originalKey = createHash("sha256").update("connection_a:receipt_a:item_a").digest("hex").slice(0, 48);
  assert.deepEqual(f.writes.map(row => row.key), [originalKey, originalKey]);
});

test("Omie preserves relative receipt quantity and stable key without reading absolute balance", async t => {
  const f = arrange(t, "omie");
  t.mock.method(f.prisma, "$transaction", async () => assert.fail("relative Omie path must not read an absolute balance"));
  await f.push();
  assert.deepEqual(f.writes, [{ quantity: 1, key: createHash("sha256").update("connection_a:receipt_a:item_a").digest("hex").slice(0, 48) }]);
  assert.equal(f.state.reads, 0);
});

for (const failure of ["connection", "mapping", "multiple_locations", "wrong_item", "projection", "reserved"] as const) test(`absolute sale rejects unproven ${failure} before stock HTTP`, async t => {
  const f = arrange(t, "tiny");
  const expected = failure === "connection" ? /erp_stock_export_disabled/ : failure === "mapping" ? /erp_product_mapping_required/ : failure === "multiple_locations" ? /erp_stock_location_ambiguous/ : /erp_stock_balance_unproven/;
  if (failure === "connection") f.state.connection = false;
  if (failure === "mapping") f.state.mappings = [{ ...f.state.mappings[0]!, externalProductId: "foreign_product" }];
  if (failure === "multiple_locations") f.state.locations.push({ id: "warehouse_b", isDefault: false });
  if (failure === "wrong_item") f.state.item.id = "foreign_item";
  if (failure === "projection") f.state.stock.quantity = 8;
  if (failure === "reserved") f.state.stock.reserved = 8;
  await assert.rejects(f.push(), expected);
  assert.deepEqual(f.writes, []);
});
