import { PrismaProductRepository } from "../../catalog/infrastructure/repositories/prisma-product.repository.js";
import { PrismaInventorySaleRepository } from "../../inventory/infrastructure/repositories/prisma-inventory-sale.repository.js";
import assert from "node:assert/strict";
import test, { before, after } from "node:test";
import { createFiscalFixture } from "../../../../tests/fiscal-fixture.js";
import { arrangeIssuance } from "../../../../tests/fiscal-issuance-harness.js";
import { FiscalReconciliationService } from "./fiscal-reconciliation.service.js";
import { PrismaFiscalStockCoordinator } from "../../../shared/persistence/fiscal-stock-coordination.js";
import { Registry } from "prom-client";
import { FiscalObservability } from "../infrastructure/fiscal-observability.js";
import { PrismaFiscalIssuanceStore } from "../infrastructure/prisma-fiscal-issuance.store.js";
let f: Awaited<ReturnType<typeof createFiscalFixture>>;
before(async () => { f = await createFiscalFixture(); }, { timeout: 120000 });
after(async () => { await f?.close(); });
const noEffects = { read: async () => ({ found: false as const, reasonCode: "fiscal_stock_evidence_pending" }) };
function setup(a: Awaited<ReturnType<typeof arrangeIssuance>>, effects = noEffects) { return new FiscalReconciliationService(a.store, a.factory, effects, new PrismaFiscalStockCoordinator(f.prisma)); }
async function ready(a: Awaited<ReturnType<typeof arrangeIssuance>>) { await a.run(); if (a.sale.connection.stockOwner === "provider") await f.prisma.fiscalIntent.update({ where: { id: a.sale.intent.id }, data: { remoteOrderId: "order_original" } }); a.setRemote("authorized"); }
test("FISCAL-30 matching uncertain note binds to the existing intent without another POST", async () => {
  const a = await arrangeIssuance(f); a.setBehavior("timeout"); await a.run(); a.setRemote("authorized"); await setup(a).reconcile(a.scope, a.sale.intent.id);
  assert.equal((await a.current()).state, "authorized"); assert.equal((await a.current()).remoteInvoiceId, a.sale.intent.stableReference); assert.equal(a.writes().length, 1); assert.equal(await f.prisma.fiscalIntent.count({ where: a.scope }), 1);
});
test("FISCAL-39 authorization followed by a stale processing reply preserves exact authorization fields", async () => {
  const a = await arrangeIssuance(f); await ready(a); await setup(a).reconcile(a.scope, a.sale.intent.id); const before = await f.prisma.fiscalDocument.findUniqueOrThrow({ where: { intentId: a.sale.intent.id } });
  a.setRemote("processing"); await setup(a).reconcile(a.scope, a.sale.intent.id); const after = await f.prisma.fiscalDocument.findUniqueOrThrow({ where: { intentId: a.sale.intent.id } });
  assert.equal((await a.current()).state, "authorized"); assert.equal(after.accessKey, before.accessKey); assert.equal(after.authorizationProtocol, before.authorizationProtocol); assert.equal(after.number, before.number); assert.equal(after.series, before.series); assert.equal(after.authorizedAt!.toISOString(), before.authorizedAt!.toISOString()); assert.equal(after.providerStatus, before.providerStatus);
});
test("FISCAL-40 a pending note without webhook is recovered by authenticated original-provider query", async () => {
  const a = await arrangeIssuance(f); await ready(a); await setup(a).reconcile(a.scope, a.sale.intent.id);
  assert.equal((await a.current()).state, "authorized"); assert.equal(a.writes().length, 1); assert.ok(a.calls.filter(c => c.method === "GET").every(c => c.url.includes(a.sale.intent.stableReference)));
});
test("FISCAL-38 another merchant or environment cannot claim or query the requested intent", async () => {
  const a = await arrangeIssuance(f); const service = setup(a);
  await assert.rejects(service.reconcile({ ...a.scope, merchantId: "foreign" }, a.sale.intent.id), /not_found_or_busy/); await assert.rejects(service.reconcile({ ...a.scope, environment: "production" }, a.sale.intent.id), /not_found_or_busy/); assert.equal(a.calls.length, 0);
});
test("FISCAL-62 replacing the current provider does not move an already submitted intent", async () => {
  const a = await arrangeIssuance(f); await ready(a); await f.prisma.fiscalConnection.create({ data: { merchantId: a.sale.merchantId, environment: a.sale.environment, provider: "omie", issuerTaxId: a.sale.connection.issuerTaxId } }); await setup(a).reconcile(a.scope, a.sale.intent.id);
  assert.equal((await a.current()).connectionId, a.sale.connection.id); assert.equal((await a.current()).state, "authorized"); assert.ok(a.calls.every(c => c.url.startsWith("https://homologacao.focusnfe.com.br/")));
});
test("FISCAL-64 authorization persistence failure remains recoverable and publishes no false success", async () => {
  const a = await arrangeIssuance(f); await ready(a);
  await f.sql.query(`CREATE FUNCTION fail_authorization() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.intent_id = '${a.sale.intent.id}' AND NEW.state = 'authorized' THEN RAISE EXCEPTION 'synthetic persistence failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER fail_authorization BEFORE UPDATE ON fiscal_documents FOR EACH ROW EXECUTE FUNCTION fail_authorization()`);
  await setup(a).reconcile(a.scope, a.sale.intent.id); assert.equal((await a.current()).state, "reconciliation_required"); assert.equal((await f.prisma.fiscalDocument.findUniqueOrThrow({ where: { intentId: a.sale.intent.id } })).state, "processing");
  assert.equal(await f.prisma.outboxMessage.count({ where: { eventId: "fiscal.authorized:" + a.sale.intent.id } }), 0);
  await f.sql.query("DROP TRIGGER fail_authorization ON fiscal_documents; DROP FUNCTION fail_authorization()"); await setup(a).reconcile(a.scope, a.sale.intent.id); assert.equal((await a.current()).state, "authorized"); assert.equal(a.writes().length, 1);
});
test("FISCAL-40 disconnected original connection keeps authorization and does not fall back to another credential", async () => {
  const a = await arrangeIssuance(f); await ready(a); await setup(a).reconcile(a.scope, a.sale.intent.id); const count = a.calls.length; await f.prisma.fiscalConnection.update({ where: { id: a.sale.connection.id }, data: { disconnectedAt: new Date() } });
  await setup(a).reconcile(a.scope, a.sale.intent.id); assert.equal((await a.current()).state, "authorized"); assert.equal((await a.current()).lastErrorCode, "fiscal_reauthorization_required"); assert.equal(a.calls.length, count);
});
test("FISCAL-39 stale errors and not-found results cannot regress a confirmed authorized result", async () => {
  const a = await arrangeIssuance(f); await ready(a); await setup(a).reconcile(a.scope, a.sale.intent.id); a.setRemote("absent"); await setup(a).reconcile(a.scope, a.sale.intent.id);
  assert.equal((await a.current()).state, "authorized"); assert.equal((await f.prisma.fiscalDocument.findUniqueOrThrow({ where: { intentId: a.sale.intent.id } })).authorizationProtocol, "151260029467289"); assert.equal(a.writes().length, 1);
});
test("FISCAL-33 stock pending is independent of authorized invoice and remains scheduled", async () => {
  const a = await arrangeIssuance(f, { stockOwner: "provider" }); await ready(a); await setup(a).reconcile(a.scope, a.sale.intent.id);
  assert.equal((await a.current()).state, "authorized"); assert.equal((await a.current()).lastErrorCode, "fiscal_stock_evidence_pending"); assert.ok((await a.current()).nextAttemptAt.getTime() < Date.now() + 60000); assert.equal(await f.prisma.fiscalEvent.count({ where: { intentId: a.sale.intent.id, action: "stock_effect_reconciled" } }), 0);
});
test("FISCAL-64 stock proof and release request commit together, missing local receipt retries release only", async () => {
  const a = await arrangeIssuance(f, { stockOwner: "provider" }); await ready(a); let reads = 0;
  const effects = { read: async (context: any) => { reads++; return { found: true as const, evidence: { identity: context.identity, intentId: context.intent.id, snapshotHash: context.snapshot.contentHash, remoteOrderId: "order_original", remoteInvoiceId: context.identity.reference,
    lines: [{ sku: "shirt", quantity: 2 }], evidenceReference: "synthetic-authenticated-movement:receipt_original" } }; } };
  const service = setup(a, effects); await service.reconcile(a.scope, a.sale.intent.id); const proof = await f.prisma.fiscalEvent.findFirstOrThrow({ where: { intentId: a.sale.intent.id, action: "stock_effect_reconciled" } });
  const message = await f.prisma.outboxMessage.findFirstOrThrow({ where: { merchantId: a.sale.merchantId, eventType: "fiscal.stock.release_requested" } }); assert.equal((message.payload as any).evidenceEventId, proof.id); assert.equal((await a.current()).state, "authorized");
  const before = a.calls.length; await service.reconcile(a.scope, a.sale.intent.id); assert.equal(a.calls.length, before); assert.equal(reads, 1); assert.equal((await a.current()).lastErrorCode, "fiscal_stock_local_effect_pending"); assert.equal(a.writes().length, 1);
});
test("FISCAL-38 mismatched operation-specific stock evidence cannot release an authorized sale", async () => {
  const a = await arrangeIssuance(f, { stockOwner: "provider" }); await ready(a);
  const effects = { read: async (context: any) => ({ found: true as const, evidence: { identity: { ...context.identity, merchantId: "foreign" }, intentId: context.intent.id, snapshotHash: context.snapshot.contentHash, remoteOrderId: "order", remoteInvoiceId: context.identity.reference, lines: [{ sku: "shirt", quantity: 2 }], evidenceReference: "foreign:movement" } }) };
  await setup(a, effects).reconcile(a.scope, a.sale.intent.id); assert.equal(await f.prisma.fiscalEvent.count({ where: { intentId: a.sale.intent.id, action: "stock_effect_reconciled" } }), 0); assert.equal(await f.prisma.outboxMessage.count({ where: { merchantId: a.sale.merchantId, eventType: "fiscal.stock.release_requested" } }), 0); assert.equal((await a.current()).state, "authorized"); assert.equal((await a.current()).lastErrorCode, "fiscal_stock_evidence_mismatch"); assert.equal(a.writes().length, 1);
});

