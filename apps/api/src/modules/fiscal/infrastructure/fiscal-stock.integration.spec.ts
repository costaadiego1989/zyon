import assert from "node:assert/strict";
import test, { before, after } from "node:test";
import { PrismaClient } from "@prisma/client";
import { admitFiscalStock, lockFiscalStock, PrismaFiscalStockCoordinator } from "../../../shared/persistence/fiscal-stock-coordination.js";
import { seedFiscalSale } from "../../../../tests/fiscal-schema-seed.js";
import { createFiscalFixture, stockWorld, deferred, LOCAL_DATABASE, type Fixture } from "../../../../tests/fiscal-stock-current-paths.fixture.js";
import { PrismaErpRepository } from "../../inventory/infrastructure/repositories/prisma-erp.repository.js";
import { encryptErpSecret } from "../../inventory/infrastructure/adapters/erp-secret-cipher.js";
import { beginStockClaim, dispatchStockWrite, finishStockWrite, stockWrites, outboundStockFence, unresolvedConnectionStock } from "../../../shared/persistence/erp-stock-write-state.js";

// Approved current full/sale proofs. Original21cases and RED diagnostics are archived
// verbatim under .specs/release-backend; private catalog exporter is not reintroduced.
let fixture: Fixture;
before(async () => {
  assert.equal(process.env.FISCAL_TEST_DATABASE_URL, LOCAL_DATABASE, "only the exact dedicated local fixture is permitted");
  fixture = await createFiscalFixture();
}, { timeout: 120000 });
after(async () => { await fixture?.close(); });
const write = (kind: "sale" | "fiscal", quantity: number, productId = "123") => ({ kind, productId, quantity });

test("FISCAL-24 D01 unsupported cross-store scope leaves the ordinary current sale path intact", async t => {
  const f = await stockWorld(t, fixture).arrange();
  const foreign = await seedFiscalSale(fixture);
  await fixture.prisma.crossStoreLineItem.create({ data: { hostMerchantId: f.sale.merchantId, sellerMerchantId: foreign.merchantId,
    checkoutSessionId: f.session.sessionId, federatedProductId: "unsupported_fiscal_product", sourceVariantId: "sku_a", quantity: 1,
    unitPriceCents: 1000, commissionRateBps: 0, commissionCents: 0, sellerNetCents: 1000 } });
  await f.approve(); await f.paid();
  assert.equal(((await f.event()).payload as any).fiscal_stock_ownership, undefined);
  assert.equal(await fixture.prisma.fiscalSaleSnapshot.count({ where: { orderMerchantId: f.sale.merchantId, orderId: f.sale.orderId } }), 0);
  assert.equal(await fixture.prisma.fiscalIntent.count({ where: { merchantId: f.sale.merchantId, orderId: f.sale.orderId } }), 0);
  assert.equal((await fixture.prisma.fiscalConnection.findUniqueOrThrow({ where: { id: f.sale.connection.id } })).stockOwner, "provider");
  const receipt = await f.consume(); await f.enqueueReceipt(receipt.id);
  const [job] = await f.jobs("sale"); assert.ok(job); await f.process(job.id);
  assert.equal(await f.local(), 9); assert.equal(f.remote(), 9); assert.equal(f.effectRequests(), 0);
  assert.deepEqual(f.writes, [write("sale", 9)]); assert.equal(await f.movements(), 1);
});

test("FISCAL-26 D02 immutable provider ownership gives one local and one remote decrement across concurrent replay", async t => {
  const f = await stockWorld(t, fixture).arrange(); await f.approve();
  await Promise.all([f.paid(), f.paid()]); await Promise.all([f.consume(), f.consume()]);
  assert.equal(await f.local(), 9); assert.equal(await f.movements(), 1);
  assert.equal(((await f.snapshot()).items as any).erpConnectionId, f.erp.id);
  assert.equal(((await f.event()).payload as any).fiscal_stock_ownership.sellers[0].erpConnectionId, f.erp.id);
  const receipt = await fixture.prisma.inventorySaleReceipt.findFirstOrThrow({ where: { merchantId: f.sale.merchantId, orderId: f.sale.orderId } });
  assert.deepEqual((receipt.payload as any).fiscalStockOwnership, ((await f.event()).payload as any).fiscal_stock_ownership);
  assert.equal((await f.jobs()).length, 0); await f.reconcile(); await f.reconcile();
  assert.equal(f.remote(), 9); assert.equal(f.effectRequests(), 1); assert.deepEqual(f.writes, [write("fiscal", 1)]);
});

test("FISCAL-14 D03 provider fiscal stock remains independent of disabled legacy outbound", async t => {
  const f = await stockWorld(t, fixture).arrange({ direction: "erp_source_of_truth" }); await f.approve(); await f.paid(); await f.consume();
  assert.equal((await f.intent()).state, "queued");
  assert.equal(await fixture.prisma.outboxMessage.count({ where: { merchantId: f.sale.merchantId, eventType: "fiscal.intent.queued" } }), 1);
  await f.reconcile(); assert.equal(await f.local(), 9); assert.equal(f.remote(), 9); assert.equal((await f.jobs()).length, 0);
});

test("FISCAL-26 D04 an in-flight real sale export blocks fiscal admission, retains approved payment and retries exactly once", async t => {
  const f = await stockWorld(t, fixture).arrange();
  const legacy = await f.ordinarySale("before_fiscal");
  assert.equal(legacy.job.kind, "sale"); assert.equal(await f.local(), 9);
  const gate = f.hold(), exporting = f.process(legacy.job.id);
  await Promise.race([gate.arrived.promise, exporting.then(() => { throw new Error("sale did not reach held HTTP"); })]);
  try {
    await f.approve(); await assert.rejects(f.paid(), /fiscal_stock_busy/);
    assert.equal((await fixture.prisma.paymentIntent.findUniqueOrThrow({ where: { id: f.sale.orderId + "_payment" } })).status, "approved");
    assert.equal(await fixture.prisma.completedOrder.count({ where: { merchantId: f.sale.merchantId } }), 0);
    assert.equal(await fixture.prisma.fiscalSaleSnapshot.count({ where: { merchantId: f.sale.merchantId } }), 0);
  } finally { gate.release.resolve(); await exporting; }
  await f.paid(); await f.paid(); await f.consume(); await f.reconcile();
  assert.equal(await f.local(), 8); assert.equal(f.remote(), 8); assert.equal(await f.movements(), 2);
  assert.equal(await fixture.prisma.fiscalIntent.count({ where: { merchantId: f.sale.merchantId } }), 1);
  assert.equal(await fixture.prisma.outboxMessage.count({ where: { merchantId: f.sale.merchantId, eventType: "order.completed" } }), 1);
  assert.deepEqual(f.writes, [write("sale", 9), write("fiscal", 1)]);
});

