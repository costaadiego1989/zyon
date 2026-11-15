import { randomUUID } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import type { TenantContextService } from "../../../shared/tenant/tenant-context.service.js";
import { withdrawnPublicBusinessSource, type PublicBusinessSourceProjection, type PublicBusinessSourceType } from "../domain/public-business-source.js";
import type { PrismaPublicBusinessSources } from "../infrastructure/prisma-public-business.sources.js";
import { nextPublicWorkVersion, samePublicWorkContent, publicWorkRetryAt } from "./public-source-work-state.js";

type QueueTransaction = Pick<Prisma.TransactionClient, "$queryRaw" | "publicSourceWork" | "knowledgeChunk">;
type PublicWorkInput = Pick<PublicBusinessSourceProjection, "merchantId" | "sourceType" | "sourceId" | "sourceHash" | "publicationState">;
export interface PublicWorkClaim { merchantId: string; id: string; leaseToken: string }
export type PublicWorkFailureCode = "canonical_unavailable" | "embedding_unavailable" | "graph_unavailable" | "invalid_source";
const sourceTypes = ["company", "business_hours", "professional", "service", "faq", "policy"];
const failureCodes = ["canonical_unavailable", "embedding_unavailable", "graph_unavailable", "invalid_source"];

function validateSource(merchantId: string, source: PublicWorkInput) {
  if (source.merchantId !== merchantId) throw new Error("public_work_scope_mismatch");
  if (![merchantId, source.sourceId].every(value => typeof value === "string" && Boolean(value.trim()) && value.length <= 191)
    || !sourceTypes.includes(source.sourceType) || !/^[a-f0-9]{64}$/.test(source.sourceHash)
    || !["draft", "published", "withdrawn"].includes(source.publicationState)) throw new Error("public_work_source_invalid");
}

/** Internal canonical-writer helper. Caller authorizes the write and holds the
 * merchant lock before changing its source. Work and invalidation use that tx.
 * Only a public fingerprint is stored, never content or administrative JSON. */