test("FISCAL-54 real Focus authenticated cancellation event changes only fiscal status and retains original authorization", async () => {
  const a = await arrangeIssuance(f); await ready(a); await setup(a).reconcile(a.scope, a.sale.intent.id); const before = await f.prisma.fiscalDocument.findUniqueOrThrow({ where: { intentId: a.sale.intent.id } });
  a.setRemote("cancelled"); await setup(a).reconcile(a.scope, a.sale.intent.id); const after = await f.prisma.fiscalDocument.findUniqueOrThrow({ where: { intentId: a.sale.intent.id } });
  assert.equal((await a.current()).state, "cancelled"); assert.equal(after.cancellationProtocol, "151260029467299"); assert.equal(after.cancelledAt!.toISOString(), "2026-11-15T15:00:00.000Z"); assert.equal(after.authorizationProtocol, before.authorizationProtocol); assert.equal(after.accessKey, before.accessKey); assert.equal(a.writes().length, 1);
});
test("FISCAL-40 revoked authenticated query retains authorized status and exposes reconnection without another provider", async () => {
  const a = await arrangeIssuance(f); await ready(a); await setup(a).reconcile(a.scope, a.sale.intent.id);
  const factory = { build: a.factory.build.bind(a.factory), create: (context: any, payload: any, journal: any) => { const provider = a.factory.create(context, payload, journal); provider.query = async () => { throw new Error("fiscal_reauthorization_required"); }; return provider; } };
  await new FiscalReconciliationService(a.store, factory, noEffects, new PrismaFiscalStockCoordinator(f.prisma)).reconcile(a.scope, a.sale.intent.id); assert.equal((await a.current()).state, "authorized"); assert.equal((await a.current()).lastErrorCode, "fiscal_reauthorization_required"); assert.equal(a.writes().length, 1);
});

