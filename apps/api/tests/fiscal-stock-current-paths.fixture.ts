import assert from "node:assert/strict";
import { env as runtimeEnv } from "node:process";
import { PrismaClient } from "@prisma/client";
import type { TestContext } from "node:test";
import { createFiscalFixture } from "./fiscal-fixture.js";
import { seedFiscalSale } from "./fiscal-schema-seed.js";
import { PrismaProductRepository } from "../src/modules/catalog/infrastructure/repositories/prisma-product.repository.js";
import { PrismaImportJobRepository } from "../src/modules/catalog/infrastructure/repositories/prisma-import-job.repository.js";
import { ProcessSpreadsheetImportUseCase } from "../src/modules/catalog/application/use-cases/process-spreadsheet-import.use-case.js";
import { AddProductUseCase } from "../src/modules/catalog/application/use-cases/add-product.use-case.js";
import { CsvXlsxParserAdapter } from "../src/modules/catalog/infrastructure/csv-xlsx-parser.adapter.js";
import { DeterministicColumnMapper } from "../src/modules/catalog/infrastructure/adapters/deterministic-column-mapper.adapter.js";
import { PrismaInventorySaleRepository } from "../src/modules/inventory/infrastructure/repositories/prisma-inventory-sale.repository.js";
import { InventoryOnOrderCompletedHandler } from "../src/modules/inventory/infrastructure/event-handlers/on-order-completed.handler.js";
import { ErpSyncService } from "../src/modules/inventory/application/services/erp-sync.service.js";
import { encryptErpSecret } from "../src/modules/inventory/infrastructure/adapters/erp-secret-cipher.js";
import { PrismaCheckoutRepository } from "../src/modules/checkout/infrastructure/prisma/prisma-checkout.repository.js";
import { CompleteOrderUseCase } from "../src/modules/checkout/application/use-cases/complete-order.use-case.js";
import { PrismaPaymentApprovalReader } from "../src/modules/checkout/infrastructure/adapters/prisma-payment-approval.reader.js";
import { checkoutSession } from "../src/modules/checkout/__tests__/checkout-test-fixtures.js";
import { TenantContextService } from "../src/shared/tenant/tenant-context.service.js";
import { PrismaFiscalOrderParticipant } from "../src/modules/fiscal/infrastructure/prisma-fiscal-order.participant.js";
import { PrismaFiscalStockCoordinator } from "../src/shared/persistence/fiscal-stock-coordination.js";
import type { SaleCompletedEvent } from "../src/modules/inventory/domain/events/sale-completed.event.js";

export { createFiscalFixture };
export type Fixture = Awaited<ReturnType<typeof createFiscalFixture>>;
export const LOCAL_DATABASE = "postgresql://fiscal:fiscal_local_only_20261114@127.0.0.1:25432/zyon_fiscal";
export function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(yes => { resolve = yes; });
  return { promise, resolve };
}
type Gate = { arrived: ReturnType<typeof deferred>; release: ReturnType<typeof deferred> };
type Write = { kind: "sale" | "fiscal"; productId: string; quantity: number };
type RemoteProduct = { sku: string; quantity: number };
type Remote = {
  orderId: string; token: string; products: Map<string, RemoteProduct>; writes: Write[];
  reads: string[]; effectRequests: number; writeGate?: Gate; readGate?: Gate;
  timeout?: { late: ReturnType<typeof deferred>; accepted?: Promise<void> };
};
const support = { find: () => ({ operations: ["sale"], currencies: ["BRL"], issuerRegimes: ["simples_nacional"], productTypes: ["physical"] }) };

