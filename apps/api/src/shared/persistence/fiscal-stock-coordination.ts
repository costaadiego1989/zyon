import { createHash } from "node:crypto";
import type { FiscalEvent, FiscalIntent, FiscalSaleSnapshot, Prisma, PrismaClient } from "@prisma/client";
import { readFiscalSnapshotEnvelope } from "../../modules/fiscal/domain/fiscal-sale-snapshot.port.js";
import type { FiscalStockBinding, FiscalStockPort } from "../../modules/fiscal/domain/fiscal-stock.port.js";
import type { FiscalTenant } from "../../modules/fiscal/domain/fiscal-repository.port.js";
import { safelyObserveFiscal, type FiscalObservationPort } from "../../modules/fiscal/domain/fiscal-observation.port.js";
import { outboundStockFence } from "./erp-stock-write-state.js";

type Client = Prisma.TransactionClient;
const RELEASE = "stock_barrier_released";
const NO_WRITE_STATES = new Set(["suppressed", "not_eligible_before_activation"]);
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const skusOf = (items: ReturnType<typeof readFiscalSnapshotEnvelope>) => [...new Set(items.commercialLines.filter(line => !["digital", "service"].includes(line.productType)).map(line => line.sku))].sort();

function makeBinding(scope: FiscalTenant, intent: { id: string; connectionId: string; version: number }, snapshot: FiscalSaleSnapshot): FiscalStockBinding {
  const envelope = readFiscalSnapshotEnvelope(snapshot.items);
  if (envelope.connectionId !== intent.connectionId) throw new Error("fiscal_stock_scope_invalid");
  const erpConnectionId = envelope.erpConnectionId ?? null;
  const quantities = new Map<string, number>();
  for (const line of envelope.commercialLines.filter(line => !["digital", "service"].includes(line.productType))) quantities.set(line.sku, (quantities.get(line.sku) ?? 0) + line.quantity);
  const lines = [...quantities].sort(([a], [b]) => a.localeCompare(b)).map(([sku, quantity]) => ({ sku, quantity }));
  const bindingCode = hash([scope.merchantId, scope.environment, intent.id, snapshot.id, snapshot.contentHash, envelope.connectionId, erpConnectionId, envelope.policy.stockOwner, lines]);
  return { ...scope, intentId: intent.id, snapshotId: snapshot.id, connectionId: envelope.connectionId, erpConnectionId, orderId: snapshot.orderId,
    contentHash: snapshot.contentHash, stockOwner: envelope.policy.stockOwner, intentVersion: intent.version, lines, bindingCode, evidenceCode: hash([bindingCode, intent.version]) };
}

export async function loadFiscalStockBinding(client: Client, scope: FiscalTenant, intentId: string): Promise<FiscalStockBinding> {
  const intent = await client.fiscalIntent.findFirst({ where: { ...scope, id: intentId }, include: { snapshot: true } });
  if (!intent) throw new Error("fiscal_stock_scope_invalid");
  return makeBinding(scope, intent, intent.snapshot);
}

/** Try-lock avoids merchant-row/advisory-lock inversion with an export doing its final balance read. */
export async function lockFiscalStock(tx: Client, merchantId: string, erpConnectionId: string, skus: readonly string[]): Promise<void> {
  for (const sku of [...new Set(skus)].sort()) {
    const key = JSON.stringify([merchantId, erpConnectionId, sku]);
    const rows = await tx.$queryRaw<Array<{ locked: boolean }>>`SELECT pg_try_advisory_xact_lock(hashtext('zyon_fiscal_stock'), hashtext(${key})) AS locked`;
    if (!rows[0]?.locked) throw new Error("fiscal_stock_busy");
  }
}