test("FISCAL-64 committed release after real local decrement never repeats the adapter submit or local stock effect", async () => {
  const a = await arrangeIssuance(f, { stockOwner: "provider" });
  const product = await new PrismaProductRepository(f.prisma).create({ merchantId: a.sale.merchantId, name: "Camiseta", variants: [{ sku: "shirt", attributes: {}, basePriceInCents: 1000, weightGrams: 100, stockQuantity: 10 }] });
  const inventory = new PrismaInventorySaleRepository(f.prisma); const event = { merchantId: a.sale.merchantId, orderId: a.sale.orderId, items: [{ sku: "shirt", quantity: 2, variantId: product.variants[0]!.id }], totalCents: 2101, timestamp: a.sale.snapshot.completedAt.toISOString() };
  const local = await inventory.apply(event); assert.equal(local.stockDecrementedCount, 1); assert.equal(local.items[0]!.remainingQuantity, 8);
  await ready(a); const effects = { read: async (context: any) => ({ found: true as const, evidence: { identity: context.identity, intentId: context.intent.id, snapshotHash: context.snapshot.contentHash, remoteOrderId: "order_original", remoteInvoiceId: context.identity.reference, lines: [{ sku: "shirt", quantity: 2 }], evidenceReference: "synthetic-authenticated-movement:original" } }) };
  const service = setup(a, effects); await service.reconcile(a.scope, a.sale.intent.id); const before = a.calls.length; await service.reconcile(a.scope, a.sale.intent.id);
  assert.equal(a.calls.length, before); assert.equal(a.writes().length, 1); assert.equal(await f.prisma.fiscalEvent.count({ where: { intentId: a.sale.intent.id, action: "stock_barrier_released" } }), 1);
  assert.equal((await inventory.apply(event)).idempotent, true); assert.equal((await f.prisma.inventoryItem.findFirstOrThrow({ where: { merchantId: a.sale.merchantId, sku: "shirt" } })).quantity, 8); assert.equal((await a.current()).state, "authorized");
});

