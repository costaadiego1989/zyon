import { ErpProviderError, ERP_AUTH_ERROR_CODES, erpCooldownUntil, isErpAuthError, readOmieResponse } from "../../infrastructure/adapters/erp-provider-error.js";
import { blingClientChanged, blingClientFingerprint } from "../../infrastructure/adapters/bling-token-identity.js";
import { Inject, Injectable, Logger, Optional } from "@nestjs/common";
import type { ErpConnection, ErpSyncJob, PrismaClient } from "@prisma/client";
import { createHash } from "node:crypto";
import { PRISMA_CLIENT } from "../../../../shared/persistence/persistence.module.js";
import type { AppliedInventorySale } from "../../domain/events/sale-completed.event.js";
import { decryptErpSecret } from "../../infrastructure/adapters/erp-secret-cipher.js";
import { readBlingCredential } from "../../../../shared/integrations/bling-credentials.js";
import { fiscalStockBarrier, lockFiscalStock, providerOwnedSaleSkus } from "../../../../shared/persistence/fiscal-stock-coordination.js";
import { beginStockClaim, dispatchStockWrite, finishStockWrite, hasUnknownStockWrite, outboundStockFence, stockPayload, stockWrites,
  settleVerifiedStockWrite, ERP_STOCK_TERMINAL_READER, type ErpStockTerminalReader, type StockWrite } from "../../../../shared/persistence/erp-stock-write-state.js";

type SupportedErp = "omie" | "bling" | "tiny";
type SyncKind = "full" | "sale";

type RemoteSnapshot = {
  externalProductId: string;
  externalLocationId: string;
  sku: string;
  productName: string;
  quantity: number;
  costCents?: number;
  salePriceCents?: number;
};

type SaleJobPayload = { receiptId: string };

const SUPPORTED = new Set<SupportedErp>(["omie", "bling", "tiny"]);
const RETRY_LIMIT = 6;
const JOB_LEASE_MS = 15 * 60_000;
const JOB_LEASE_HEARTBEAT_MS = 2 * 60_000;
const BLING_STOCK_BATCH_SIZE = 100;
// Bling permits three requests per account each second. Leave a small margin
// so snapshots can coexist with webhook-route and sale writes.
const BLING_REQUEST_INTERVAL_MS = 350;
const BLING_RATE_LIMIT_RETRIES = 3;

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isSupported(provider: string): provider is SupportedErp {
  return SUPPORTED.has(provider as SupportedErp);
}

function errorCode(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (message === "fiscal_stock_busy") return message;
  return /^(erp|bling)_/.test(message) ? message.slice(0, 160) : "erp_sync_failed";
}

function positiveInteger(value: unknown, code: string): number {
  const result = Number(value);
  if (!Number.isSafeInteger(result)) throw new Error(code);
  return result;
}

function cents(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return undefined;
  return Math.round(parsed * 100);
}

function dateBr(date = new Date()): string {
  // The production server runs in UTC; Omie expects the business date in Brazil.
  return new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo" }).format(date);
}

function externalId(value: unknown, code: string): string {
  const result = String(value ?? "").trim();
  if (!result) throw new Error(code);
  return result;
}

/**
 * The database is the queue authority. Redis is intentionally not required:
 * claiming uses an expiring lease, so a restart can resume work without two
 * API replicas executing the same active job.
 */
