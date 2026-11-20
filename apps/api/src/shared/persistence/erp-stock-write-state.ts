import { createHash, randomUUID } from "node:crypto";
import type { ErpConnection, ErpSyncJob, Prisma, PrismaClient } from "@prisma/client";

type Client = Prisma.TransactionClient;
export const ERP_STOCK_TERMINAL_READER = "ERP_STOCK_TERMINAL_READER";
export type StockWrite = {
  itemId: string; sku: string; phase: "dispatching" | "uncertain" | "acknowledged";
  attemptNonce: string; fingerprint: string; credentialStamp: string;
  provider: string; externalProductId: string; externalLocationId: string;
  quantity: number; idempotencyKey: string; dispatchedAt: string; settledAt?: string;
  evidenceRef?: string;
};
type Execution = { version: 1; claimNonce: string; writes: StockWrite[] };
type Payload = { receiptId: string; stockExecution?: Execution; [key: string]: unknown };
export interface ErpStockTerminalReader {
  /** Implemented only by trusted provider wiring. No public/raw-JSON proof input. */
  verify(input: { merchantId: string; connectionId: string; jobId: string; write: Readonly<StockWrite> }): Promise<{
    terminal: true; outcome: "applied" | "not_applied"; fingerprint: string; credentialStamp: string; evidenceRef: string;
  }>;
}
const WAITING = new Set(["erp_fiscal_stock_pending", "fiscal_stock_busy", "erp_outbound_waiting", "erp_stock_write_pending"]);
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
export const stockCredentialStamp = (connection: Pick<ErpConnection, "id" | "merchantId" | "provider" | "accessTokenCipher" | "refreshTokenCipher">) =>
  hash([connection.merchantId, connection.id, connection.provider, connection.accessTokenCipher, connection.refreshTokenCipher]);

export function stockPayload(value: unknown): Payload {
  if (!value || typeof value !== "object" || Array.isArray(value) || typeof (value as Payload).receiptId !== "string") throw new Error("erp_sale_job_invalid");
  const result = structuredClone(value) as Payload;
  const execution = result.stockExecution;
  if (execution && (execution.version !== 1 || typeof execution.claimNonce !== "string" || !Array.isArray(execution.writes) ||
    execution.writes.some(write => !write || typeof write.sku !== "string" || typeof write.itemId !== "string" ||
      !["dispatching", "uncertain", "acknowledged"].includes(write.phase) || typeof write.attemptNonce !== "string" || typeof write.fingerprint !== "string"))) {
    throw new Error("erp_stock_execution_invalid");
  }
  return result;
}
export const stockWrites = (job: Pick<ErpSyncJob, "payload">) => stockPayload(job.payload).stockExecution?.writes ?? [];
export const hasUnknownStockWrite = (job: Pick<ErpSyncJob, "payload">) => stockWrites(job).some(write => write.phase !== "acknowledged");