test("FISCAL-26 D05 genuine ERP restock arrives only through full after provider effect and the release watermark", async t => {
  const f = await stockWorld(t, fixture).arrange({ direction: "erp_source_of_truth" }); await f.approve(); await f.paid(); await f.consume();
  f.restockRemote(12); // external warehouse restock: remote10 ->12; no Zyon exporter exists
  assert.equal((await f.full()).status, "completed");
  assert.equal(await f.local(), 9); assert.equal(f.remote(), 12); assert.equal(f.writes.length, 0);
  await f.reconcile(); assert.equal(f.remote(), 11);
  t.mock.timers.enable({ apis: ["Date"], now: (await f.releaseTime()) + 31001 });
  assert.equal((await f.full()).status, "completed");
  assert.equal(await f.local(), 11); assert.equal(f.remote(), 11); assert.equal(await f.movements(), 1);
  assert.equal((await f.jobs("sale")).length, 0); assert.equal((await f.jobs("full")).length, 2);
  assert.deepEqual(f.writes, [write("fiscal", 1)]);
  assert.equal(await fixture.prisma.inventoryMovement.count({ where: { merchantId: f.sale.merchantId, reason: "Snapshot ERP", quantity: 2 } }), 1);
});

test("FISCAL-26 D06 full pending and pre-release reads cannot restore a sold unit in ERP-source mode", async t => {
  const f = await stockWorld(t, fixture).arrange({ direction: "erp_source_of_truth" }); await f.approve(); await f.paid(); await f.consume();
  await f.full(); assert.equal(await f.local(), 9); assert.equal(f.remote(), 10);
  const gate = f.holdRead(), reading = f.full();
  await Promise.race([gate.arrived.promise, reading.then(() => { throw new Error("full did not reach held stock read"); })]);
  try { await f.reconcile(); } finally { gate.release.resolve(); await reading; }
  assert.equal(await f.local(), 9); assert.equal(f.remote(), 9);
  t.mock.timers.enable({ apis: ["Date"], now: (await f.releaseTime()) + 31001 });
  await f.full(); assert.equal(await f.local(), 9); assert.equal(f.remote(), 9);
  assert.equal(await f.movements(), 1); assert.deepEqual(f.writes, [write("fiscal", 1)]);
  assert.equal((await f.jobs("full")).length, 3);
});

test("FISCAL-26 D07 public completion freezes original owner before late payment and later configuration cannot migrate it", async t => {
  const f = await stockWorld(t, fixture).arrange(); await f.complete.execute(f.request); await f.consume();
  assert.equal((await f.intent()).state, "awaiting_payment");
  await fixture.prisma.fiscalConnection.update({ where: { id: f.sale.connection.id }, data: { stockOwner: "zyon", erpConnectionId: null } });
  const legacy = await f.ordinarySale("late_ordinary"); await f.process(legacy.job.id); assert.equal(f.writes.length, 0);
  await f.approve(); await f.paid(); assert.equal((await f.intent()).state, "queued"); await f.reconcile();
  assert.equal(((await f.snapshot()).items as any).erpConnectionId, f.erp.id);
  assert.equal(((await f.snapshot()).items as any).policy.stockOwner, "provider");
  assert.equal(await f.movements(), 2);
  await f.process(legacy.job.id); assert.equal(await f.local(), 8); assert.equal(f.remote(), 8);
  assert.deepEqual(f.writes, [write("fiscal", 1), write("sale", 8)]);
});

test("FISCAL-26 D08 authorization, forged actor, foreign tenant/environment and stale fence cannot release stock", async t => {
  const f = await stockWorld(t, fixture).arrange(); await f.approve(); await f.paid(); await f.consume(); const intent = await f.intent();
  await fixture.prisma.fiscalIntent.update({ where: { id: intent.id }, data: { state: "authorized" } });
  await assert.rejects(f.coordinator.release(f.scope, intent.id, "missing"), /fiscal_stock_evidence/);
  const binding = await f.coordinator.binding(f.scope, intent.id);
  const wrong = await fixture.prisma.fiscalEvent.create({ data: { ...f.scope, intentId: intent.id, actorKind: "buyer", action: "stock_effect_reconciled", safeReasonCode: binding.evidenceCode, providerEvidenceRef: "forged" } });
  await assert.rejects(f.coordinator.release(f.scope, intent.id, wrong.id), /fiscal_stock_evidence/);
  await assert.rejects(f.coordinator.release({ ...f.scope, merchantId: "foreign" }, intent.id, wrong.id), /fiscal_stock_scope/);
  await assert.rejects(f.coordinator.release({ ...f.scope, environment: "production" }, intent.id, wrong.id), /fiscal_stock_scope/);
  const stale = await fixture.prisma.fiscalEvent.create({ data: { ...f.scope, intentId: intent.id, actorKind: "provider", action: "stock_effect_reconciled", safeReasonCode: binding.evidenceCode, providerEvidenceRef: "old-claim" } });
  await fixture.prisma.fiscalIntent.update({ where: { id: intent.id }, data: { version: { increment: 1 } } });
  await assert.rejects(f.coordinator.release(f.scope, intent.id, stale.id), /fiscal_stock_evidence/);
  assert.equal(await fixture.prisma.fiscalEvent.count({ where: { intentId: intent.id, action: "stock_barrier_released" } }), 0);
  await f.reconcile(); assert.equal(f.remote(), 9); assert.equal(await f.local(), 9);
});