test("FISCAL-63 persisted original stock evidence and real local decrement count one committed release separately from authorization", async () => {
  const a = await arrangeIssuance(f, { stockOwner: "provider" });
  const product = await new PrismaProductRepository(f.prisma).create({ merchantId: a.sale.merchantId, name: "Stock metric fixture", variants: [{ sku: "shirt", attributes: {}, basePriceInCents: 1000, weightGrams: 100, stockQuantity: 10 }] });
  const inventory = new PrismaInventorySaleRepository(f.prisma);
  await inventory.apply({ merchantId: a.sale.merchantId, orderId: a.sale.orderId, items: [{ sku: "shirt", quantity: 2, variantId: product.variants[0]!.id }], totalCents: 2101, timestamp: a.sale.snapshot.completedAt.toISOString() });
  await ready(a);
  const registry = new Registry(), observer = new FiscalObservability(registry);
  const store = new PrismaFiscalIssuanceStore(f.prisma, () => new Date(), undefined, observer);
  const stock = new PrismaFiscalStockCoordinator(f.prisma, observer);
  // This synthetic authenticated stock port is the same approved component seam
  // as the existing release proof above; it is not external provider-stock proof.
  const effects = { read: async (context: any) => ({ found: true as const, evidence: { identity: context.identity, intentId: context.intent.id, snapshotHash: context.snapshot.contentHash, remoteOrderId: "order_original", remoteInvoiceId: context.identity.reference, lines: [{ sku: "shirt", quantity: 2 }], evidenceReference: "synthetic-authenticated-movement:metric-original" } }) };
  const service = new FiscalReconciliationService(store, a.factory, effects, stock);
  await service.reconcile(a.scope, a.sale.intent.id);
  await service.reconcile(a.scope, a.sale.intent.id);
  const proof = await f.prisma.fiscalEvent.findFirstOrThrow({ where: { intentId: a.sale.intent.id, action: "stock_effect_reconciled" } });
  await stock.release(a.scope, a.sale.intent.id, proof.id);
  const documents = (await registry.getSingleMetric("fiscal_documents_total")!.get()).values;
  const stocks = (await registry.getSingleMetric("fiscal_stock_total")!.get()).values;
  assert.deepEqual(documents.map(row => [row.labels.outcome, row.value]), [["authorized", 1]]);
  assert.deepEqual(stocks.map(row => [row.labels.outcome, row.value]), [["evidence_confirmed", 1], ["released", 1]]);
  assert.equal((await registry.getSingleMetric("fiscal_deliveries_total")!.get()).values.length, 0);
  assert.equal(await f.prisma.fiscalEvent.count({ where: { intentId: a.sale.intent.id, action: "stock_barrier_released" } }), 1);
  assert.equal((await f.prisma.inventoryItem.findFirstOrThrow({ where: { merchantId: a.sale.merchantId, sku: "shirt" } })).quantity, 8);
});

test("FISCAL-63 rollback never counts authorization and a throwing observer cannot undo the later committed note", async () => {
  const a = await arrangeIssuance(f); await ready(a);
  const registry = new Registry(), observer = new FiscalObservability(registry);
  const store = new PrismaFiscalIssuanceStore(f.prisma, () => new Date(), undefined, observer);
  const service = new FiscalReconciliationService(store, a.factory, noEffects, new PrismaFiscalStockCoordinator(f.prisma));
  await f.sql.query("CREATE FUNCTION fail_metric_authorization() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.state::text='authorized' THEN RAISE EXCEPTION 'synthetic_metric_rollback'; END IF; RETURN NEW; END $$; CREATE TRIGGER fail_metric_authorization BEFORE UPDATE ON fiscal_documents FOR EACH ROW EXECUTE FUNCTION fail_metric_authorization()");
  try { await service.reconcile(a.scope, a.sale.intent.id); }
  finally { await f.sql.query("DROP TRIGGER fail_metric_authorization ON fiscal_documents; DROP FUNCTION fail_metric_authorization()"); }
  assert.equal((await registry.getSingleMetric("fiscal_documents_total")!.get()).values.some(row => row.labels.outcome === "authorized"), false);
  assert.equal((await a.current()).state, "reconciliation_required");
  const throwing = { transition() { throw new Error("private-observer-diagnostic"); }, stock() {}, delivery() {} };
  const resumed = new FiscalReconciliationService(new PrismaFiscalIssuanceStore(f.prisma, () => new Date(), undefined, throwing), a.factory, noEffects, new PrismaFiscalStockCoordinator(f.prisma));
  await resumed.reconcile(a.scope, a.sale.intent.id);
  assert.equal((await a.current()).state, "authorized");
  assert.equal(a.writes().length, 1);
});
