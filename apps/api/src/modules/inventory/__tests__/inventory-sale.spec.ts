import "reflect-metadata";
import test from "node:test";
import assert from "node:assert/strict";
import { Global, Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { CHECKOUT_SESSION_REPOSITORY } from "../../checkout/domain/ports/checkout-session.repository.port.js";
import { CheckoutPersistenceModule } from "../../checkout/checkout-persistence.module.js";
import { PRISMA_CLIENT } from "../../../shared/persistence/persistence.module.js";
import { DOMAIN_EVENT_BUS } from "../../../shared/events/domain-event-bus.port.js";
import { InventoryOnOrderCompletedHandler } from "../infrastructure/event-handlers/on-order-completed.handler.js";
import { HandleSaleCompletedUseCase } from "../application/use-cases/handle-sale-completed.use-case.js";
import { ErpStockPushService } from "../application/services/erp-stock-push.service.js";
import { InventorySaleIntegrationHandler } from "../infrastructure/event-handlers/on-inventory-sale-integration.handler.js";
import { InventoryWebhookEmitterService } from "../application/services/inventory-webhook-emitter.service.js";
import { INVENTORY_SALE_JOBS } from "../infrastructure/repositories/prisma-inventory-sale.repository.js";
import { HubSpotCrmAdapter } from "../infrastructure/adapters/hubspot-crm.adapter.js";
import { PipedriveCrmAdapter } from "../infrastructure/adapters/pipedrive-crm.adapter.js";
import { RdStationCrmAdapter } from "../infrastructure/adapters/rdstation-crm.adapter.js";

const event = { eventType: "order.completed", merchantId: "merchant_a", payload: { session_id: "session_a", external_order_id: "order_a", order_total: 0 } };
const snapshot = { version: 1, items: [{ sku: "SKU", quantity: 2 }], totalCents: 0, timestamp: "2026-09-06T01:00:00.000Z" };
const applied = { receiptId: "receipt_a", event: { ...snapshot, merchantId: "merchant_a", orderId: "order_a" }, stockDecrementedCount: 1,
  idempotent: false, items: [{ sku: "SKU", itemId: "item_a", locationId: "warehouse_a", quantity: 2, remainingQuantity: 7 }] };

test("Nest resolves the exported checkout Symbol into the inventory order handler", async () => {
  let lookup = 0;
  const bus = { subscribe: () => {} };
  @Global()
  @Module({ providers: [{ provide: PRISMA_CLIENT, useValue: { checkoutSession: { findUnique: async () => { lookup++; return null; } } } }], exports: [PRISMA_CLIENT] })
  class DatabaseFixtureModule {}
  @Module({ imports: [DatabaseFixtureModule, CheckoutPersistenceModule], providers: [InventoryOnOrderCompletedHandler,
    { provide: DOMAIN_EVENT_BUS, useValue: bus }, { provide: HandleSaleCompletedUseCase, useValue: { execute: () => assert.fail("missing session must fail") } }] })
  class FixtureModule {}
  const app = await NestFactory.createApplicationContext(FixtureModule, { logger: false, abortOnError: false });
  try {
    assert.ok(app.get(CHECKOUT_SESSION_REPOSITORY));
    await assert.rejects(app.get(InventoryOnOrderCompletedHandler).handle(event), /inventory_checkout_session_not_found/);
    assert.equal(lookup, 1);
  } finally { await app.close(); }
});
test("versioned order snapshot is immutable, accepts zero value, and ignores nested tenant spoofing", async () => {
  const seen: any[] = [];
  const handler = new InventoryOnOrderCompletedHandler({} as never, { execute: async (sale: unknown) => seen.push(sale) } as never,
    { getSession: () => assert.fail("new snapshot must not re-read mutable cart") } as never);
  await handler.handle({ ...event, payload: { ...event.payload, inventory_sale: { ...snapshot, merchantId: "foreign", orderId: "foreign" } } });
  assert.equal(seen[0].merchantId, "merchant_a"); assert.equal(seen[0].orderId, "order_a"); assert.equal(seen[0].totalCents, 0);
});
test("invalid snapshots, unavailable sessions, mismatched session ownership and stock failures propagate", async () => {
  const handler = new InventoryOnOrderCompletedHandler({} as never, { execute: async () => { throw new Error("stock_failed"); } } as never,
    { getSession: async () => ({ merchantId: "foreign", sessionId: "session_a", cart: { items: [] } }) } as never);
  await assert.rejects(handler.handle(event), /inventory_checkout_session_not_found/);
  await assert.rejects(handler.handle({ ...event, payload: { ...event.payload, inventory_sale: { ...snapshot, version: 9 } } }), /version_unsupported/);
  await assert.rejects(handler.handle({ ...event, payload: { ...event.payload, inventory_sale: { ...snapshot, items: [] } } }), /inventory_sale_invalid/);
  await assert.rejects(handler.handle({ ...event, payload: { ...event.payload, inventory_sale: snapshot } }), /stock_failed/);
});
test("ERP failure retries independently, uses stable keys and absolute stock, and cannot repeat stock handler", async () => {
  const handlers = new Map<string, (event: any) => Promise<void>>(); let attempts = 0; const commands: any[] = [];
  const erp = new ErpStockPushService({ pushStockLevel: async (...args: any[]) => { commands.push(args); if (++attempts === 1) throw new Error("erp_unavailable"); } });
  const consumer = new InventorySaleIntegrationHandler({ subscribe: (type: string, handler: any) => handlers.set(type, handler) } as never,
    { findReceipt: async () => applied, apply: () => assert.fail("integration must not apply stock") } as never,
    erp, { syncSale: async () => {} } as never, { emitWebhooks: async () => {} } as never);
  consumer.onModuleInit();
  const job = { merchantId: "merchant_a", payload: { version: 1, receiptId: "receipt_a", kind: "erp" } };
  await assert.rejects(handlers.get(INVENTORY_SALE_JOBS.erp)!(job), /erp_unavailable/);
  await handlers.get(INVENTORY_SALE_JOBS.erp)!(job);
  assert.deepEqual(commands[0], commands[1]); assert.equal(commands[0][2], 7); assert.equal(commands[0][4].idempotencyKey, "receipt_a:item_a");
  await assert.rejects(new ErpStockPushService().pushStock(applied), /adapter_unavailable/);
});
test("inventory webhooks persist stable identities and only enabled subscriptions owned by tenant", async () => {
  const saved: any[] = [];
  const endpoints = [
    { id: "endpoint_a", merchantId: "merchant_a", enabled: true, events: ["inventory.item.decremented"], url: "https://example.invalid/hook" },
    { id: "foreign", merchantId: "merchant_b", enabled: true, events: ["inventory.item.decremented"] },
    { id: "disabled", merchantId: "merchant_a", enabled: false, events: ["inventory.item.decremented"] },
    { id: "unsubscribed", merchantId: "merchant_a", enabled: true, events: ["order.created"] },
  ];
  const emitter = new InventoryWebhookEmitterService({ listWebhookEndpoints: async () => endpoints, saveWebhookDelivery: async (value: unknown) => { saved.push(value); } } as never);
  await emitter.emitWebhooks(applied); await emitter.emitWebhooks(applied);
  assert.equal(saved.length, 2); assert.equal(saved[0].id, saved[1].id); assert.equal(saved[0].eventId, saved[1].eventId);
  assert.equal(saved[0].endpointId, "endpoint_a"); assert.equal(saved[0].envelope.data.remaining_quantity, 7);
});
test("CRM provider HTTP and transport failures propagate with static errors without external requests", async t => {
  const priorFetch = globalThis.fetch; t.after(() => { globalThis.fetch = priorFetch; });
  const adapters = [new HubSpotCrmAdapter("fixture"), new PipedriveCrmAdapter("fixture"), new RdStationCrmAdapter("fixture")];
  for (const adapter of adapters) {
    globalThis.fetch = async () => new Response("provider secret body", { status: 500 });
    await assert.rejects(adapter.upsertContact("merchant_a", { email: "buyer@example.test" }), /inventory_crm_provider_failed/);
    await assert.rejects(adapter.createDeal("merchant_a", { contactEmail: "buyer@example.test", title: "order", valueCents: 200 }), /inventory_crm_provider_failed/);
    globalThis.fetch = async () => { throw new Error("secret-bearing transport URL"); };
    await assert.rejects(adapter.upsertContact("merchant_a", { email: "buyer@example.test" }), /inventory_crm_provider_failed/);
  }
});