test("FISCAL-26 D09 Zyon-owned stock uses exactly one deduplicated current sale export", async t => {
  const f = await stockWorld(t, fixture).arrange({ owner: "zyon" }); await f.approve(); await f.paid();
  await f.consume(); await f.consume(); const [job] = await f.jobs("sale"); assert.ok(job);
  await f.process(job.id); await f.process(job.id);
  assert.equal((await f.jobs("sale")).length, 1); assert.equal(await f.local(), 9); assert.equal(f.remote(), 9);
  assert.equal(await f.movements(), 1); assert.equal(f.effectRequests(), 0); assert.deepEqual(f.writes, [write("sale", 9)]);
});

test("FISCAL-26 D10 current sale timeout retains durable unsettled admission after lock closes and after late remote effect", async t => {
  const f = await stockWorld(t, fixture).arrange(); const legacy = await f.ordinarySale("timed_out");
  const timeout = f.timeoutNextWrite();
  try {
    await f.process(legacy.job.id);
    const job = await fixture.prisma.erpSyncJob.findUniqueOrThrow({ where: { id: legacy.job.id } });
    // Explicit current-path characterization, not the absent catalog export's uncertain state.
    assert.equal(job.status, "uncertain"); assert.equal(job.attempts, 1); assert.equal(job.lastErrorCode, "erp_sale_delivery_uncertain");
    assert.ok(job.startedAt); assert.equal(job.lockedUntil, null); assert.equal(job.nextAttemptAt, null);
    await f.approve(); await assert.rejects(f.paid(), /fiscal_stock_export_unsettled/);
    assert.equal(f.remote(), 10); timeout.late.resolve(); await timeout.accepted; assert.equal(f.remote(), 9);
    await assert.rejects(f.paid(), /fiscal_stock_export_unsettled/);
    // A different client observes the same durable uncertainty after the transient lock is gone.
    await assert.rejects(f.other.$transaction(tx => admitFiscalStock(tx, f.sale.merchantId, f.erp.id, ["sku_a"])), /fiscal_stock_export_unsettled/);
    assert.equal(await fixture.prisma.fiscalSaleSnapshot.count({ where: { merchantId: f.sale.merchantId } }), 0);
    assert.equal((await fixture.prisma.paymentIntent.findUniqueOrThrow({ where: { id: f.sale.orderId + "_payment" } })).status, "approved");
    assert.equal(f.effectRequests(), 0); assert.equal(await f.local(), 9); assert.equal(await f.movements(), 1);
    assert.deepEqual(f.writes, [write("sale", 9)]);
  } finally { timeout.late.resolve(); await timeout.accepted; }
});

test("FISCAL-26 D11 pending fiscal SKU permits another SKU sale on that connection and another merchant's sale", async t => {
  const world = stockWorld(t, fixture), f = await world.arrange(); await f.approve(); await f.paid(); await f.consume();
  const variantB = await f.addSku(); const otherSku = await f.ordinarySale("sku_b_sale", "sku_b", variantB); await f.process(otherSku.job.id);
  assert.equal(f.remote("456"), 19); assert.equal(await f.local("sku_b"), 19);
  assert.equal(f.remote(), 10); assert.equal(await f.local(), 9);
  assert.equal((await fixture.prisma.erpSyncJob.findUniqueOrThrow({ where: { id: otherSku.job.id } })).status, "completed");
  const other = await world.arrange(); const otherSale = await other.ordinarySale("independent_merchant"); await other.process(otherSale.job.id);
  assert.equal(other.remote(), 9); assert.equal(await other.local(), 9); assert.equal(await other.movements(), 1);
  assert.equal(f.remote(), 10); assert.equal(await f.local(), 9); assert.equal(f.effectRequests(), 0);
  assert.deepEqual(f.writes, [write("sale", 19, "456")]); assert.deepEqual(other.writes, [write("sale", 9)]);
});

test("FISCAL-26 D12 genuine pre-write suppression releases original receipt to one real sale enqueue without fiscal effect", async t => {
  const f = await stockWorld(t, fixture).arrange(); await f.approve(); await f.paid(); const receipt = await f.consume();
  await f.suppress(); const intent = await f.intent();
  const release = await fixture.prisma.outboxMessage.findUniqueOrThrow({ where: { eventId: "fiscal.stock.suppressed:" + intent.id } });
  assert.equal(release.eventType, "inventory.sale.erp_sync_requested"); assert.deepEqual(release.payload, { version: 1, receiptId: receipt.id, kind: "erp" });
  await f.enqueueReceipt(receipt.id); await f.enqueueReceipt(receipt.id); const [job] = await f.jobs("sale"); assert.ok(job);
  await f.process(job.id); await f.process(job.id);
  assert.equal((await f.jobs("sale")).length, 1); assert.equal(f.remote(), 9); assert.equal(await f.local(), 9);
  assert.equal(f.effectRequests(), 0); assert.deepEqual(f.writes, [write("sale", 9)]); assert.equal(await f.movements(), 1);
});

test("FISCAL-26 D13 fiscal callback holds no stock transaction while durable ownership blocks real sale HTTP", async t => {
  const f = await stockWorld(t, fixture).arrange(); await f.approve(); await f.paid(); await f.consume();
  const legacy = await f.ordinarySale("callback_ordinary"), intent = await f.intent();
  await f.coordinator.withEffect(f.scope, intent.id, async () => {
    await f.other.$transaction(tx => lockFiscalStock(tx, f.sale.merchantId, f.erp.id, ["sku_a"]));
    await f.process(legacy.job.id); assert.equal(f.writes.length, 0);
    assert.equal((await fixture.prisma.erpSyncJob.findUniqueOrThrow({ where: { id: legacy.job.id } })).status, "queued");
    await f.reconcile();
  });
  assert.equal(f.effectRequests(), 1); assert.equal(f.remote(), 9); assert.equal(await f.local(), 8);
  await f.process(legacy.job.id); assert.equal(f.remote(), 8); assert.equal(await f.movements(), 2);
  assert.deepEqual(f.writes, [write("fiscal", 1), write("sale", 8)]);
});