/** Durable legacy uncertainty survives the advisory lock's release on timeout/crash. */
export async function admitFiscalStock(tx: Client, merchantId: string, erpConnectionId: string, skus: readonly string[]): Promise<void> {
  await lockFiscalStock(tx, merchantId, erpConnectionId, skus);
  for (const sku of skus) if (await outboundStockFence(tx, merchantId, erpConnectionId, sku)) throw new Error("fiscal_stock_export_unsettled");
  const unsettled = await tx.erpSyncJob.findMany({ where: { merchantId, connectionId: erpConnectionId,
    kind: { in: ["sale", "catalog_stock"] }, OR: [{ status: { in: ["running", "unknown", "uncertain"] } },
      { status: { notIn: ["completed", "superseded"] }, startedAt: { not: null } }] }, select: { kind: true, payload: true, status: true, lastErrorCode: true } });
  for (const job of unsettled) {
    if (job.status === "queued" && ["erp_fiscal_stock_pending", "fiscal_stock_busy", "erp_outbound_waiting"].includes(job.lastErrorCode ?? "")) continue;
    const payload = job.payload as { sku?: string; receiptId?: string } | null;
    if (job.kind === "catalog_stock" && (!payload?.sku || skus.includes(payload.sku))) throw new Error("fiscal_stock_export_unsettled");
    if (job.kind === "sale") {
      const receipt = payload?.receiptId ? await tx.inventorySaleReceipt.findFirst({ where: { id: payload.receiptId, merchantId } }) : null;
      const items = (receipt?.result as { items?: { sku: string }[] } | null)?.items;
      if (!items || items.some(item => skus.includes(item.sku))) throw new Error("fiscal_stock_export_unsettled");
    }
  }
}

async function providerSnapshots(client: Client, merchantId: string, erpConnectionId: string, orderId?: string, sku?: string) {
  // Prisma batches the relation reads. History does not cause a separate intent/event
  // roundtrip per snapshot, and unrelated SKUs/owners are filtered in PostgreSQL.
  return client.fiscalSaleSnapshot.findMany({ where: { merchantId, ...(orderId ? { orderId } : {}), AND: [
    { items: { path: ["erpConnectionId"], equals: erpConnectionId } }, { items: { path: ["policy", "stockOwner"], equals: "provider" } },
    ...(sku ? [{ items: { path: ["commercialLines"], array_contains: [{ sku }] } }] : []),
  ] }, include: { intents: { where: { operation: "sale" }, include: { events: { where: {
    action: { in: [RELEASE, "stock_effect_suppressed", "stock_effect_reconciled"] },
  } } } } } });
}

function hasSuppressionProof(intent: FiscalIntent & { events: FiscalEvent[] }, snapshot: FiscalSaleSnapshot): boolean {
  if (!NO_WRITE_STATES.has(intent.state) || intent.writeStartedAt) return false;
  const scope = { merchantId: snapshot.merchantId, environment: snapshot.environment };
  return intent.events.some(event => event.actorKind === "system" && event.action === "stock_effect_suppressed" &&
    event.safeReasonCode === makeBinding(scope, intent, snapshot).evidenceCode && !!event.providerEvidenceRef);
}

/** Original owner applies to this sale only; pre-write suppression cannot later issue. */
export async function providerOwnedSaleSkus(client: Client, merchantId: string, erpConnectionId: string, orderId: string): Promise<Set<string>> {
  const result = new Set<string>();
  for (const row of await providerSnapshots(client, merchantId, erpConnectionId, orderId)) {
    const intent = row.intents[0];
    if (intent && hasSuppressionProof(intent, row)) continue;
    for (const sku of skusOf(readFiscalSnapshotEnvelope(row.items))) result.add(sku);
  }
  return result;
}

export async function fiscalStockBarrier(client: Client, merchantId: string, erpConnectionId: string, sku: string, readStartedAt?: Date): Promise<string | null> {
  for (const row of await providerSnapshots(client, merchantId, erpConnectionId, undefined, sku)) {
    if (!skusOf(readFiscalSnapshotEnvelope(row.items)).includes(sku)) continue;
    const intent = row.intents[0];
    if (intent && hasSuppressionProof(intent, row)) continue;
    const binding = intent ? makeBinding({ merchantId, environment: row.environment }, intent, row) : null;
    const released = intent?.events.find(event => event.id === "stock_release_" + hash([row.id]) && event.actorKind === "system" && event.action === RELEASE);
    if (!intent || !released) return "erp_fiscal_stock_pending";
    const proofCode = /^stock-v1:([a-f0-9]{64}):(\d+)$/.exec(released.safeReasonCode ?? "");
    const evidence = intent.events.find(event => event.id === released.providerEvidenceRef);
    if (!binding || proofCode?.[1] !== binding.bindingCode || evidence?.safeReasonCode !== hash([binding.bindingCode, Number(proofCode[2])]) || !evidence.providerEvidenceRef ||
      !(evidence.actorKind === "provider" && evidence.action === "stock_effect_reconciled" || evidence.actorKind === "system" && evidence.action === "stock_effect_suppressed")) return "erp_fiscal_stock_pending";
    if (readStartedAt && readStartedAt.getTime() <= released.occurredAt.getTime() + 30_000) return "erp_fiscal_stock_watermark";
  }
  return null;
}