@Injectable()
export class ErpSyncService {
  private readonly logger = new Logger(ErpSyncService.name);
  private draining = false;
  private blingNextRequestAt = 0;
  private readonly tinyRequestLimits = new Map<string, { nextAt: number; intervalMs: number }>();

  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient,
    @Optional() @Inject(ERP_STOCK_TERMINAL_READER) private readonly stockTerminalReader?: ErpStockTerminalReader) {}

  async enqueueFull(merchantId: string, connectionId: string, source: "manual" | "initial" | "periodic" = "manual") {
    const connection = await this.prisma.erpConnection.findFirst({ where: { id: connectionId, merchantId } });
    if (!connection) throw new Error("erp_connection_not_found");
    if (!isSupported(connection.provider)) throw new Error("erp_provider_not_supported");
    if (connection.status !== "connected") throw new Error("erp_connection_not_connected");
    if (erpCooldownUntil(connection.config)) throw new Error("erp_provider_cooldown");

    // Validated credentials restore the connection to connected. Preserve sale
    // identity on resumed work; replace obsolete snapshots with one fresh read.
    if (source !== "periodic") {
      await this.prisma.erpSyncJob.updateMany({
        where: { merchantId, connectionId, status: "blocked", kind: "full", lastErrorCode: { in: [...ERP_AUTH_ERROR_CODES] } },
        data: { status: "superseded", nextAttemptAt: null },
      });
      await this.prisma.erpSyncJob.updateMany({
        where: { merchantId, connectionId, status: "blocked", kind: { in: ["sale", "catalog_stock"] }, lastErrorCode: { in: [...ERP_AUTH_ERROR_CODES] } },
        data: { status: "queued", attempts: 0, nextAttemptAt: new Date(), lastErrorCode: null },
      });
    }

    const bucket = source === "periodic" ? Math.floor(Date.now() / (15 * 60 * 1000)) : Date.now();
    const job = await this.createJob({
      merchantId,
      connectionId,
      kind: "full",
      dedupeKey: `${source}:full:${connectionId}:${bucket}`,
    });
    this.kick();
    return job;
  }

  /** A provider webhook identifies one immutable event, so retries share one job. */
  async enqueueWebhookFull(merchantId: string, connectionId: string, eventId: string) {
    const connection = await this.prisma.erpConnection.findFirst({ where: { id: connectionId, merchantId } });
    if (!connection) throw new Error("erp_connection_not_found");
    if (!isSupported(connection.provider)) throw new Error("erp_provider_not_supported");
    if (connection.status !== "connected") throw new Error("erp_connection_not_connected");

    const job = await this.createJob({
      merchantId,
      connectionId,
      kind: "full",
      dedupeKey: `webhook:full:${connectionId}:${eventId}`,
    });
    this.kick();
    return job;
  }

  async enqueueSale(sale: AppliedInventorySale): Promise<void> {
    const eligibleSkus = await this.physicalSaleSkus(sale.event.merchantId, sale.event.items);
    if (!eligibleSkus.length) return;
    const connections = await this.prisma.erpConnection.findMany({
      where: {
        merchantId: sale.event.merchantId,
        status: "connected",
        provider: { in: [...SUPPORTED] },
        directionMode: { in: ["bidirectional", "zyon_source_of_truth"] },
        productMappings: { some: { merchantId: sale.event.merchantId, sku: { in: eligibleSkus } } },
      },
      select: { id: true },
    });

    await Promise.all(connections.map(async (connection) => {
      const owned = await providerOwnedSaleSkus(this.prisma, sale.event.merchantId, connection.id, sale.event.orderId);
      if (eligibleSkus.every(sku => owned.has(sku))) return;
      return this.createJob({
      merchantId: sale.event.merchantId,
      connectionId: connection.id,
      kind: "sale",
      dedupeKey: `sale:${connection.id}:${sale.receiptId}`,
      payload: { receiptId: sale.receiptId },
      });
    }));
    this.kick();
  }

  private async physicalSaleSkus(merchantId: string, lines: AppliedInventorySale["event"]["items"]): Promise<string[]> {
    const candidates = lines.filter(line => !line.productType || line.productType === "physical");
    if (!candidates.length) return [];
    const variants = await this.prisma.productVariant.findMany({ where: { sku: { in: candidates.map(line => line.sku) }, product: { merchantId, type: "physical" } }, select: { id: true, sku: true } });
    return candidates.filter(line => variants.some(variant => variant.sku === line.sku && (!line.variantId || line.variantId === variant.id))).map(line => line.sku);
  }

  async enqueuePeriodic(): Promise<void> {
    const connections = await this.prisma.erpConnection.findMany({
      where: { status: "connected", provider: { in: [...SUPPORTED] }, directionMode: { not: "zyon_source_of_truth" } },
      select: { id: true, merchantId: true },
    });
    await Promise.all(connections.map((connection) =>
      this.enqueueFull(connection.merchantId, connection.id, "periodic").catch((error) => {
        this.logger.warn("erp.periodic.enqueue_failed", { connectionId: connection.id, code: errorCode(error) });
      }),
    ));
  }

  async drain(): Promise<void> {
    if (this.draining) return;
    this.draining = true;
    try {
      while (true) {
        const now = new Date();
        await this.requeueExpiredLeases(now);
        const jobs = await this.prisma.erpSyncJob.findMany({
          where: {
            status: "queued",
            OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
          },
          orderBy: { createdAt: "asc" },
          take: 10,
        });
        if (jobs.length === 0) return;
        for (const job of jobs) await this.process(job.id);
      }
    } finally {
      this.draining = false;
    }
  }

  private kick(): void {
    void this.drain().catch((error) => this.logger.error("erp.queue.drain_failed", { code: errorCode(error) }));
  }

  private async createJob(input: {
    merchantId: string;
    connectionId: string;
    kind: SyncKind;
    dedupeKey: string;
    payload?: SaleJobPayload;
  }) {
    try {
      return await this.prisma.erpSyncJob.create({
        data: { ...input, status: "queued" },
      });
    } catch (error: any) {
      if (error?.code !== "P2002") throw error;
      const existing = await this.prisma.erpSyncJob.findUnique({ where: { dedupeKey: input.dedupeKey } });
      if (!existing) throw error;
      return existing;
    }
  }

  private async process(jobId: string): Promise<void> {
    const previous = await this.prisma.erpSyncJob.findUnique({ where: { id: jobId } });
    const claimedAt = new Date();
    const claimed = await this.prisma.erpSyncJob.updateMany({
      where: { id: jobId, status: "queued" },
      data: { status: "running", startedAt: claimedAt, lockedUntil: new Date(claimedAt.getTime() + JOB_LEASE_MS) },
    });
    if (claimed.count !== 1) return;

    const loaded = await this.prisma.erpSyncJob.findUnique({ where: { id: jobId } });
    if (!loaded) return;
    let job: ErpSyncJob = loaded;

    const heartbeat = setInterval(() => {
      void this.prisma.erpSyncJob.updateMany({
        where: { id: job.id, status: "running", startedAt: job.startedAt },
        data: { lockedUntil: new Date(Date.now() + JOB_LEASE_MS) },
      }).catch((error) => this.logger.warn("erp.job.lease_heartbeat_failed", { jobId: job.id, code: errorCode(error) }));
    }, JOB_LEASE_HEARTBEAT_MS);
    heartbeat.unref();

    let connection: ErpConnection | null = null;
    try {
      connection = await this.prisma.erpConnection.findFirst({
        where: { id: job.connectionId, merchantId: job.merchantId },
      });
      if (!connection || !isSupported(connection.provider)) throw new Error("erp_connection_not_available");
      if (connection.status !== "connected") {
        if (isErpAuthError(connection.lastErrorCode)) throw new ErpProviderError(connection.lastErrorCode!, true);
        throw new Error("erp_connection_not_available");
      }
      const cooldown = erpCooldownUntil(connection.config);
      if (cooldown) throw new ErpProviderError(connection.lastErrorCode || "erp_provider_cooldown", false, cooldown.getTime() - Date.now());
      if (job.kind === "sale" && ["tiny", "bling"].includes(connection.provider)) {
        if (previous?.startedAt && !stockPayload(previous.payload).stockExecution &&
          !["erp_fiscal_stock_pending", "fiscal_stock_busy", "erp_outbound_waiting", "erp_stock_write_pending"].includes(previous.lastErrorCode ?? "")) {
          await this.prisma.erpSyncJob.update({ where: { id: job.id }, data: { status: "uncertain", nextAttemptAt: null, lockedUntil: null, lastErrorCode: "erp_sale_delivery_uncertain" } });
          return;
        }
        job = await beginStockClaim(this.prisma, job);
      }

      if (connection.provider === "bling") {
        // Legacy connections predate the per-company webhook route. Backfilling
        // that route is useful, but it must never prevent the first durable
        // product and inventory snapshot from reaching Zyon.
        try {
          await this.ensureBlingWebhookRoute(connection);
        } catch (error) {
          if (error instanceof ErpProviderError && error.requiresReconnect) throw error;
          this.logger.warn("bling.webhook_route.backfill_failed", {
            connectionId: connection.id,
            code: errorCode(error),
          });
        }
      }

      if (job.kind === "full") {
        if (connection.directionMode !== "zyon_source_of_truth") {
          const snapshotStartedAt = new Date();
          const snapshots = await this.pullSnapshots(connection);
          let deferred = false;
          for (const snapshot of snapshots) {
            try { await this.applySnapshot(connection, snapshot, snapshotStartedAt); }
            catch (error) { if (errorCode(error) === "erp_snapshot_waiting_for_sales") deferred = true; else throw error; }
          }
          if (deferred) throw new Error("erp_snapshot_waiting_for_sales");
        }
      } else if (job.kind === "sale") {
        if (connection.directionMode === "erp_source_of_truth") {
          const receiptId = (job.payload as SaleJobPayload | null)?.receiptId;
          const receipt = receiptId ? await this.prisma.inventorySaleReceipt.findFirst({ where: { id: receiptId, merchantId: job.merchantId } }) : null;
          for (const item of (receipt?.result as { items?: { sku: string }[] } | null)?.items ?? []) {
            if (await outboundStockFence(this.prisma, job.merchantId, connection.id, item.sku, { excludeJobId: job.id })) throw new Error("erp_stock_write_pending");
          }
          if (hasUnknownStockWrite(job)) throw new Error("erp_sale_delivery_uncertain");
        }
        if (connection.directionMode !== "erp_source_of_truth") {
          const payload = job.payload as SaleJobPayload | null;
          if (!payload?.receiptId) throw new Error("erp_sale_job_invalid");
          const activeJob = job;
          await this.withFiscalSaleStockLock(activeJob, connection, () => this.pushSale(connection!, activeJob.merchantId, payload.receiptId, activeJob));
        }
      } else {
        throw new Error("erp_job_kind_invalid");
      }

      await this.prisma.$transaction([
        job.kind === "sale" && stockPayload(job.payload).stockExecution ? this.prisma.erpSyncJob.updateMany({
          where: { id: job.id, merchantId: job.merchantId, status: "running", startedAt: job.startedAt,
            payload: { path: ["stockExecution", "claimNonce"], equals: stockPayload(job.payload).stockExecution!.claimNonce } },
          data: { status: "completed", completedAt: new Date(), lockedUntil: null, lastErrorCode: null },
        }) : this.prisma.erpSyncJob.update({ where: { id: job.id }, data: { status: "completed", completedAt: new Date(), lockedUntil: null, lastErrorCode: null } }),
        this.prisma.erpConnection.updateMany({ where: { id: connection.id, merchantId: connection.merchantId, status: "connected", accessTokenCipher: connection.accessTokenCipher, refreshTokenCipher: connection.refreshTokenCipher, lastErrorCode: connection.lastErrorCode }, data: { lastSyncAt: new Date(), lastErrorCode: null } }),
      ]);
    } catch (error) {
      const uncertain = job.kind === "sale" && !!(job.payload as SaleJobPayload | null)?.receiptId && hasUnknownStockWrite(job);
      if (uncertain) {
        await this.prisma.erpSyncJob.updateMany({ where: { id: job.id, merchantId: job.merchantId, status: "running", startedAt: job.startedAt },
          data: { status: "uncertain", attempts: job.attempts + 1, nextAttemptAt: null, lockedUntil: null, completedAt: null, lastErrorCode: "erp_sale_delivery_uncertain" } });
        if (connection && error instanceof ErpProviderError && error.requiresReconnect) await this.pauseForReauthorization(connection, job, error.message, true);
        return;
      }
      if (connection && error instanceof ErpProviderError && error.requiresReconnect) {
        await this.pauseForReauthorization(connection, job, error.message, false);
        return;
      }
      if (connection && error instanceof ErpProviderError && error.retryAfterMs) {
        await this.pauseForCooldown(connection, job, error.message, error.retryAfterMs);
        return;
      }
      const code = errorCode(error);
      const waitingForSales = code === "erp_snapshot_waiting_for_sales" || code === "erp_fiscal_stock_pending" || code === "fiscal_stock_busy" || code === "erp_stock_write_pending";
      const attempts = job.attempts + (waitingForSales ? 0 : 1);
      const terminal = !waitingForSales && ( attempts >= RETRY_LIMIT || code === "erp_multi_location_requires_mapping" || code === "erp_bling_rate_limit_day");
      const nextAttemptAt = terminal ? null : new Date(Date.now() + (waitingForSales ? 60_000 : Math.min(30 * 60_000, 2 ** attempts * 30_000)));
      await this.prisma.$transaction([
        this.prisma.erpSyncJob.update({
          where: { id: job.id },
          data: { status: terminal ? "failed" : "queued", attempts, nextAttemptAt, lockedUntil: null, lastErrorCode: code },
        }),
        this.prisma.erpConnection.update({ where: { id: job.connectionId }, data: { lastErrorCode: code } }),
      ]);
      this.logger.warn("erp.job.failed", { jobId: job.id, connectionId: job.connectionId, attempts, code });
    } finally {
      clearInterval(heartbeat);
    }
  }

  private async pauseForReauthorization(connection: ErpConnection, job: ErpSyncJob, code: string, uncertain: boolean): Promise<void> {
    await this.prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM erp_connections WHERE id = ${connection.id} AND merchant_id = ${connection.merchantId} FOR UPDATE`;
      const current = await tx.erpConnection.findFirst({ where: { id: connection.id, merchantId: connection.merchantId } });
      // A delayed response from an old credential must not disable a fresh login.
      if (!current || current.accessTokenCipher !== connection.accessTokenCipher || current.refreshTokenCipher !== connection.refreshTokenCipher) {
        await tx.erpSyncJob.updateMany({ where: { id: job.id, merchantId: job.merchantId, status: "running" }, data: { status: uncertain ? "uncertain" : "queued", nextAttemptAt: uncertain ? null : new Date(), lockedUntil: null, lastErrorCode: uncertain ? (job.kind === "catalog_stock" ? "erp_catalog_delivery_uncertain" : "erp_sale_delivery_uncertain") : null } });
        return;
      }
      await tx.erpConnection.updateMany({ where: { id: connection.id, merchantId: connection.merchantId, accessTokenCipher: connection.accessTokenCipher, refreshTokenCipher: connection.refreshTokenCipher }, data: { status: "error", lastErrorCode: code } });
      await tx.erpSyncJob.updateMany({ where: { connectionId: connection.id, merchantId: connection.merchantId, status: "queued" }, data: { status: "blocked", nextAttemptAt: null, lockedUntil: null, lastErrorCode: code } });
      await tx.erpSyncJob.updateMany({ where: { id: job.id, merchantId: job.merchantId, status: "running" }, data: { status: uncertain ? "uncertain" : "blocked", nextAttemptAt: null, lockedUntil: null, lastErrorCode: uncertain ? (job.kind === "catalog_stock" ? "erp_catalog_delivery_uncertain" : "erp_sale_delivery_uncertain") : code } });
    });
    this.logger.warn("erp.connection.reauthorization_required", { connectionId: connection.id, provider: connection.provider, code });
  }

  private async pauseForCooldown(connection: ErpConnection, job: ErpSyncJob, code: string, delayMs: number): Promise<void> {
    await this.prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM erp_connections WHERE id = ${connection.id} AND merchant_id = ${connection.merchantId} FOR UPDATE`;
      const current = await tx.erpConnection.findFirst({ where: { id: connection.id, merchantId: connection.merchantId } });
      if (!current || current.status !== "connected" || current.accessTokenCipher !== connection.accessTokenCipher || current.refreshTokenCipher !== connection.refreshTokenCipher) {
        await tx.erpSyncJob.updateMany({ where: { id: job.id, merchantId: job.merchantId, status: "running" }, data: { status: "queued", nextAttemptAt: new Date(), lockedUntil: null, lastErrorCode: null } });
        return;
      }
      const nextAttemptAt = new Date(Math.max(Date.now() + delayMs, erpCooldownUntil(current.config)?.getTime() ?? 0));
      await tx.erpSyncJob.updateMany({ where: { connectionId: connection.id, merchantId: connection.merchantId, OR: [{ status: "queued" }, { id: job.id, status: "running" }] }, data: { status: "queued", nextAttemptAt, lockedUntil: null, lastErrorCode: code } });
      await tx.erpConnection.update({ where: { id: current.id }, data: { lastErrorCode: code, config: { ...(current.config as object ?? {}), erpRetryAfterAt: nextAttemptAt.toISOString() } } });
    });
  }

  private async requeueExpiredLeases(now: Date): Promise<void> {
    const sales = await this.prisma.erpSyncJob.findMany({ where: { kind: "sale", connection: { provider: { in: ["tiny", "bling"] } }, status: "running", lockedUntil: { lte: now } } });
    for (const job of sales) {
      const payload = stockPayload(job.payload);
      for (const write of payload.stockExecution?.writes ?? []) if (write.phase === "dispatching") write.phase = "uncertain";
      const uncertain = !payload.stockExecution || payload.stockExecution.writes.some(write => write.phase === "uncertain");
      const receipt = payload.stockExecution ? await this.prisma.inventorySaleReceipt.findFirst({ where: { id: payload.receiptId, merchantId: job.merchantId } }) : null;
      const remaining = ((receipt?.result as { items?: { itemId: string }[] } | null)?.items ?? []).some(item =>
        !payload.stockExecution!.writes.some(write => write.itemId === item.itemId));
      const recoverable = !!payload.stockExecution && (!uncertain || remaining);
      await this.prisma.erpSyncJob.updateMany({ where: { id: job.id, status: "running", lockedUntil: { lte: now } }, data: {
        payload: payload as never, status: recoverable ? "queued" : "uncertain", nextAttemptAt: recoverable ? now : null, lockedUntil: null,
        lastErrorCode: uncertain ? "erp_sale_delivery_uncertain" : "erp_worker_lease_expired",
      } });
    }
    const recovered = await this.prisma.erpSyncJob.updateMany({
      where: { NOT: { kind: "sale", connection: { provider: { in: ["tiny", "bling"] } } }, status: "running", lockedUntil: { lte: now } },
      data: { status: "queued", nextAttemptAt: now, lockedUntil: null, lastErrorCode: "erp_worker_lease_expired" },
    });
    if (recovered.count > 0) this.logger.warn("erp.queue.leases_recovered", { count: recovered.count });
  }

  private async withFiscalSaleStockLock(job: ErpSyncJob, connection: ErpConnection, work: () => Promise<void>): Promise<void> {
    await this.prisma.$transaction(async tx => {
      const receipt = await tx.inventorySaleReceipt.findFirst({ where: { merchantId: job.merchantId, id: (job.payload as SaleJobPayload).receiptId } });
      const skus = ((receipt?.result as { items?: { sku: string }[] } | null)?.items ?? []).map(item => item.sku);
      await lockFiscalStock(tx, job.merchantId, connection.id, skus);
      for (const sku of skus) {
        const barrier = await fiscalStockBarrier(tx, job.merchantId, connection.id, sku);
        if (barrier) throw new Error(barrier);
      }
      await work();
    }, { timeout: 120_000 });
  }

  private async pullSnapshots(connection: ErpConnection): Promise<RemoteSnapshot[]> {
    switch (connection.provider) {
      case "omie": return this.pullOmie(connection);
      case "bling": return this.pullBling(connection);
      case "tiny": return this.pullTiny(connection);
    }
    throw new Error("erp_provider_not_supported");
  }

  private async pushSale(connection: ErpConnection, merchantId: string, receiptId: string, job?: ErpSyncJob): Promise<void> {
    const receipt = await this.prisma.inventorySaleReceipt.findFirst({ where: { id: receiptId, merchantId } });
    if (!receipt) throw new Error("erp_sale_receipt_not_found");
    const result = receipt.result as unknown as AppliedInventorySale;
    if (!Array.isArray(result?.items)) throw new Error("erp_sale_receipt_invalid");
    const event = receipt.payload as unknown as AppliedInventorySale["event"];
    if (!Array.isArray(event?.items)) throw new Error("erp_sale_receipt_invalid");
    const eligibleSkus = await this.physicalSaleSkus(merchantId, event.items);
    const fiscalOwned = await providerOwnedSaleSkus(this.prisma, merchantId, connection.id, receipt.orderId);
    let blingStockWriter: { token: string; depositId: number } | null = null;
    let waiting = false, uncertain = false;

    for (const item of result.items) {
      if (!eligibleSkus.includes(item.sku) || fiscalOwned.has(item.sku)) continue;
      if (job && ["tiny", "bling"].includes(connection.provider)) {
        const prior = stockWrites(job).find(write => write.itemId === item.itemId);
        if (prior) { if (prior.phase !== "acknowledged") uncertain = true; continue; }
        if (await outboundStockFence(this.prisma, merchantId, connection.id, item.sku, { excludeJobId: job.id })) { waiting = true; continue; }
      }
      const mapping = await this.prisma.erpProductMapping.findFirst({
        where: { merchantId, connectionId: connection.id, sku: item.sku, externalLocationId: "0" },
      });
      // A mixed cart can contain products from different ERPs or local-only
      // products. Each provider receives only the items mapped to its account.
      if (!mapping) continue;
      const idempotencyKey = createHash("sha256").update(`${connection.id}:${receiptId}:${item.itemId}`).digest("hex").slice(0, 48);
      if (connection.provider === "omie") {
        await this.pushOmieSale(connection, mapping.externalProductId, item.quantity, receipt.orderId, idempotencyKey);
      } else if (connection.provider === "bling") {
        if (!blingStockWriter) {
          const token = await this.blingToken(connection);
          blingStockWriter = { token, depositId: await this.blingDefaultDepositId(token) };
        }
        const quantity = await this.currentOutboundQuantity(connection, { ...mapping, itemId: item.itemId, locationId: item.locationId });
        try { await this.withDurableAbsoluteStockWrite(job, connection, { ...mapping, itemId: item.itemId, sku: item.sku, quantity, idempotencyKey },
          () => this.pushBlingSnapshot(blingStockWriter!.token, mapping.externalProductId, quantity, idempotencyKey, blingStockWriter!.depositId)); }
        catch (error) { if (error instanceof ErpProviderError || !job || !hasUnknownStockWrite(job)) throw error; uncertain = true; }
      } else {
        const quantity = await this.currentOutboundQuantity(connection, { ...mapping, itemId: item.itemId, locationId: item.locationId });
        try { await this.withDurableAbsoluteStockWrite(job, connection, { ...mapping, itemId: item.itemId, sku: item.sku, quantity, idempotencyKey },
          () => this.pushTinySnapshot(connection, mapping.externalProductId, quantity, idempotencyKey)); }
        catch (error) { if (error instanceof ErpProviderError || !job || !hasUnknownStockWrite(job)) throw error; uncertain = true; }
      }
    }
    if (uncertain) throw new Error("erp_sale_delivery_uncertain");
    if (waiting) throw new Error("erp_stock_write_pending");
  }

  private async withDurableAbsoluteStockWrite(job: ErpSyncJob | undefined, connection: ErpConnection,
    input: Pick<StockWrite, "itemId" | "sku" | "externalProductId" | "externalLocationId" | "quantity" | "idempotencyKey">, work: () => Promise<void>) {
    if (!job) throw new Error("erp_stock_job_required");
    const write = await dispatchStockWrite(this.prisma, job, connection, input);
    try { await work(); }
    catch (error) { await finishStockWrite(this.prisma, job, write, false); throw error; }
    await finishStockWrite(this.prisma, job, write, true);
  }

  /** Internal only: evidence is obtained from trusted wiring, never supplied JSON. */
  private async reconcileUncertainStockWrite(scope: { merchantId: string; connectionId: string; jobId: string; itemId: string }) {
    if (!this.stockTerminalReader) throw new Error("erp_stock_terminal_verification_unavailable");
    const job = await this.prisma.erpSyncJob.findFirstOrThrow({ where: { id: scope.jobId, merchantId: scope.merchantId, connectionId: scope.connectionId } });
    const write = stockWrites(job).find(row => row.itemId === scope.itemId);
    if (!write) throw new Error("erp_stock_terminal_evidence_required");
    const proof = await this.stockTerminalReader.verify({ ...scope, write: Object.freeze(structuredClone(write)) });
    await this.prisma.$transaction(async tx => { await lockFiscalStock(tx, scope.merchantId, scope.connectionId, [write.sku]);
      await settleVerifiedStockWrite(this.prisma, scope, write, proof); });
  }

  private async currentOutboundQuantity(connection: ErpConnection, input: {
    sku: string; externalProductId: string; externalLocationId: string; variantId?: string | null; itemId: string; locationId: string;
  }): Promise<number> {
    // The sale caller holds this SKU's fiscal stock lock. Keep the canonical
    // read serialized with merchant stock writers, and end it before HTTP.
    return this.prisma.$transaction(async tx => {
      const merchants = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM merchants WHERE id = ${connection.merchantId} FOR UPDATE`;
      if (merchants.length !== 1) throw new Error("erp_stock_scope_invalid");
      const currentConnection = await tx.erpConnection.findFirst({ where: {
        id: connection.id, merchantId: connection.merchantId, provider: connection.provider, status: "connected", directionMode: connection.directionMode,
      }, select: { id: true } });
      if (!currentConnection || !["bidirectional", "zyon_source_of_truth"].includes(connection.directionMode)) throw new Error("erp_stock_export_disabled");
      const mappings = await tx.erpProductMapping.findMany({ where: {
        merchantId: connection.merchantId, connectionId: connection.id, sku: input.sku,
      }, take: 2 });
      const mapping = mappings.length === 1 ? mappings[0] : undefined;
      if (!mapping || mapping.externalProductId !== input.externalProductId || mapping.externalLocationId !== "0" || input.externalLocationId !== "0") {
        throw new Error("erp_product_mapping_required");
      }
      const variants = await tx.productVariant.findMany({ where: {
        sku: input.sku, product: { merchantId: connection.merchantId, deletedAt: null, type: "physical" },
      }, include: { stock: true }, take: 2 });
      const variant = variants.length === 1 ? variants[0] : undefined;
      if (!variant || (mapping.variantId && mapping.variantId !== variant.id) || (input.variantId && input.variantId !== variant.id)) {
        throw new Error("erp_product_mapping_required");
      }
      const locations = await tx.inventoryLocation.findMany({ where: { merchantId: connection.merchantId, isActive: true }, take: 2 });
      const location = locations.length === 1 && locations[0]!.isDefault ? locations[0] : undefined;
      if (!location || input.locationId !== location.id) throw new Error("erp_stock_location_ambiguous");
      const items = await tx.inventoryItem.findMany({ where: { merchantId: connection.merchantId, sku: input.sku, locationId: location.id }, take: 2 });
      const item = items.length === 1 ? items[0] : undefined;
      const stock = variant.stock.length === 1 ? variant.stock[0] : undefined;
      if (!item || !stock || input.itemId !== item.id || item.quantity !== stock.quantity ||
        !Number.isSafeInteger(item.quantity) || item.quantity < 0 || item.quantity > 2_147_483_647 ||
        !Number.isSafeInteger(item.reserved) || item.reserved < 0 || item.reserved > item.quantity ||
        !Number.isSafeInteger(stock.reserved) || stock.reserved < 0 || stock.reserved > stock.quantity) throw new Error("erp_stock_balance_unproven");
      return item.quantity;
    });
  }

  private async assertSnapshotCurrent(client: Parameters<typeof outboundStockFence>[0], connection: ErpConnection, snapshotStartedAt: Date, sku: string): Promise<void> {
    if (await outboundStockFence(client, connection.merchantId, connection.id, sku, { pending: connection.directionMode !== "erp_source_of_truth", readStartedAt: snapshotStartedAt })) {
      throw new Error("erp_snapshot_waiting_for_sales");
    }
  }

  private async applySnapshot(connection: ErpConnection, snapshot: RemoteSnapshot, snapshotStartedAt: Date): Promise<void> {
    if (!Number.isSafeInteger(snapshot.quantity)) throw new Error("erp_fractional_stock_not_supported");
    await this.prisma.$transaction(async (tx) => {
      // Every stock writer in this module takes this merchant lock first.
      await tx.$queryRaw`SELECT id FROM merchants WHERE id = ${connection.merchantId} FOR UPDATE`;
      try { await lockFiscalStock(tx, connection.merchantId, connection.id, [snapshot.sku]); }
      catch (error) { if (error instanceof Error && error.message === "fiscal_stock_busy") return; throw error; }
      const fiscalBarrier = await fiscalStockBarrier(tx, connection.merchantId, connection.id, snapshot.sku, snapshotStartedAt);
      if (fiscalBarrier) {
        this.logger.warn("erp.snapshot.fiscal_stock_deferred", { connectionId: connection.id, sku: snapshot.sku, code: fiscalBarrier });
        return;
      }
      await this.assertSnapshotCurrent(tx, connection, snapshotStartedAt, snapshot.sku);
      const activeLocations = await tx.inventoryLocation.findMany({ where: { merchantId: connection.merchantId, isActive: true }, take: 2 });
      if (activeLocations.length > 1) throw new Error("erp_multi_location_requires_mapping");
      const location = activeLocations[0] ?? await tx.inventoryLocation.create({
        data: { merchantId: connection.merchantId, name: "Estoque principal", kind: "warehouse", isDefault: true },
      });

      const existingMapping = await tx.erpProductMapping.findFirst({
        where: { connectionId: connection.id, externalProductId: snapshot.externalProductId, externalLocationId: snapshot.externalLocationId },
      });
      let variant = existingMapping?.variantId
        ? await tx.productVariant.findUnique({ where: { id: existingMapping.variantId }, include: { product: true, stock: true, price: true } })
        : null;

      if (!variant) {
        const matches = await tx.productVariant.findMany({
          where: { sku: snapshot.sku, product: { merchantId: connection.merchantId } },
          include: { product: true, stock: true, price: true },
          take: 2,
        });
        if (matches.length > 1) throw new Error("erp_sku_ambiguous");
        variant = matches[0] ?? null;
      }
      if (variant && variant.product.type !== "physical") return;

      if (!variant) {
        const product = await tx.product.create({ data: { merchantId: connection.merchantId, name: snapshot.productName, type: "physical", isActive: false } });
        variant = await tx.productVariant.create({
          data: { productId: product.id, sku: snapshot.sku },
          include: { product: true, stock: true, price: true },
        });
        await tx.productPrice.create({ data: { variantId: variant.id, basePriceInCents: snapshot.salePriceCents ?? 0, costInCents: snapshot.costCents } });
        await tx.productStock.create({ data: { variantId: variant.id, quantity: snapshot.quantity } });
        const item = await tx.inventoryItem.create({
          data: {
            merchantId: connection.merchantId, sku: snapshot.sku, productName: snapshot.productName,
            locationId: location.id, quantity: snapshot.quantity, avgCostCents: snapshot.costCents, salePriceCents: snapshot.salePriceCents,
            lastCountedAt: new Date(),
          },
        });
        if (snapshot.quantity !== 0) await tx.inventoryMovement.create({
          data: { merchantId: connection.merchantId, itemId: item.id, kind: "ENTRY", quantity: snapshot.quantity, reason: "Importação ERP", source: `erp:${connection.provider}` },
        });
      } else {
        const stocks = variant.stock;
        if (stocks.length > 1) throw new Error("erp_catalog_stock_ambiguous");
        const stock = stocks[0] ?? await tx.productStock.create({ data: { variantId: variant.id, quantity: 0 } });
        const item = await tx.inventoryItem.findFirst({ where: { merchantId: connection.merchantId, sku: variant.sku, locationId: location.id } });
        if (stock.reserved > snapshot.quantity || (item?.reserved ?? 0) > snapshot.quantity) throw new Error("erp_quantity_below_reserved");
        const delta = snapshot.quantity - (item?.quantity ?? stock.quantity);
        await tx.product.update({ where: { id: variant.productId }, data: { name: snapshot.productName } });
        await tx.productStock.update({ where: { id: stock.id }, data: { quantity: snapshot.quantity } });
        await tx.productPrice.upsert({
          where: { variantId: variant.id },
          update: { basePriceInCents: snapshot.salePriceCents ?? variant.price?.basePriceInCents ?? 0, costInCents: snapshot.costCents ?? variant.price?.costInCents },
          create: { variantId: variant.id, basePriceInCents: snapshot.salePriceCents ?? 0, costInCents: snapshot.costCents },
        });
        if (item) {
          await tx.inventoryItem.update({ where: { id: item.id }, data: { quantity: snapshot.quantity, productName: snapshot.productName, avgCostCents: snapshot.costCents, salePriceCents: snapshot.salePriceCents, lastCountedAt: new Date() } });
          if (delta !== 0) await tx.inventoryMovement.create({
            data: { merchantId: connection.merchantId, itemId: item.id, kind: delta > 0 ? "ENTRY" : "ADJUSTMENT", quantity: delta, reason: "Snapshot ERP", source: `erp:${connection.provider}` },
          });
        } else {
          await tx.inventoryItem.create({ data: { merchantId: connection.merchantId, sku: variant.sku, productName: snapshot.productName, locationId: location.id, quantity: snapshot.quantity, avgCostCents: snapshot.costCents, salePriceCents: snapshot.salePriceCents, lastCountedAt: new Date() } });
        }
      }

      const mappedVariant = variant!;
      const mappingData = { merchantId: connection.merchantId, connectionId: connection.id, variantId: mappedVariant.id, sku: mappedVariant.sku, externalProductId: snapshot.externalProductId, externalLocationId: snapshot.externalLocationId };
      if (existingMapping) await tx.erpProductMapping.update({ where: { id: existingMapping.id }, data: mappingData });
      else await tx.erpProductMapping.create({ data: mappingData });
    });
  }

  private async pullOmie(connection: ErpConnection): Promise<RemoteSnapshot[]> {
    const credentials = this.omieCredentials(connection);
    const snapshots: RemoteSnapshot[] = [];
    for (let page = 1; ; page++) {
      const response = await this.omieCall("https://app.omie.com.br/api/v1/estoque/consulta/", credentials, "ListarPosEstoque", {
        nPagina: page, nRegPorPagina: 100, dDataPosicao: dateBr(), codigo_local_estoque: 0, cExibeTodos: "S",
      });
      const rows = Array.isArray(response.produtos) ? response.produtos : [];
      for (const row of rows) snapshots.push({
        externalProductId: externalId(row.nCodProd, "erp_omie_product_id_missing"), externalLocationId: "0",
        sku: externalId(row.cCodigo, "erp_omie_product_code_missing"), productName: externalId(row.cDescricao, "erp_omie_product_name_missing"),
        quantity: positiveInteger(row.nSaldo, "erp_fractional_stock_not_supported"), costCents: cents(row.nCMC), salePriceCents: cents(row.nPrecoUnitario),
      });
      const totalPages = Number(response.nTotPaginas ?? response.total_de_paginas ?? 1);
      if (page >= totalPages || rows.length === 0) break;
    }
    return snapshots;
  }

  private async pushOmieSale(connection: ErpConnection, productId: string, quantity: number, orderId: string, idempotencyKey: string): Promise<void> {
    const numericId = positiveInteger(productId, "erp_omie_product_id_invalid");
    await this.omieCall("https://app.omie.com.br/api/v1/estoque/ajuste/", this.omieCredentials(connection), "IncluirAjusteEstoque", {
      codigo_local_estoque: 0, id_prod: numericId, cod_int_ajuste: idempotencyKey, data: dateBr(), tipo: "SAI", quan: quantity, valor: 0,
      origem: "AJU", motivo: "INV", obs: `Venda Zyon ${orderId}`.slice(0, 200),
    });
  }

  private omieCredentials(connection: ErpConnection): { appKey: string; appSecret: string } {
    if (!connection.accessTokenCipher || !connection.refreshTokenCipher) throw new Error("erp_omie_credentials_missing");
    return { appKey: decryptErpSecret(connection.accessTokenCipher), appSecret: decryptErpSecret(connection.refreshTokenCipher) };
  }

  private async omieCall(url: string, credentials: { appKey: string; appSecret: string }, call: string, param: Record<string, unknown>): Promise<any> {
    const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, signal: AbortSignal.timeout(20_000), body: JSON.stringify({ call, app_key: credentials.appKey, app_secret: credentials.appSecret, param: [param] }) });
    return readOmieResponse(response);
  }

  private async pullBling(connection: ErpConnection): Promise<RemoteSnapshot[]> {
    const token = await this.blingToken(connection);
    const snapshots: RemoteSnapshot[] = [];
    for (let page = 1; page <= 10_000; page++) {
      const listing = await this.blingFetch(token, `/produtos?pagina=${page}&limite=100`);
      const rows = Array.isArray(listing.data) ? listing.data : [];
      const products: Array<{ id: string; product: any; row: any }> = [];
      for (const row of rows) {
        const id = externalId(row.id, "erp_bling_product_id_missing");
        const detail = await this.blingFetch(token, `/produtos/${encodeURIComponent(id)}`);
        const product = detail.data ?? detail;
        // Services do not carry physical inventory in Bling and cannot be
        // represented by Zyon's stock-backed product model.
        if (product.tipo === "S") continue;
        products.push({ id, product, row });
      }

      const stockByProductId = new Map<string, any>();
      for (let start = 0; start < products.length; start += BLING_STOCK_BATCH_SIZE) {
        const batch = products.slice(start, start + BLING_STOCK_BATCH_SIZE);
        const query = new URLSearchParams();
        for (const product of batch) query.append("idsProdutos[]", String(positiveInteger(product.id, "erp_bling_product_id_invalid")));
        const balances = await this.blingFetch(token, `/estoques/saldos?${query.toString()}`);
        const rows = Array.isArray(balances.data) ? balances.data : [];
        for (const balance of rows) {
          const id = externalId(balance?.produto?.id, "erp_bling_stock_product_id_missing");
          if (stockByProductId.has(id)) throw new Error("erp_bling_stock_duplicate_product");
          stockByProductId.set(id, balance);
        }
      }

      for (const { id, product, row } of products) {
        const balance = stockByProductId.get(id);
        if (!balance) throw new Error("erp_bling_stock_response_missing_product");
        snapshots.push({
          externalProductId: id, externalLocationId: "0", sku: externalId(product.codigo ?? row.codigo ?? id, "erp_bling_product_code_missing"),
          productName: externalId(product.nome ?? row.nome, "erp_bling_product_name_missing"),
          quantity: positiveInteger(balance.saldoFisicoTotal, "erp_bling_stock_shape_invalid"), costCents: cents(product.precoCusto), salePriceCents: cents(product.preco),
        });
      }
      if (rows.length < 100) break;
    }
    return snapshots;
  }

  private async pushBlingSnapshot(token: string, productId: string, quantity: number, idempotencyKey: string, depositId: number): Promise<void> {
    await this.blingFetch(token, "/estoques", {
      method: "POST",
      body: JSON.stringify({ produto: { id: positiveInteger(productId, "erp_bling_product_id_invalid") }, deposito: { id: depositId }, operacao: "B", quantidade: quantity, observacoes: `Zyon ${idempotencyKey}` }),
    });
  }

  private async blingDefaultDepositId(token: string): Promise<number> {
    const response = await this.blingFetch(token, "/depositos?pagina=1&limite=100&situacao=1");
    const deposits = Array.isArray(response.data) ? response.data : [];
    const available = deposits.filter((deposit: any) => deposit?.desconsiderarSaldo !== true);
    const deposit = available.find((entry: any) => entry?.padrao === true) ?? (available.length === 1 ? available[0] : null);
    if (!deposit) throw new Error("erp_bling_default_deposit_missing");
    return positiveInteger(deposit.id, "erp_bling_default_deposit_invalid");
  }

  private async blingToken(connection: ErpConnection): Promise<string> {
    if (!connection.accessTokenCipher) throw new Error("erp_bling_access_token_missing");
    if (!process.env.BLING_CLIENT_ID || !process.env.BLING_CLIENT_SECRET) throw new ErpProviderError("erp_bling_app_configuration_invalid", true);
    if (blingClientChanged(connection.config, decryptErpSecret(connection.accessTokenCipher))) throw new ErpProviderError("erp_bling_app_changed", true);
    return (await readBlingCredential(this.prisma, connection)).token;
  }

  /** Existing OAuth connections gain the same exact webhook route on their first snapshot. */
  private async ensureBlingWebhookRoute(connection: ErpConnection): Promise<void> {
    const identity = await this.blingFetch(await this.blingToken(connection), "/empresas/me/dados-basicos");
    const companyId = externalId(identity?.data?.id, "bling_company_identity_missing");

    const existingRoute = await this.prisma.erpWebhookRoute.findUnique({
      where: { provider_externalAccountId: { provider: "bling", externalAccountId: companyId } },
    });
    if (existingRoute && existingRoute.merchantId !== connection.merchantId) {
      throw new Error("bling_company_already_connected");
    }

    await this.prisma.erpWebhookRoute.deleteMany({
      where: { provider: "bling", connectionId: connection.id, externalAccountId: { not: companyId } },
    });
    await this.prisma.erpWebhookRoute.upsert({
      where: { provider_externalAccountId: { provider: "bling", externalAccountId: companyId } },
      update: { merchantId: connection.merchantId, connectionId: connection.id },
      create: { provider: "bling", externalAccountId: companyId, merchantId: connection.merchantId, connectionId: connection.id },
    });
  }

  private async blingFetch(token: string, path: string, init?: RequestInit): Promise<any> {
    for (let attempt = 0; attempt <= BLING_RATE_LIMIT_RETRIES; attempt += 1) {
      const now = Date.now();
      const delay = Math.max(0, this.blingNextRequestAt - now);
      if (delay > 0) await wait(delay);
      this.blingNextRequestAt = Date.now() + BLING_REQUEST_INTERVAL_MS;

      const response = await fetch(`https://api.bling.com.br/Api/v3${path}`, {
        ...init,
        headers: { Authorization: `Bearer ${token}`, "enable-jwt": "1", "Content-Type": "application/json", ...(init?.headers ?? {}) },
      });
      if (response.ok) return response.json();
      if (response.status === 401) throw new ErpProviderError("erp_bling_reauthorization_required", true);
      if (response.status !== 429) throw new Error(`erp_bling_http_${response.status}`);

      const body = await response.json().catch(() => null) as { error?: { period?: unknown } } | null;
      if (body?.error?.period === "day") throw new Error("erp_bling_rate_limit_day");
      if (attempt === BLING_RATE_LIMIT_RETRIES) throw new Error("erp_bling_http_429");
      await wait(BLING_REQUEST_INTERVAL_MS * (attempt + 1));
    }
    throw new Error("erp_bling_http_429");
  }

  private async pullTiny(connection: ErpConnection): Promise<RemoteSnapshot[]> {
    const token = this.tinyToken(connection);
    const snapshots: RemoteSnapshot[] = [];
    for (let page = 1; page <= 10_000; page++) {
      const listing = await this.tinyCall("pdv.produtos.php", token, { pagina: String(page) });
      const response = listing.retorno ?? listing;
      const rows = Array.isArray(response.produtos) ? response.produtos : [];
      for (const raw of rows) {
        const row = raw.produto ?? raw;
        const id = externalId(row.id, "erp_tiny_product_id_missing");
        const detail = await this.tinyCall("produto.obter.php", token, { id });
        const product = (detail.retorno ?? detail).produto;
        if (!product) throw new Error("erp_tiny_product_missing");
        if (product.tipo === "S") continue;
        const stockResult = await this.tinyCall("produto.obter.estoque.php", token, { id });
        // The provider total respects excluded deposits and MultiEmpresas settings.
        // Missing balances must not silently overwrite the local snapshot with zero.
        const quantity = (stockResult.retorno ?? stockResult).produto?.saldo;
        if (quantity === undefined || quantity === null || quantity === "") throw new Error("erp_tiny_stock_missing");
        snapshots.push({
          externalProductId: id, externalLocationId: "0", sku: externalId(product.codigo ?? row.codigo ?? id, "erp_tiny_product_code_missing"),
          productName: externalId(product.nome ?? row.nome, "erp_tiny_product_name_missing"), quantity: positiveInteger(quantity, "erp_fractional_stock_not_supported"),
          costCents: cents(product.preco_custo ?? row.preco_custo), salePriceCents: cents(product.preco ?? row.preco),
        });
      }
      if (page >= Number(response.numero_paginas ?? 1) || rows.length === 0) break;
    }
    return snapshots;
  }

  private async pushTinySnapshot(connection: ErpConnection, productId: string, quantity: number, idempotencyKey: string): Promise<void> {
    await this.tinyCall("produto.atualizar.estoque.php", this.tinyToken(connection), {
      estoque: JSON.stringify({ estoque: { idProduto: positiveInteger(productId, "erp_tiny_product_id_invalid"), tipo: "B", quantidade: String(quantity), observacoes: `Zyon ${idempotencyKey}`.slice(0, 100) } }),
    });
  }

  private tinyToken(connection: ErpConnection): string {
    if (!connection.accessTokenCipher) throw new Error("erp_tiny_api_token_missing");
    return decryptErpSecret(connection.accessTokenCipher);
  }

  private async tinyCall(service: string, token: string, data: Record<string, string>): Promise<any> {
    // The per-company quota is returned by Tiny in x-limit-api. Use the
    // documented legacy minimum until that header is known; never retain tokens
    // as limiter keys. The durable worker retries exhausted quotas later.
    const limitKey = createHash("sha256").update(token).digest("hex");
    const limit = this.tinyRequestLimits.get(limitKey) ?? { nextAt: 0, intervalMs: 3_050 };
    const requestAt = Math.max(Date.now(), limit.nextAt);
    limit.nextAt = requestAt + limit.intervalMs;
    this.tinyRequestLimits.set(limitKey, limit);
    await wait(Math.max(0, requestAt - Date.now()));
    const form = new URLSearchParams({ token, formato: "JSON", ...data });
    const response = await fetch(`https://api.tiny.com.br/api2/${service}`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: form.toString() });
    const quotaHeader = response.headers.get("x-limit-api");
    if (quotaHeader !== null) {
      const quota = Number(quotaHeader);
      if (quota === 0) throw new Error("erp_tiny_plan_api_unavailable");
      if (Number.isFinite(quota) && quota > 0) {
        limit.intervalMs = Math.ceil(60_000 / quota) + 50;
        limit.nextAt = requestAt + limit.intervalMs;
      }
    }
    if (!response.ok) throw new Error(`erp_tiny_http_${response.status}`);
    const body = await response.json() as any;
    const result = body.retorno ?? body;
    // Code 20 only means an empty search. A failed stock write is never success.
    const emptySearch = service === "pdv.produtos.php" && Number(result.codigo_erro) === 20;
    if (result.status !== "OK" && !emptySearch) throw new Error("erp_tiny_api_error");
    const records = Array.isArray(result.registros) ? result.registros : result.registros ? [result.registros] : [];
    if (records.some((entry: any) => {
      const record = entry.registro ?? entry;
      return record.status && record.status !== "OK";
    })) {
      throw new Error("erp_tiny_stock_write_rejected");
    }
    return body;
  }
}