test("FISCAL-26 D14 same-SKU ordinary sale waits for fiscal effect before its absolute receipt balance exports", async t => {
  const f = await stockWorld(t, fixture).arrange(); await f.approve(); await f.paid(); await f.consume();
  const legacy = await f.ordinarySale("legacy"); await f.process(legacy.job.id);
  assert.equal(f.writes.length, 0); assert.equal(await f.local(), 8);
  await f.reconcile(); await f.process(legacy.job.id); assert.equal(f.remote(), 8); assert.equal(await f.local(), 8);
  assert.equal(await f.movements(), 2); assert.deepEqual(f.writes, [write("fiscal", 1), write("sale", 8)]);
});

test("FISCAL-26 D15 missing fiscal configuration preserves action_required barrier while allowing paid local stock", async t => {
  const f = await stockWorld(t, fixture).arrange();
  await fixture.prisma.fiscalProfileVersion.update({ where: { id: f.sale.profile.id }, data: { itemRules: {} } });
  await f.approve(); await f.paid(); await f.consume(); assert.equal((await f.intent()).state, "action_required"); assert.equal(await f.local(), 9);
  const legacy = await f.ordinarySale("action_required_ordinary"); await f.process(legacy.job.id);
  const job = await fixture.prisma.erpSyncJob.findUniqueOrThrow({ where: { id: legacy.job.id } });
  assert.equal(f.writes.length, 0); assert.equal(job.status, "queued"); assert.equal(job.attempts, 0); assert.equal(job.lastErrorCode, "erp_fiscal_stock_pending");
  assert.equal(await f.local(), 8); assert.equal(await f.movements(), 2); assert.equal(f.effectRequests(), 0);
});

test("FISCAL-26 D16 provider proof cannot release before original receipt and recovery sends no second effect", async t => {
  const f = await stockWorld(t, fixture).arrange(); await f.approve(); await f.paid();
  await assert.rejects(f.reconcile(), /fiscal_stock_local_effect_pending/); assert.equal(f.effectRequests(), 1); assert.equal(f.remote(), 9);
  assert.equal(await fixture.prisma.fiscalEvent.count({ where: { intentId: (await f.intent()).id, action: "stock_barrier_released" } }), 0);
  await f.consume(); await f.reconcile(); assert.equal(f.effectRequests(), 1); assert.equal(f.remote(), 9); assert.equal(await f.local(), 9);
  assert.equal(await f.movements(), 1);
});

test("FISCAL-26 D17 preactivation sale keeps proven non-emission and its original sale stock policy", async t => {
  const f = await stockWorld(t, fixture).arrange();
  await fixture.prisma.fiscalConnection.update({ where: { id: f.sale.connection.id }, data: { activatedAt: new Date("2099-01-01") } });
  await f.approve(); await f.paid(); await f.consume(); const intent = await f.intent(); assert.equal(intent.state, "not_eligible_before_activation");
  const proof = await fixture.prisma.fiscalEvent.findFirstOrThrow({ where: { intentId: intent.id, action: "stock_effect_suppressed", actorKind: "system" } });
  assert.equal(proof.safeReasonCode, (await f.coordinator.binding(f.scope, intent.id)).evidenceCode);
  const [job] = await f.jobs("sale"); assert.ok(job); await f.process(job.id);
  assert.equal(f.remote(), 9); assert.equal(await f.local(), 9); assert.equal(f.effectRequests(), 0); assert.equal(await f.movements(), 1);
});

test("FISCAL-26 D18 admission lock defers current sale job without consuming an attempt", async t => {
  const f = await stockWorld(t, fixture).arrange(); const legacy = await f.ordinarySale("admission_lock");
  const arrived = deferred(), release = deferred();
  const admission = f.other.$transaction(async tx => { await lockFiscalStock(tx, f.sale.merchantId, f.erp.id, ["sku_a"]); arrived.resolve(); await release.promise; });
  await arrived.promise;
  try { await f.process(legacy.job.id); const job = await fixture.prisma.erpSyncJob.findUniqueOrThrow({ where: { id: legacy.job.id } });
    assert.equal(job.status, "queued"); assert.equal(job.attempts, 0); assert.equal(job.lastErrorCode, "fiscal_stock_busy"); assert.equal(f.writes.length, 0);
  } finally { release.resolve(); await admission; }
  await f.process(legacy.job.id); assert.equal(f.remote(), 9); assert.equal(await f.local(), 9); assert.equal(await f.movements(), 1);
  assert.deepEqual(f.writes, [write("sale", 9)]);
});

test("FISCAL-26 D19 release serializes exact intent fence against concurrent version mutation", async t => {
  const f = await stockWorld(t, fixture).arrange(); await f.approve(); await f.paid();
  await assert.rejects(f.reconcile(), /fiscal_stock_local_effect_pending/); await f.consume();
  const intent = await f.intent(), binding = await f.coordinator.binding(f.scope, intent.id);
  const evidence = await fixture.prisma.fiscalEvent.findFirstOrThrow({ where: { intentId: intent.id, action: "stock_effect_reconciled", safeReasonCode: binding.evidenceCode } });
  const arrived = deferred(), resume = deferred();
  const db = f.other.$extends({ query: { fiscalIntent: { async findFirstOrThrow({ args, query }) {
    const row = await query(args); arrived.resolve(); await resume.promise; return row;
  } } } });
  const coordinator = new PrismaFiscalStockCoordinator(db as unknown as PrismaClient);
  const releasing = coordinator.release(f.scope, intent.id, evidence.id); await arrived.promise;
  const updater = await fixture.sql.connect(); const { rows: [{ pid }] } = await updater.query("SELECT pg_backend_pid() AS pid");
  assert.match(fixture.schema, /^fiscal_test_[a-f0-9]{32}$/);
  let updateDone = false;
  const updating = updater.query(`UPDATE "${fixture.schema}".fiscal_intents SET version = version + 1 WHERE id = $1 AND merchant_id = $2`, [intent.id, f.sale.merchantId]).then(() => { updateDone = true; });
  try {
    let waiting = false; const deadline = Date.now() + 2000;
    while (!waiting && !updateDone && Date.now() < deadline) {
      const row = (await fixture.sql.query("SELECT wait_event_type FROM pg_stat_activity WHERE pid = $1", [pid])).rows[0];
      waiting = row?.wait_event_type === "Lock";
    }
    assert.equal(waiting, true); assert.equal(updateDone, false);
  } finally { resume.resolve(); await releasing; await updating; updater.release(); }
  assert.equal((await f.intent()).version, binding.intentVersion + 1); assert.equal(f.effectRequests(), 1);
  const legacy = await f.ordinarySale("after_release"); await f.process(legacy.job.id);
  assert.equal(f.remote(), 8); assert.equal(await f.local(), 8); assert.equal(await f.movements(), 2);
});