/** Per-test transport router: every fetch is captured; no fallback to real IO. */
export function stockWorld(t: TestContext, fixture: Fixture) {
  const remotes = new Map<string, Remote>();
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const ok = (body: unknown) => Response.json({ retorno: { status: "OK", ...(body as object) } }, { headers: { "x-limit-api": "10000" } });
    if (url.origin === "https://fiscal-provider.example.test" && url.pathname === "/effect") {
      const body = JSON.parse(String(init?.body)) as { orderId: string; sku: string };
      const remote = [...remotes.values()].find(row => row.orderId === body.orderId);
      assert.ok(remote, "unknown synthetic fiscal order");
      assert.equal(new Headers(init?.headers).get("authorization"), "Bearer scoped-synthetic-fiscal");
      assert.equal(body.sku, "sku_a");
      const product = remote.products.get("123")!;
      remote.effectRequests++;
      product.quantity--;
      remote.writes.push({ kind: "fiscal", productId: "123", quantity: 1 });
      return Response.json({ orderId: body.orderId, sku: body.sku, quantity: 1, evidence: "movement:" + body.orderId });
    }
    assert.equal(url.origin, "https://api.tiny.com.br", "unexpected transport target");
    assert.equal(init?.method, "POST");
    assert.equal(new Headers(init?.headers).get("content-type"), "application/x-www-form-urlencoded");
    const form = new URLSearchParams(String(init?.body));
    assert.equal(form.get("formato"), "JSON");
    const remote = remotes.get(form.get("token") ?? "");
    assert.ok(remote, "ERP credential must belong to this synthetic merchant");
    if (url.pathname === "/api2/produto.atualizar.estoque.php") {
      const { estoque } = JSON.parse(form.get("estoque")!) as { estoque: { idProduto: number; tipo: string; quantidade: string; observacoes: string } };
      assert.equal(estoque.tipo, "B");
      assert.match(estoque.observacoes, /^Zyon [a-f0-9]{48}$/);
      const productId = String(estoque.idProduto);
      assert.ok(remote.products.has(productId));
      const quantity = Number(estoque.quantidade);
      assert.ok(Number.isSafeInteger(quantity));
      remote.writes.push({ kind: "sale", productId, quantity });
      if (remote.writeGate) { remote.writeGate.arrived.resolve(); await remote.writeGate.release.promise; }
      const apply = () => { remote.products.get(productId)!.quantity = quantity; };
      if (remote.timeout) {
        const timeout = remote.timeout;
        remote.timeout = undefined;
        timeout.accepted = timeout.late.promise.then(apply);
        throw new Error("synthetic_timeout_after_acceptance");
      }
      apply();
      return ok({});
    }
    remote.reads.push(url.pathname);
    if (url.pathname === "/api2/pdv.produtos.php") {
      assert.equal(form.get("pagina"), "1");
      return ok({ numero_paginas: 1, produtos: [...remote.products].map(([id, product]) => ({ produto: { id, codigo: product.sku, nome: product.sku } })) });
    }
    const id = form.get("id")!;
    const product = remote.products.get(id);
    assert.ok(product, "unknown synthetic ERP product");
    if (url.pathname === "/api2/produto.obter.php") return ok({ produto: { id, codigo: product.sku, nome: product.sku, tipo: "P", preco: "10.00" } });
    assert.equal(url.pathname, "/api2/produto.obter.estoque.php");
    const quantity = product.quantity; // freeze what the provider read before a held response
    if (remote.readGate) { remote.readGate.arrived.resolve(); await remote.readGate.release.promise; }
    return ok({ produto: { id, saldo: quantity } });
  });

  return { arrange: async (options: { owner?: "provider" | "zyon"; direction?: "bidirectional" | "erp_source_of_truth" | "zyon_source_of_truth" } = {}) => {
    const sale = await seedFiscalSale(fixture, { provider: "tiny" });
    await fixture.prisma.fiscalIntent.delete({ where: { id: sale.intent.id } });
    await fixture.prisma.fiscalSaleSnapshot.delete({ where: { id: sale.snapshot.id } });
    await fixture.prisma.completedOrder.delete({ where: { id: sale.completedOrder.id } });
    const catalog = new PrismaProductRepository(fixture.prisma);
    const createProduct = (sku: string, quantity: number) => catalog.create({ merchantId: sale.merchantId, name: sku, variants: [{ sku, attributes: {}, basePriceInCents: 1000, weightGrams: 100, stockQuantity: quantity }] });
    const product = await createProduct("sku_a", 10);
    const variantId = product.variants[0]!.id;
    const importJobs = new PrismaImportJobRepository(fixture.prisma);
    // These rows always target an existing SKU. A background SEO path must never
    // execute in this stock characterization; this boundary cannot issue HTTP.
    const addProduct = new AddProductUseCase(catalog, { execute: async () => { throw new Error("unexpected_background_seo"); } } as never);
    const importer = new ProcessSpreadsheetImportUseCase(importJobs, new CsvXlsxParserAdapter(), new DeterministicColumnMapper(), addProduct, catalog);
    const importExistingStock = async (quantity: number) => {
      const job = await importJobs.create({ merchantId: sale.merchantId, fileName: "synthetic-stock.csv" });
      await importer.execute({ jobId: job.id, merchantId: sale.merchantId, mimeType: "text/csv",
        buffer: Buffer.from(`name,sku,price,stock,weight g\nsku_a,sku_a,10.00,${quantity},100\n`) });
      const result = await importJobs.getById(job.id, sale.merchantId); assert.ok(result);
      assert.equal(result.status, "completed"); assert.equal(result.successRows, 1); assert.equal(result.failedRows, 0);
      return result;
    };
    const token = "synthetic-stock-v2-" + sale.merchantId;
    const remote: Remote = { orderId: sale.orderId, token, products: new Map([["123", { sku: "sku_a", quantity: 10 }]]), writes: [], reads: [], effectRequests: 0 };
    remotes.set(token, remote);
    const erp = await fixture.prisma.erpConnection.create({ data: { merchantId: sale.merchantId, provider: "tiny", status: "connected", directionMode: options.direction ?? "bidirectional", accessTokenCipher: encryptErpSecret(token) } });
    await fixture.prisma.erpProductMapping.create({ data: { merchantId: sale.merchantId, connectionId: erp.id, sku: "sku_a", variantId, externalProductId: "123", externalLocationId: "0" } });
    await fixture.prisma.fiscalConnection.update({ where: { id: sale.connection.id }, data: { erpConnectionId: erp.id, isActive: true, activatedAt: new Date("2026-01-01"), stockOwner: options.owner ?? "provider" } });
    await fixture.prisma.fiscalProfileVersion.update({ where: { id: sale.profile.id }, data: { itemRules: { currency: "BRL", supportedProductTypes: ["physical"], items: { sku_a: { productType: "physical", ncm: "61091000", cfop: "5102", origin: "0", unit: "UN", taxes: { csosn: "102" } } } } } });
    const tenants = new TenantContextService();
    const repo = new PrismaCheckoutRepository(fixture.prisma, false, undefined, undefined,
      tx => new PrismaFiscalOrderParticipant(tx, "homologation", tenants, support), tenants);
    const session = checkoutSession({ merchantId: sale.merchantId, sessionId: sale.completedOrder.sessionId,
      customer: { fullName: "Comprador", cpf: "52998224725", fiscalRecipient: { name: "Comprador", taxId: "52998224725" } },
      cart: { currency: "BRL", total: 10, items: [{ sku: "sku_a", variantId, price: 10, quantity: 1, productType: "physical" }] }, shipping: { customerPrice: 0 } });
    await repo.saveSession(session);
    const complete = new CompleteOrderUseCase(
      repo, repo, repo, // 1-3: sessions/orders/outbox
      undefined, undefined, undefined, undefined, repo, // 4-8: offers/history/buyers/metrics/transaction
      undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, // 9-16
      new PrismaPaymentApprovalReader(fixture.prisma), // 17: persisted approval
      undefined, undefined, undefined, fixture.prisma, // 18-21: quota/cashback/fiscal/prisma
    );
    const request = { merchant_id: sale.merchantId, session_id: session.sessionId, external_order_id: sale.orderId, order_total: 10, currency: "BRL" as const };
    const approve = () => fixture.prisma.paymentIntent.create({ data: { id: sale.orderId + "_payment", merchantId: sale.merchantId, sessionId: session.sessionId, idempotencyKey: "approved", amountCents: 1000, currency: "BRL", method: "pix", status: "approved", providerPaymentId: sale.orderId, approvedAmountCents: 1000 } });
    const paid = () => complete.executePaymentApproval(request, sale.orderId + "_payment");
    const coordinator = new PrismaFiscalStockCoordinator(fixture.prisma);
    const inventory = new PrismaInventorySaleRepository(fixture.prisma);
    const other = new PrismaClient({ datasources: { db: { url: fixture.databaseUrl } } });
    t.after(() => other.$disconnect());
    const sync = new ErpSyncService(other);
    if (runtimeEnv.STOCK_DIAGNOSTIC === "1") t.after(async () => {
      const [items, movements, receipts, jobs, intents, stockEvents] = await Promise.all([
        fixture.prisma.inventoryItem.findMany({ where: { merchantId: sale.merchantId }, select: { sku: true, quantity: true } }),
        fixture.prisma.inventoryMovement.count({ where: { merchantId: sale.merchantId, reason: "sale_completed" } }),
        fixture.prisma.inventorySaleReceipt.findMany({ where: { merchantId: sale.merchantId }, select: { orderId: true, result: true } }),
        fixture.prisma.erpSyncJob.findMany({ where: { merchantId: sale.merchantId }, select: { kind: true, status: true, attempts: true, lastErrorCode: true, startedAt: true, completedAt: true, payload: true } }),
        fixture.prisma.fiscalIntent.findMany({ where: { merchantId: sale.merchantId }, select: { state: true, version: true } }),
        fixture.prisma.fiscalEvent.findMany({ where: { merchantId: sale.merchantId, action: { in: ["stock_effect_reconciled", "stock_barrier_released"] } }, select: { actorKind: true, action: true, safeReasonCode: true } }),
      ]);
      t.diagnostic("STOCK_STATE " + JSON.stringify({ fixtureSchema: fixture.schema, items, saleCompletedMovements: movements, receipts, jobs, intents, stockEvents,
        remote: [...remote.products].map(([id, product]) => ({ id, ...product })), writes: remote.writes, reads: remote.reads, fiscalEffectRequests: remote.effectRequests }));
    });
    // Suppress only automatic scheduling. All enqueues, DB claims and process paths remain real.
    t.mock.method(sync as unknown as { kick(): void }, "kick", () => {});
    const scope = { merchantId: sale.merchantId, environment: "homologation" as const };
    const intent = () => fixture.prisma.fiscalIntent.findFirstOrThrow({ where: { merchantId: sale.merchantId, orderId: sale.orderId } });
    const snapshot = () => fixture.prisma.fiscalSaleSnapshot.findFirstOrThrow({ where: { merchantId: sale.merchantId, orderId: sale.orderId } });
    const event = () => fixture.prisma.outboxMessage.findFirstOrThrow({ where: { merchantId: sale.merchantId, eventType: "order.completed" } });
    const enqueueReceipt = async (receiptId: string) => {
      const applied = await inventory.findReceipt(sale.merchantId, receiptId); assert.ok(applied);
      await sync.enqueueSale(applied);
      return applied;
    };
    const consume = async () => {
      const handler = new InventoryOnOrderCompletedHandler({} as never, { execute: (input: SaleCompletedEvent) => inventory.apply(input) } as never, repo);
      const original = await event(); await handler.handle({ ...original, payload: original.payload } as never);
      const receipt = await fixture.prisma.inventorySaleReceipt.findFirstOrThrow({ where: { merchantId: sale.merchantId, orderId: sale.orderId } });
      // Production delivery boundary: durable receipt -> real ERP enqueue, without running CRM/marketplace.
      await enqueueReceipt(receipt.id);
      return receipt;
    };
    const ordinarySale = async (suffix: string, sku = "sku_a", targetVariantId = variantId) => {
      const applied = await inventory.apply({ merchantId: sale.merchantId, orderId: sale.orderId + "_" + suffix,
        items: [{ sku, variantId: targetVariantId, productType: "physical", quantity: 1 }], totalCents: 1000, timestamp: new Date().toISOString() });
      await sync.enqueueSale(applied);
      const job = await fixture.prisma.erpSyncJob.findUniqueOrThrow({ where: { dedupeKey: `sale:${erp.id}:${applied.receiptId}` } });
      return { applied, job };
    };
    const jobs = (kind?: "sale" | "full") => fixture.prisma.erpSyncJob.findMany({ where: { merchantId: sale.merchantId, connectionId: erp.id, ...(kind ? { kind } : {}) }, orderBy: { createdAt: "asc" } });
    const process = (id: string) => (sync as unknown as { process(id: string): Promise<void> }).process(id);
    const settle = async (jobId: string, itemId: string, verify: import("../src/shared/persistence/erp-stock-write-state.js").ErpStockTerminalReader["verify"]) => {
      const service = new ErpSyncService(other, { verify });
      await (service as unknown as { reconcileUncertainStockWrite(scope: { merchantId: string; connectionId: string; jobId: string; itemId: string }): Promise<void> })
        .reconcileUncertainStockWrite({ merchantId: sale.merchantId, connectionId: erp.id, jobId, itemId });
    };
    const full = async () => { const job = await sync.enqueueWebhookFull(sale.merchantId, erp.id, "draft-" + (await jobs("full")).length); await process(job.id); return fixture.prisma.erpSyncJob.findUniqueOrThrow({ where: { id: job.id } }); };
    const reconcile = async () => {
      const current = await intent();
      const binding = await coordinator.binding(scope, current.id);
      const existing = await fixture.prisma.fiscalEvent.findFirst({ where: { ...scope, intentId: current.id, actorKind: "provider", action: "stock_effect_reconciled", safeReasonCode: binding.evidenceCode } });
      if (existing && current.state === "authorized") { await coordinator.release(scope, current.id, existing.id); return existing; }
      const response = await coordinator.withEffect(scope, current.id, () => fetch("https://fiscal-provider.example.test/effect", { method: "POST", headers: { authorization: "Bearer scoped-synthetic-fiscal", "content-type": "application/json" }, body: JSON.stringify({ orderId: sale.orderId, sku: "sku_a" }) }));
      const proof = await response.json(); assert.deepEqual({ orderId: proof.orderId, sku: proof.sku, quantity: proof.quantity }, { orderId: sale.orderId, sku: "sku_a", quantity: 1 });
      await fixture.prisma.fiscalIntent.update({ where: { id: current.id }, data: { state: "authorized", version: { increment: 1 } } });
      const admitted = await coordinator.binding(scope, current.id);
      const evidence = await fixture.prisma.fiscalEvent.create({ data: { ...scope, intentId: current.id, actorKind: "provider", action: "stock_effect_reconciled", safeReasonCode: admitted.evidenceCode, providerEvidenceRef: proof.evidence } });
      await coordinator.release(scope, current.id, evidence.id);
      return evidence;
    };
    const suppress = async () => {
      const current = await intent();
      await fixture.prisma.fiscalIntent.update({ where: { id: current.id }, data: { state: "suppressed", version: { increment: 1 } } });
      const binding = await coordinator.binding(scope, current.id);
      const evidence = await fixture.prisma.fiscalEvent.create({ data: { ...scope, intentId: current.id, actorKind: "system", action: "stock_effect_suppressed", safeReasonCode: binding.evidenceCode, providerEvidenceRef: "pre-write-suppression:" + current.id } });
      await coordinator.release(scope, current.id, evidence.id);
      return evidence;
    };
    return { sale, erp, variantId, repo, session, complete, request, scope, approve, paid, coordinator, inventory, sync, other, intent, snapshot, event, consume, ordinarySale, enqueueReceipt, jobs, process, full, reconcile, suppress, settle,
      local: async (sku = "sku_a") => (await fixture.prisma.inventoryItem.findFirstOrThrow({ where: { merchantId: sale.merchantId, sku } })).quantity,
      movements: () => fixture.prisma.inventoryMovement.count({ where: { merchantId: sale.merchantId, reason: "sale_completed" } }),
      remote: (productId = "123") => remote.products.get(productId)!.quantity,
      restockRemote: (quantity: number, productId = "123") => { remote.products.get(productId)!.quantity = quantity; },
      writes: remote.writes, reads: remote.reads, effectRequests: () => remote.effectRequests,
      catalog: importExistingStock,
      addSku: async () => { const product = await createProduct("sku_b", 20); const id = product.variants[0]!.id;
        await fixture.prisma.erpProductMapping.create({ data: { merchantId: sale.merchantId, connectionId: erp.id, sku: "sku_b", variantId: id, externalProductId: "456", externalLocationId: "0" } });
        remote.products.set("456", { sku: "sku_b", quantity: 20 }); return id; },
      hold: () => { const gate = { arrived: deferred(), release: deferred() }; remote.writeGate = gate; return gate; },
      holdRead: () => { const gate = { arrived: deferred(), release: deferred() }; remote.readGate = gate; return gate; },
      timeoutNextWrite: () => { const timeout = { late: deferred(), accepted: undefined as Promise<void> | undefined }; remote.timeout = timeout; return timeout; },
      releaseTime: async () => (await fixture.prisma.fiscalEvent.findFirstOrThrow({ where: { merchantId: sale.merchantId, intentId: (await intent()).id, action: "stock_barrier_released" } })).occurredAt.getTime(),
    };
  } };
}