/** Shared by the fiscal worker and all legacy stock paths. No current-connection fallback. */
export class PrismaFiscalStockCoordinator implements FiscalStockPort {
  constructor(private readonly prisma: PrismaClient, private readonly observations?: FiscalObservationPort) {}
  async binding(scope: FiscalTenant, intentId: string): Promise<FiscalStockBinding> { return loadFiscalStockBinding(this.prisma, scope, intentId); }
  async withEffect<T>(scope: FiscalTenant, intentId: string, work: () => Promise<T>): Promise<T> {
    const binding = await this.binding(scope, intentId);
    await this.prisma.$transaction(async tx => {
      if (binding.erpConnectionId) await lockFiscalStock(tx, scope.merchantId, binding.erpConnectionId, binding.lines.map(line => line.sku));
      const current = await loadFiscalStockBinding(tx, scope, intentId);
      if (current.evidenceCode !== binding.evidenceCode) throw new Error("fiscal_stock_claim_changed");
    });
    // This is coordination, not a write permit. T24 must durably begin its exact
    // stage under the current lease/version before IO; cancellation invalidates that fence.
    return work();
  }
  async release(scope: FiscalTenant, intentId: string, evidenceEventId: string): Promise<void> {
    const released = await this.prisma.$transaction(async tx => {
      const binding = await loadFiscalStockBinding(tx, scope, intentId);
      if (binding.erpConnectionId) await lockFiscalStock(tx, scope.merchantId, binding.erpConnectionId, binding.lines.map(line => line.sku));
      await tx.$queryRaw`SELECT id FROM fiscal_intents WHERE id = ${intentId} AND merchant_id = ${scope.merchantId}
        AND environment::text = ${scope.environment} FOR UPDATE`;
      const intent = await tx.fiscalIntent.findFirstOrThrow({ where: { ...scope, id: intentId }, include: { connection: { select: { provider: true } } } });
      if (intent.version !== binding.intentVersion) throw new Error("fiscal_stock_evidence_required");
      const evidence = await tx.fiscalEvent.findFirst({ where: { ...scope, id: evidenceEventId, intentId } });
      const remote = intent.state === "authorized" && evidence?.actorKind === "provider" && evidence.action === "stock_effect_reconciled";
      const suppressed = NO_WRITE_STATES.has(intent.state) && !intent.writeStartedAt && evidence?.actorKind === "system" && evidence.action === "stock_effect_suppressed";
      if ((!remote && !suppressed) || !evidence?.providerEvidenceRef || evidence.safeReasonCode !== binding.evidenceCode) throw new Error("fiscal_stock_evidence_required");
      const receipt = await tx.inventorySaleReceipt.findFirst({ where: { merchantId: scope.merchantId, orderId: binding.orderId } });
      const items = (receipt?.result as { items?: { sku: string; quantity: number }[] } | null)?.items;
      if (!items || binding.lines.some(line => items.filter(item => item.sku === line.sku).reduce((sum, item) => sum + item.quantity, 0) !== line.quantity)) throw new Error("fiscal_stock_local_effect_pending");
      const [{ now }] = await tx.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AS now`;
      const existed = await tx.fiscalEvent.findUnique({ where: { id: "stock_release_" + hash([binding.snapshotId]) }, select: { id: true } });
      await tx.fiscalEvent.upsert({ where: { id: "stock_release_" + hash([binding.snapshotId]) }, update: {}, create: { id: "stock_release_" + hash([binding.snapshotId]), ...scope, intentId,
        actorKind: "system", action: RELEASE, safeReasonCode: `stock-v1:${binding.bindingCode}:${intent.version}`, providerEvidenceRef: evidence.id, occurredAt: now } });
      if (suppressed) await tx.outboxMessage.upsert({ where: { eventId: "fiscal.stock.suppressed:" + intentId }, update: {}, create: {
        eventId: "fiscal.stock.suppressed:" + intentId, eventType: "inventory.sale.erp_sync_requested", schemaVersion: 1, merchantId: scope.merchantId,
        occurredAt: now, correlationId: receipt!.id, causationId: intentId, producer: "fiscal", payload: { version: 1, receiptId: receipt!.id, kind: "erp" } } });
      return existed ? null : { provider: intent.connection.provider, environment: intent.environment, outcome: "released" as const };
    });
    if (released) safelyObserveFiscal(() => this.observations?.stock(released));
  }
}