for (const outcome of ["provider", "suppressed"] as const) test(`FISCAL-26 D20-${outcome} preexisting own-sale job survives until exact stock decision and remains deduplicated`, async t => {
  const f = await stockWorld(t, fixture).arrange(); await f.approve(); await f.paid(); const receipt = await f.consume();
  const job = await fixture.prisma.erpSyncJob.create({ data: { merchantId: f.sale.merchantId, connectionId: f.erp.id, kind: "sale", status: "queued",
    dedupeKey: `sale:${f.erp.id}:${receipt.id}`, payload: { receiptId: receipt.id } } });
  await f.process(job.id); const pending = await fixture.prisma.erpSyncJob.findUniqueOrThrow({ where: { id: job.id } });
  assert.equal(pending.status, "queued"); assert.equal(pending.attempts, 0); assert.equal(f.writes.length, 0);
  await fixture.prisma.$transaction(tx => admitFiscalStock(tx, f.sale.merchantId, f.erp.id, ["sku_a"]));
  const proof = outcome === "provider" ? await f.reconcile() : await f.suppress();
  await f.process(job.id); await f.process(job.id);
  assert.equal((await fixture.prisma.erpSyncJob.findUniqueOrThrow({ where: { id: job.id } })).status, "completed");
  assert.equal(f.remote(), 9); assert.equal(await f.local(), 9); assert.equal(f.effectRequests(), outcome === "provider" ? 1 : 0);
  assert.deepEqual(f.writes, [write(outcome === "provider" ? "fiscal" : "sale", outcome === "provider" ? 1 : 9)]);
  await f.coordinator.release(f.scope, (await f.intent()).id, proof.id);
  await f.enqueueReceipt(receipt.id); await f.enqueueReceipt(receipt.id); await f.process(job.id);
  assert.equal((await f.jobs()).length, 1); assert.equal((await f.jobs())[0].status, "completed");
  assert.equal(f.writes.length, 1); assert.equal(f.effectRequests(), outcome === "provider" ? 1 : 0); assert.equal(await f.movements(), 1);
  if (outcome === "suppressed") assert.equal(await fixture.prisma.outboxMessage.count({ where: { eventId: "fiscal.stock.suppressed:" + (await f.intent()).id } }), 1);
});

test("FISCAL-26 D21 current production characterization: catalog import creates no outbound ERP job or HTTP", async t => {
  const f = await stockWorld(t, fixture).arrange();
  await f.catalog(11); await f.catalog(12);
  assert.equal(await f.local(), 12); assert.equal(f.remote(), 10); assert.equal((await f.jobs()).length, 0);
  assert.equal(await fixture.prisma.erpSyncJob.count({ where: { merchantId: f.sale.merchantId } }), 0);
  assert.equal(await fixture.prisma.importJob.count({ where: { merchantId: f.sale.merchantId, status: "completed", successRows: 1, failedRows: 0 } }), 2);
  assert.equal(f.writes.length, 0); assert.equal(f.reads.length, 0); assert.equal(await f.movements(), 0);
});

test("FISCAL-26 D22 full snapshot applies another SKU while preserving the pending fiscal SKU", async t => {
  const f = await stockWorld(t, fixture).arrange({ direction: "erp_source_of_truth" }); await f.approve(); await f.paid(); await f.consume();
  await f.addSku(); f.restockRemote(21, "456"); const full = await f.full();
  assert.equal(full.kind, "full"); assert.equal(full.status, "completed");
  assert.equal(await f.local(), 9); assert.equal(f.remote(), 10); assert.equal(await f.local("sku_b"), 21); assert.equal(f.remote("456"), 21);
  assert.equal(await f.movements(), 1); assert.equal(f.writes.length, 0); assert.equal(f.effectRequests(), 0);
  assert.equal((await f.jobs("full")).length, 1); assert.equal((await f.jobs("sale")).length, 0);
});

test("FISCAL-26 D23 an older queued absolute sale must not restore a later sold unit after fiscal release", async t => {
  const f = await stockWorld(t, fixture).arrange(); await f.approve(); await f.paid(); await f.consume();
  const older = await f.ordinarySale("older"), newer = await f.ordinarySale("newer");
  await f.process(older.job.id); await f.process(newer.job.id); assert.equal(f.writes.length, 0); assert.equal(await f.local(), 7);
  await f.reconcile(); await f.process(newer.job.id); await f.process(older.job.id); await f.process(newer.job.id);
  assert.equal(await f.movements(), 3); assert.equal(f.effectRequests(), 1); assert.equal(await f.local(), 7);
  // This is the requirement. Current pushSale statically appears to send older.remainingQuantity=8.
  assert.equal(f.remote(), 7, "a delayed earlier absolute receipt must never restore the later sold unit");
});