export async function enqueuePublicSourceProjection(tx: QueueTransaction, merchantId: string, source: PublicWorkInput) {
  validateSource(merchantId, source);
  const merchants = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM merchants WHERE id=${merchantId} FOR UPDATE`;
  if (merchants.length !== 1) throw new Error("public_work_merchant_missing");
  const identity = { merchantId, sourceType: source.sourceType, sourceId: source.sourceId };
  const previous = await tx.publicSourceWork.findFirst({ where: { ...identity, sourceVersion: { startsWith: "public-v1:" } }, orderBy: { sourceVersion: "desc" } });
  const legacy = await tx.publicSourceWork.findFirst({ where: { ...identity, sourceVersion: { not: { startsWith: "public-v1:" } }, status: { not: "completed" } }, select: { id: true } });
  // A legacy writer may invalidate chunks for A -> B -> A while indexing is
  // offline. Equal final content does not make that new invalidation disappear.
  if (previous && samePublicWorkContent(previous, source) && !legacy) return previous;
  const work = await tx.publicSourceWork.create({ data: { ...identity, sourceVersion: nextPublicWorkVersion(previous?.sourceVersion ?? null),
    sourceHash: source.sourceHash, publicationState: source.publicationState } });
  await tx.knowledgeChunk.deleteMany({ where: identity });
  await tx.publicSourceWork.updateMany({ where: { ...identity, sourceVersion: { not: { startsWith: "public-v1:" } }, status: { not: "completed" } },
    data: { status: "completed", lastErrorCode: "legacy_superseded", leaseToken: null, leaseExpiresAt: null, nextAttemptAt: null } });
  return work;
}

export class PublicSourceWorkService {
  constructor(private readonly prisma: PrismaClient, private readonly tenant: TenantContextService, private readonly sources: PrismaPublicBusinessSources) {}
  private assertScope(merchantId: string) {
    if (!merchantId || this.tenant.get()?.merchantId !== merchantId) throw new Error("public_work_scope_mismatch");
  }

  enqueueWithin(tx: Prisma.TransactionClient, merchantId: string, source: PublicWorkInput) {
    this.assertScope(merchantId);
    return enqueuePublicSourceProjection(tx, merchantId, source);
  }

  normalizeCurrent(merchantId: string, sourceType: PublicBusinessSourceType, sourceId: string) {
    this.assertScope(merchantId);
    return this.prisma.$transaction(async tx => {
      const merchants = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM merchants WHERE id=${merchantId} FOR UPDATE`;
      if (merchants.length !== 1) throw new Error("public_work_merchant_missing");
      const current = await this.sources.readWithin(tx, merchantId, sourceType, sourceId);
      const source = current ?? withdrawnPublicBusinessSource(merchantId, sourceType, sourceId, "missing-source");
      return enqueuePublicSourceProjection(tx, merchantId, source);
    });
  }

  async claimNext(merchantId: string) {
    this.assertScope(merchantId);
    return this.prisma.$transaction(async tx => {
      const rows = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM public_source_work
        WHERE merchant_id=${merchantId} AND
          ((status IN ('pending','failed') AND (next_attempt_at IS NULL OR next_attempt_at <= clock_timestamp()))
          OR (status='processing' AND lease_expires_at <= clock_timestamp()))
        ORDER BY created_at,id FOR UPDATE SKIP LOCKED LIMIT 1`;
      if (!rows.length) return null;
      const [clock] = await tx.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AS now`;
      return tx.publicSourceWork.update({ where: { id: rows[0]!.id }, data: { status: "processing", attempts: { increment: 1 },
        leaseToken: randomUUID(), leaseExpiresAt: new Date(clock!.now.getTime() + 30_000), lastErrorCode: null } });
    });
  }

  async complete(claim: PublicWorkClaim, embedding?: { model: string; dimensions: number }, superseded = false) {
    this.assertScope(claim.merchantId);
    if (!claim.leaseToken || embedding && (!embedding.model.trim() || embedding.model.length > 191
      || !Number.isSafeInteger(embedding.dimensions) || embedding.dimensions < 1)) throw new Error("public_work_completion_invalid");
    return this.prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM public_source_work WHERE id=${claim.id} AND merchant_id=${claim.merchantId} FOR UPDATE`;
      const updated = await tx.$executeRaw`UPDATE public_source_work SET status='completed',
        indexed_at=CASE WHEN ${superseded} THEN NULL ELSE clock_timestamp() END,
        embedding_model=${embedding?.model ?? null}, embedding_dimensions=${embedding?.dimensions ?? null},
        last_error_code=CASE WHEN ${superseded} THEN 'source_superseded' ELSE NULL END,
        lease_token=NULL,lease_expires_at=NULL,next_attempt_at=NULL,updated_at=clock_timestamp()
        WHERE id=${claim.id} AND merchant_id=${claim.merchantId} AND status='processing'
          AND lease_token=${claim.leaseToken} AND lease_expires_at > clock_timestamp()`;
      return updated === 1;
    });
  }

  async fail(claim: PublicWorkClaim, code: PublicWorkFailureCode) {
    this.assertScope(claim.merchantId);
    if (!claim.leaseToken || !failureCodes.includes(code)) throw new Error("public_work_failure_invalid");
    return this.prisma.$transaction(async tx => {
      const rows = await tx.$queryRaw<Array<{ attempts: number }>>`SELECT attempts FROM public_source_work
        WHERE id=${claim.id} AND merchant_id=${claim.merchantId} AND status='processing'
          AND lease_token=${claim.leaseToken} AND lease_expires_at > clock_timestamp() FOR UPDATE`;
      if (!rows.length) return false;
      const delay = publicWorkRetryAt(new Date(0), rows[0]!.attempts).getTime();
      const updated = await tx.$executeRaw`UPDATE public_source_work SET status='failed',last_error_code=${code},
        next_attempt_at=clock_timestamp()+(${delay}*interval '1 millisecond'),lease_token=NULL,lease_expires_at=NULL,updated_at=clock_timestamp()
        WHERE id=${claim.id} AND merchant_id=${claim.merchantId} AND status='processing'
          AND lease_token=${claim.leaseToken} AND lease_expires_at > clock_timestamp()`;
      return updated === 1;
    });
  }
}