export async function beginStockClaim(prisma: PrismaClient, job: ErpSyncJob): Promise<ErpSyncJob> {
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM erp_sync_jobs WHERE id = ${job.id} AND merchant_id = ${job.merchantId} FOR UPDATE`;
    const current = await tx.erpSyncJob.findFirstOrThrow({ where: { id: job.id, merchantId: job.merchantId, connectionId: job.connectionId, status: "running", startedAt: job.startedAt } });
    const payload = stockPayload(current.payload);
    payload.stockExecution = { version: 1, claimNonce: randomUUID(), writes: payload.stockExecution?.writes ?? [] };
    return tx.erpSyncJob.update({ where: { id: current.id }, data: { payload: payload as Prisma.InputJsonValue } });
  });
}

async function changeWrite(prisma: PrismaClient, job: ErpSyncJob, work: (payload: Payload, now: Date) => void, expectedConnection?: ErpConnection): Promise<void> {
  const nonce = stockPayload(job.payload).stockExecution?.claimNonce;
  await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM erp_connections WHERE id = ${job.connectionId} AND merchant_id = ${job.merchantId} FOR UPDATE`;
    if (expectedConnection) {
      const connection = await tx.erpConnection.findFirst({ where: { id: job.connectionId, merchantId: job.merchantId, status: "connected", provider: expectedConnection.provider } });
      if (!connection || stockCredentialStamp(connection) !== stockCredentialStamp(expectedConnection)) throw new Error("erp_stock_credential_changed");
    }
    await tx.$queryRaw`SELECT id FROM erp_sync_jobs WHERE id = ${job.id} AND merchant_id = ${job.merchantId} FOR UPDATE`;
    const current = await tx.erpSyncJob.findFirstOrThrow({ where: { id: job.id, merchantId: job.merchantId, connectionId: job.connectionId, status: "running", startedAt: job.startedAt } });
    const payload = stockPayload(current.payload);
    if (!nonce || payload.stockExecution?.claimNonce !== nonce) throw new Error("erp_stock_claim_changed");
    const [{ now }] = await tx.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AS now`;
    work(payload, now);
    await tx.erpSyncJob.update({ where: { id: current.id }, data: { payload: payload as Prisma.InputJsonValue } });
    job.payload = payload as Prisma.JsonValue;
  });
}

export async function dispatchStockWrite(prisma: PrismaClient, job: ErpSyncJob, connection: ErpConnection,
  input: Pick<StockWrite, "itemId" | "sku" | "externalProductId" | "externalLocationId" | "quantity" | "idempotencyKey">): Promise<StockWrite> {
  let result!: StockWrite;
  await changeWrite(prisma, job, (payload, now) => {
    if (payload.stockExecution!.writes.some(write => write.itemId === input.itemId)) throw new Error("erp_stock_write_pending");
    const credentialStamp = stockCredentialStamp(connection);
    const attemptNonce = randomUUID();
    result = { ...input, provider: connection.provider, credentialStamp, attemptNonce, phase: "dispatching", dispatchedAt: now.toISOString(),
      fingerprint: hash([job.merchantId, job.connectionId, stockPayload(job.payload).receiptId, input, credentialStamp, attemptNonce]) };
    payload.stockExecution!.writes.push(result);
  }, connection);
  return result;
}

export async function finishStockWrite(prisma: PrismaClient, job: ErpSyncJob, write: StockWrite, accepted: boolean): Promise<void> {
  await changeWrite(prisma, job, (payload, now) => {
    const current = payload.stockExecution!.writes.find(row => row.attemptNonce === write.attemptNonce && row.fingerprint === write.fingerprint);
    if (!current || current.phase !== "dispatching") throw new Error("erp_stock_claim_changed");
    current.phase = accepted ? "acknowledged" : "uncertain";
    if (accepted) current.settledAt = now.toISOString();
  });
}

/** Pending and unknown stock writers affect only their actual receipt SKU. */
export async function outboundStockFence(client: Client, merchantId: string, connectionId: string, sku: string,
  options: { excludeJobId?: string; pending?: boolean; readStartedAt?: Date } = {}): Promise<string | null> {
  const rows = await client.erpSyncJob.findMany({ where: { merchantId, connectionId, kind: "sale", OR: [
    { status: { notIn: ["completed", "superseded"] } },
    { status: "completed", attempts: { gt: 0 }, connection: { provider: { in: ["tiny", "bling"] } } },
    { payload: { path: ["stockExecution", "writes"], array_contains: [{ sku, phase: "dispatching" }] } },
    { payload: { path: ["stockExecution", "writes"], array_contains: [{ sku, phase: "uncertain" }] } },
    ...(options.readStartedAt ? [{ completedAt: { gte: new Date(options.readStartedAt.getTime() - 30_000) } }] : []),
  ] }, orderBy: { createdAt: "asc" } });
  for (const job of rows) {
    if (job.id === options.excludeJobId) continue;
    const payload = stockPayload(job.payload);
    const writes = payload.stockExecution?.writes.filter(write => write.sku === sku) ?? [];
    if (writes.some(write => write.phase !== "acknowledged")) return "erp_stock_write_pending";
    if (options.readStartedAt && writes.some(write => write.settledAt && options.readStartedAt!.getTime() <= new Date(write.settledAt).getTime() + 30_000)) return "erp_stock_write_watermark";
    const legacyUnknown = !payload.stockExecution && job.startedAt && !WAITING.has(job.lastErrorCode ?? "") &&
      (!["completed", "superseded"].includes(job.status) || job.status === "completed" && job.attempts > 0);
    const pending = options.pending && !writes.some(write => write.phase === "acknowledged") && !["completed", "superseded"].includes(job.status);
    const recent = !payload.stockExecution && options.readStartedAt && job.completedAt && job.completedAt.getTime() >= options.readStartedAt.getTime() - 30_000;
    if (!legacyUnknown && !pending && !recent) continue;
    const receipt = await client.inventorySaleReceipt.findFirst({ where: { id: payload.receiptId, merchantId } });
    const items = (receipt?.result as { items?: { sku: string }[] } | null)?.items;
    if (!items || items.some(item => item.sku === sku)) return "erp_stock_write_pending";
  }
  return null;
}

export async function unresolvedConnectionStock(client: Client, merchantId: string, connectionId: string): Promise<boolean> {
  const rows = await client.erpSyncJob.findMany({ where: { merchantId, connectionId, kind: "sale" }, include: { connection: { select: { provider: true } } } });
  return rows.some(job => hasUnknownStockWrite(job) || (!stockPayload(job.payload).stockExecution && !!job.startedAt &&
    !WAITING.has(job.lastErrorCode ?? "") && (!["completed", "superseded"].includes(job.status) || job.status === "completed" && job.attempts > 0 && ["tiny", "bling"].includes(job.connection.provider))));
}

export async function settleVerifiedStockWrite(prisma: PrismaClient, scope: { merchantId: string; connectionId: string; jobId: string; itemId: string },
  expected: StockWrite, proof: Awaited<ReturnType<ErpStockTerminalReader["verify"]>>): Promise<void> {
  if (!proof?.terminal || !["applied", "not_applied"].includes(proof.outcome) || proof.fingerprint !== expected.fingerprint ||
    proof.credentialStamp !== expected.credentialStamp || !proof.evidenceRef) throw new Error("erp_stock_terminal_evidence_required");
  await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM erp_connections WHERE id = ${scope.connectionId} AND merchant_id = ${scope.merchantId} FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM erp_sync_jobs WHERE id = ${scope.jobId} AND merchant_id = ${scope.merchantId} FOR UPDATE`;
    const job = await tx.erpSyncJob.findFirstOrThrow({ where: { id: scope.jobId, merchantId: scope.merchantId, connectionId: scope.connectionId } });
    const payload = stockPayload(job.payload);
    const write = payload.stockExecution?.writes.find(row => row.itemId === scope.itemId && row.fingerprint === expected.fingerprint);
    if (!write) throw new Error("erp_stock_terminal_evidence_required");
    if (write.phase === "acknowledged" && write.evidenceRef === proof.evidenceRef) return;
    if (write.phase !== "uncertain") throw new Error("erp_stock_terminal_evidence_required");
    const [{ now }] = await tx.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AS now`;
    if (proof.outcome === "applied") { write.phase = "acknowledged"; write.settledAt = now.toISOString(); write.evidenceRef = proof.evidenceRef; }
    else payload.stockExecution!.writes = payload.stockExecution!.writes.filter(row => row !== write);
    const receipt = await tx.inventorySaleReceipt.findFirst({ where: { id: payload.receiptId, merchantId: scope.merchantId } });
    const items = (receipt?.result as { items?: { itemId: string }[] } | null)?.items;
    const completed = proof.outcome === "applied" && !!items && items.every(item => payload.stockExecution!.writes.some(row => row.itemId === item.itemId && row.phase === "acknowledged"));
    await tx.erpSyncJob.update({ where: { id: job.id }, data: { payload: payload as Prisma.InputJsonValue, status: completed ? "completed" : "queued", completedAt: completed ? now : null,
      nextAttemptAt: completed ? null : now, lockedUntil: null, lastErrorCode: null } });
    await tx.merchantAuditEvent.create({ data: { merchantId: scope.merchantId, actorType: "system", actorId: "erp-stock-terminal-reader", action: "erp_stock_write_reconciled", resourceType: "erp_sync_job", resourceId: job.id,
      metadata: { itemId: write.itemId, fingerprint: write.fingerprint, outcome: proof.outcome, evidenceRef: proof.evidenceRef } } });
  });
}