test("FISCAL-26 D24 safe unknown write blocks replay and later SKU writes until verified terminal evidence", async t => {
  const f = await stockWorld(t, fixture).arrange();
  const older = await f.ordinarySale("uncertain_older"), timeout = f.timeoutNextWrite();
  const original = () => fixture.prisma.erpSyncJob.findUniqueOrThrow({ where: { id: older.job.id } });
  try {
    await f.process(older.job.id);
    const unknown = await original();
    assert.equal(unknown.status, "uncertain"); assert.equal(unknown.attempts, 1); assert.equal(unknown.nextAttemptAt, null);
    assert.equal(unknown.lockedUntil, null); assert.equal(unknown.completedAt, null);
    const frozen = (unknown.payload as any).stockExecution.writes[0]; assert.equal(frozen.phase, "uncertain");
    await f.process(older.job.id); assert.equal(f.writes.length, 1);
    const newer = await f.ordinarySale("after_uncertain"); await f.process(newer.job.id);
    let waiting = await fixture.prisma.erpSyncJob.findUniqueOrThrow({ where: { id: newer.job.id } });
    assert.equal(waiting.status, "queued"); assert.equal(waiting.attempts, 0); assert.equal(waiting.lastErrorCode, "erp_stock_write_pending");
    assert.equal(waiting.completedAt, null); assert.equal(await f.local(), 8); assert.equal(await f.movements(), 2);
    assert.equal(f.remote(), 10); assert.equal(f.writes.length, 1);
    await assert.rejects(f.other.$transaction(tx => admitFiscalStock(tx, f.sale.merchantId, f.erp.id, ["sku_a"])), /fiscal_stock_export_unsettled/);
    await assert.rejects(f.settle(older.job.id, older.applied.items[0]!.itemId, async () => ({ terminal: false } as never)), /erp_stock_terminal_evidence_required/);
    timeout.late.resolve(); await timeout.accepted;
    assert.equal(f.remote(), 9); assert.equal(await f.local(), 8); assert.equal((await original()).status, "uncertain"); assert.equal(f.writes.length, 1);
    const proof = async ({ write }: { write: Readonly<import("../../../shared/persistence/erp-stock-write-state.js").StockWrite> }) => {
      await timeout.accepted; assert.equal(f.remote(), 9);
      return { terminal: true as const, outcome: "applied" as const, fingerprint: write.fingerprint, credentialStamp: write.credentialStamp, evidenceRef: "synthetic-terminal:" + write.attemptNonce };
    };
    await f.settle(older.job.id, older.applied.items[0]!.itemId, proof);
    assert.equal((await original()).status, "completed"); assert.equal(f.writes.length, 1);
    await f.settle(older.job.id, older.applied.items[0]!.itemId, proof);
    assert.equal(await fixture.prisma.merchantAuditEvent.count({ where: { merchantId: f.sale.merchantId, action: "erp_stock_write_reconciled" } }), 1);
    await f.process(newer.job.id); await f.process(newer.job.id); await f.process(older.job.id);
    waiting = await fixture.prisma.erpSyncJob.findUniqueOrThrow({ where: { id: newer.job.id } }); assert.equal(waiting.status, "completed");
    assert.deepEqual(f.writes.map(row => row.quantity), [9, 8]); assert.equal(f.remote(), 8); assert.equal(await f.local(), 8);
    assert.equal(await f.movements(), 2); assert.equal(f.effectRequests(), 0);
  } finally { timeout.late.resolve(); await timeout.accepted; }
});

test("FISCAL-26 unknown SKU survives key rotation, reconnect and disconnect while other SKU and merchant remain functional", async t => {
  const world = stockWorld(t, fixture), f = await world.arrange();
  const older = await f.ordinarySale("unknown"), timeout = f.timeoutNextWrite();
  try {
    await f.process(older.job.id);
    const original = await fixture.prisma.erpSyncJob.findUniqueOrThrow({ where: { id: older.job.id } });
    const fingerprint = stockWrites(original)[0]!.fingerprint;
    const oldConnection = await fixture.prisma.erpConnection.findUniqueOrThrow({ where: { id: f.erp.id } });
    const freshCipher = encryptErpSecret("synthetic-stock-v2-" + f.sale.merchantId);
    await fixture.prisma.erpConnection.update({ where: { id: f.erp.id }, data: { accessTokenCipher: freshCipher, status: "connected", lastErrorCode: null } });
    await f.sync.enqueueFull(f.sale.merchantId, f.erp.id);
    await (f.sync as any).pauseForReauthorization(oldConnection, original, "erp_tiny_credentials_invalid", true);
    await (f.sync as any).pauseForCooldown(oldConnection, original, "erp_provider_cooldown", 30000);
    await assert.rejects(new PrismaErpRepository(fixture.prisma).delete(f.sale.merchantId, f.erp.id), /erp_stock_reconciliation_required/);
    const after = await fixture.prisma.erpSyncJob.findUniqueOrThrow({ where: { id: original.id } });
    assert.equal(after.status, "uncertain"); assert.equal(stockWrites(after)[0]!.fingerprint, fingerprint); assert.equal(f.writes.length, 1);
    assert.equal((await fixture.prisma.erpConnection.findUniqueOrThrow({ where: { id: f.erp.id } })).accessTokenCipher, freshCipher);
    const variantB = await f.addSku(), otherSku = await f.ordinarySale("other_sku", "sku_b", variantB); await f.process(otherSku.job.id);
    assert.equal(f.remote("456"), 19); assert.equal(await f.local("sku_b"), 19);
    t.mock.timers.enable({ apis: ["Date"], now: Date.now() + 31001 });
    await fixture.prisma.erpConnection.update({ where: { id: f.erp.id }, data: { directionMode: "erp_source_of_truth" } });
    f.restockRemote(21, "456"); const full = await f.full();
    assert.equal(full.status, "queued"); assert.equal(full.attempts, 0); assert.equal(await f.local(), 9); assert.equal(await f.local("sku_b"), 21);
    const independent = await world.arrange(), separate = await independent.ordinarySale("foreign"); await independent.process(separate.job.id);
    assert.equal(independent.remote(), 9); assert.equal(await independent.local(), 9);
    assert.equal((await fixture.prisma.erpSyncJob.findUniqueOrThrow({ where: { id: original.id } })).status, "uncertain");
    assert.deepEqual(f.writes.map(row => [row.productId, row.quantity]), [["123", 9], ["456", 19]]);
  } finally { timeout.late.resolve(); await timeout.accepted; }
});

test("FISCAL-26 dispatch marker survives outer rollback and worker death; stale acknowledgement cannot release it", async t => {
  const f = await stockWorld(t, fixture).arrange(), sale = await f.ordinarySale("crash");
  const startedAt = new Date();
  const running = await fixture.prisma.erpSyncJob.update({ where: { id: sale.job.id }, data: { status: "running", startedAt, lockedUntil: new Date(Date.now() + 10000) } });
  const claim = await beginStockClaim(fixture.prisma, running);
  const item = sale.applied.items[0]!; let dispatched!: Awaited<ReturnType<typeof dispatchStockWrite>>;
  await assert.rejects(f.other.$transaction(async tx => {
    await lockFiscalStock(tx, f.sale.merchantId, f.erp.id, ["sku_a"]);
    dispatched = await dispatchStockWrite(fixture.prisma, claim, f.erp, { itemId: item.itemId, sku: "sku_a", externalProductId: "123", externalLocationId: "0", quantity: 9, idempotencyKey: "original-key" });
    throw new Error("synthetic_worker_death");
  }), /synthetic_worker_death/);
  assert.equal(stockWrites(await fixture.prisma.erpSyncJob.findUniqueOrThrow({ where: { id: claim.id } }))[0]!.phase, "dispatching");
  await fixture.prisma.erpSyncJob.update({ where: { id: claim.id }, data: { lockedUntil: new Date(0) } });
  await (f.sync as any).requeueExpiredLeases(new Date());
  const unknown = await fixture.prisma.erpSyncJob.findUniqueOrThrow({ where: { id: claim.id } });
  assert.equal(unknown.status, "uncertain"); assert.equal(unknown.nextAttemptAt, null); assert.equal(stockWrites(unknown)[0]!.phase, "uncertain");
  await assert.rejects(finishStockWrite(fixture.prisma, claim, dispatched, true));
  await f.process(claim.id); assert.equal(f.writes.length, 0); assert.equal(await f.local(), 9);
  await assert.rejects(f.other.$transaction(tx => admitFiscalStock(tx, f.sale.merchantId, f.erp.id, ["sku_a"])), /fiscal_stock_export_unsettled/);
});

test("FISCAL-26 death before dispatch recovers safely while untracked old absolute writes remain uncertain", async t => {
  const f = await stockWorld(t, fixture).arrange(), safe = await f.ordinarySale("ready");
  const running = await fixture.prisma.erpSyncJob.update({ where: { id: safe.job.id }, data: { status: "running", startedAt: new Date(), lockedUntil: new Date(0) } });
  await beginStockClaim(fixture.prisma, running); await (f.sync as any).requeueExpiredLeases(new Date());
  assert.equal((await fixture.prisma.erpSyncJob.findUniqueOrThrow({ where: { id: safe.job.id } })).status, "queued");
  await f.process(safe.job.id); assert.equal(f.remote(), 9); assert.equal(f.writes.length, 1);
  const legacy = await f.ordinarySale("legacy_untracked");
  await fixture.prisma.erpSyncJob.update({ where: { id: legacy.job.id }, data: { status: "running", startedAt: new Date(), lockedUntil: new Date(0) } });
  await (f.sync as any).requeueExpiredLeases(new Date()); await f.process(legacy.job.id);
  assert.equal((await fixture.prisma.erpSyncJob.findUniqueOrThrow({ where: { id: legacy.job.id } })).status, "uncertain"); assert.equal(f.writes.length, 1);
  await fixture.prisma.erpSyncJob.update({ where: { id: legacy.job.id }, data: { status: "completed", attempts: 1, completedAt: new Date(0) } });
  await assert.rejects(f.other.$transaction(tx => admitFiscalStock(tx, f.sale.merchantId, f.erp.id, ["sku_a"])), /fiscal_stock_export_unsettled/);
  const omie = await fixture.prisma.erpConnection.create({ data: { merchantId: f.sale.merchantId, provider: "omie", status: "connected" } });
  const relative = await fixture.prisma.erpSyncJob.create({ data: { merchantId: f.sale.merchantId, connectionId: omie.id, kind: "sale", status: "running", startedAt: new Date(), lockedUntil: new Date(0), dedupeKey: "omie:" + safe.applied.receiptId, payload: { receiptId: safe.applied.receiptId } } });
  await (f.sync as any).requeueExpiredLeases(new Date());
  const resumed = await fixture.prisma.erpSyncJob.findUniqueOrThrow({ where: { id: relative.id } }); assert.equal(resumed.status, "queued");
  assert.deepEqual(resumed.payload, { receiptId: safe.applied.receiptId }); assert.equal(resumed.dedupeKey, relative.dedupeKey);
});

test("FISCAL-26 aggregate completed status and forged terminal result cannot erase an unknown marker", async t => {
  const f = await stockWorld(t, fixture).arrange(), sale = await f.ordinarySale("unknown"); const timeout = f.timeoutNextWrite();
  try {
    await f.process(sale.job.id);
    await assert.rejects((f.sync as any).reconcileUncertainStockWrite({ merchantId: f.sale.merchantId, connectionId: f.erp.id, jobId: sale.job.id, itemId: sale.applied.items[0]!.itemId }), /erp_stock_terminal_verification_unavailable/);
    await fixture.prisma.erpSyncJob.update({ where: { id: sale.job.id }, data: { status: "completed", completedAt: new Date() } });
    await assert.rejects(f.other.$transaction(tx => admitFiscalStock(tx, f.sale.merchantId, f.erp.id, ["sku_a"])), /fiscal_stock_export_unsettled/);
    await assert.rejects(f.settle(sale.job.id, sale.applied.items[0]!.itemId, async () => ({ terminal: true, outcome: "applied", fingerprint: "forged", credentialStamp: "foreign", evidenceRef: "balance-match" })), /erp_stock_terminal_evidence_required/);
    assert.equal(await fixture.prisma.merchantAuditEvent.count({ where: { merchantId: f.sale.merchantId, action: "erp_stock_write_reconciled" } }), 0);
    const newer = await f.ordinarySale("newer"); await f.process(newer.job.id);
    assert.equal((await fixture.prisma.erpSyncJob.findUniqueOrThrow({ where: { id: newer.job.id } })).status, "queued"); assert.equal(f.writes.length, 1);
  } finally { timeout.late.resolve(); await timeout.accepted; }
});

test("FISCAL-26 full read started before verified settlement cannot restore stock in ERP-source mode", async t => {
  const f = await stockWorld(t, fixture).arrange(), sale = await f.ordinarySale("unknown"); const timeout = f.timeoutNextWrite();
  try {
    await f.process(sale.job.id); await f.addSku(); f.restockRemote(21, "456");
    await fixture.prisma.erpConnection.update({ where: { id: f.erp.id }, data: { directionMode: "erp_source_of_truth" } });
    const gate = f.holdRead(), reading = f.full(); await gate.arrived.promise;
    try {
      timeout.late.resolve(); await timeout.accepted;
      await f.settle(sale.job.id, sale.applied.items[0]!.itemId, async ({ write }) => ({ terminal: true, outcome: "applied", fingerprint: write.fingerprint, credentialStamp: write.credentialStamp, evidenceRef: "synthetic-ended:" + write.attemptNonce }));
    } finally { gate.release.resolve(); }
    const stale = await reading; assert.equal(stale.status, "queued"); assert.equal(await f.local(), 9); assert.equal(await f.local("sku_b"), 21);
    const settled = stockWrites(await fixture.prisma.erpSyncJob.findUniqueOrThrow({ where: { id: sale.job.id } }))[0]!.settledAt!;
    t.mock.timers.enable({ apis: ["Date"], now: new Date(settled).getTime() + 31001 });
    assert.equal((await f.full()).status, "completed"); assert.equal(await f.local(), 9); assert.equal(f.remote(), 9); assert.equal(f.writes.length, 1);
  } finally { timeout.late.resolve(); await timeout.accepted; }
});

test("FISCAL-26 mixed-receipt death keeps unknown A fenced while undispatched B recovers without replaying A", async t => {
  const f = await stockWorld(t, fixture).arrange(), variantB = await f.addSku();
  const sale = await f.inventory.apply({ merchantId: f.sale.merchantId, orderId: f.sale.orderId + "_mixed", totalCents: 2000, timestamp: new Date().toISOString(),
    items: [{ sku: "sku_a", variantId: f.variantId, productType: "physical", quantity: 1 }, { sku: "sku_b", variantId: variantB, productType: "physical", quantity: 1 }] });
  await f.sync.enqueueSale(sale); const [job] = await f.jobs("sale"); assert.ok(job);
  const running = await fixture.prisma.erpSyncJob.update({ where: { id: job.id }, data: { status: "running", startedAt: new Date(), lockedUntil: new Date(0) } });
  const claim = await beginStockClaim(fixture.prisma, running);
  await dispatchStockWrite(fixture.prisma, claim, f.erp, { itemId: sale.items[0]!.itemId, sku: "sku_a", externalProductId: "123", externalLocationId: "0", quantity: 9, idempotencyKey: "before-death" });
  await (f.sync as any).requeueExpiredLeases(new Date());
  assert.equal((await fixture.prisma.erpSyncJob.findUniqueOrThrow({ where: { id: job.id } })).status, "queued");
  await f.process(job.id);
  const recovered = await fixture.prisma.erpSyncJob.findUniqueOrThrow({ where: { id: job.id } });
  assert.equal(recovered.status, "uncertain"); assert.equal(stockWrites(recovered).find(row => row.sku === "sku_a")!.phase, "uncertain");
  assert.equal(stockWrites(recovered).find(row => row.sku === "sku_b")!.phase, "acknowledged");
  assert.deepEqual(f.writes.map(row => [row.productId, row.quantity]), [["456", 19]]); assert.equal(f.remote(), 10);
  const later = await f.ordinarySale("later_b", "sku_b", variantB); await f.process(later.job.id);
  assert.equal(f.remote("456"), 18); assert.equal(await f.local("sku_a"), 9); assert.equal(await f.local("sku_b"), 18);
  assert.equal(stockWrites(await fixture.prisma.erpSyncJob.findUniqueOrThrow({ where: { id: job.id } })).find(row => row.sku === "sku_a")!.phase, "uncertain");
});

test("FISCAL-26 completed Omie retry history is not retrospectively fenced but an active unknown marker still is", async t => {
  const f = await stockWorld(t, fixture).arrange(), sale = await f.ordinarySale("historical");
  const omie = await fixture.prisma.erpConnection.create({ data: { merchantId: f.sale.merchantId, provider: "omie", status: "connected" } });
  await fixture.prisma.erpSyncJob.create({ data: { merchantId: f.sale.merchantId, connectionId: omie.id, kind: "sale", status: "completed", attempts: 1,
    startedAt: new Date(0), completedAt: new Date(1), dedupeKey: "omie-history:" + sale.applied.receiptId, payload: { receiptId: sale.applied.receiptId } } });
  assert.equal(await outboundStockFence(fixture.prisma, f.sale.merchantId, omie.id, "sku_a"), null);
  assert.equal(await unresolvedConnectionStock(fixture.prisma, f.sale.merchantId, omie.id), false);
  await fixture.prisma.$transaction(tx => admitFiscalStock(tx, f.sale.merchantId, omie.id, ["sku_a"]));
  const running = await fixture.prisma.erpSyncJob.create({ data: { merchantId: f.sale.merchantId, connectionId: omie.id, kind: "sale", status: "running",
    startedAt: new Date(), dedupeKey: "omie-active:" + sale.applied.receiptId, payload: { receiptId: sale.applied.receiptId } } });
  const claim = await beginStockClaim(fixture.prisma, running);
  const write = await dispatchStockWrite(fixture.prisma, claim, omie, { sku: "sku_a", itemId: sale.applied.items[0]!.itemId, externalProductId: "123", externalLocationId: "0", quantity: 1, idempotencyKey: "stable-relative-key" });
  await finishStockWrite(fixture.prisma, claim, write, false);
  await fixture.prisma.erpSyncJob.update({ where: { id: claim.id }, data: { status: "completed" } });
  assert.equal(await outboundStockFence(fixture.prisma, f.sale.merchantId, omie.id, "sku_a"), "erp_stock_write_pending");
  assert.equal(await unresolvedConnectionStock(fixture.prisma, f.sale.merchantId, omie.id), true);
  await assert.rejects(fixture.prisma.$transaction(tx => admitFiscalStock(tx, f.sale.merchantId, omie.id, ["sku_a"])), /fiscal_stock_export_unsettled/);
});
