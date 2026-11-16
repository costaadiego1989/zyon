import { randomUUID } from "node:crypto";
import { GRAPH_EMBEDDING_ID } from "../domain/graph-embedding-model.js";
import { GRAPH_VECTOR_DIMENSIONS } from "../domain/graph-query.js";
import { PUBLIC_BUSINESS_SOURCE_NAMESPACE } from "../../knowledge-base/domain/knowledge-chunk-namespace.js";
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

/** Set-based equivalent for one canonical write affecting many identities.
 * The merchant lock serializes the same revision/hash rules as the single
 * source helper. Completed history and unchanged public content stay intact. */
export async function enqueuePublicSourceProjections(tx: QueueTransaction, merchantId: string, sources: PublicWorkInput[],
  expectedIndexAbi?: { model: string; dimensions: number }) {
  if (expectedIndexAbi && (!expectedIndexAbi.model.trim() || expectedIndexAbi.model.length > 191
    || !Number.isSafeInteger(expectedIndexAbi.dimensions) || expectedIndexAbi.dimensions < 1)) throw new Error("public_work_completion_invalid");
  if (!sources.length) return;
  if (sources.length === 1 && !expectedIndexAbi) { await enqueuePublicSourceProjection(tx, merchantId, sources[0]!); return; }
  const key = (source: Pick<PublicWorkInput, "sourceType" | "sourceId">) => JSON.stringify([source.sourceType, source.sourceId]);
  const unique = new Set<string>();
  for (const source of sources) {
    validateSource(merchantId, source);
    if (unique.has(key(source))) throw new Error("public_work_duplicate_identity");
    unique.add(key(source));
  }
  const merchants = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM merchants WHERE id=${merchantId} FOR UPDATE`;
  if (merchants.length !== 1) throw new Error("public_work_merchant_missing");
  const identities = JSON.stringify(sources.map(({ sourceType, sourceId }) => ({ sourceType, sourceId })));
  const previous = await tx.$queryRaw<Array<{
    sourceType: PublicBusinessSourceType; sourceId: string; sourceVersion: string | null;
    sourceHash: string | null; publicationState: string | null; hasLegacy: boolean;
    status: string | null; embeddingModel: string | null; embeddingDimensions: number | null;
  }>>`SELECT i."sourceType",i."sourceId",p.source_version AS "sourceVersion",
      p.source_hash AS "sourceHash",p.publication_state::text AS "publicationState",
      p.status::text AS status,p.embedding_model AS "embeddingModel",p.embedding_dimensions AS "embeddingDimensions",
      EXISTS(SELECT 1 FROM public_source_work old WHERE old.merchant_id=${merchantId}
        AND old.source_type=i."sourceType"::"PublicBusinessSourceType" AND old.source_id=i."sourceId"
        AND old.source_version NOT LIKE 'public-v1:%' AND old.status<>'completed') AS "hasLegacy"
    FROM jsonb_to_recordset(${identities}::jsonb) AS i("sourceType" text,"sourceId" text)
    LEFT JOIN LATERAL(SELECT source_version,source_hash,publication_state,status,embedding_model,embedding_dimensions FROM public_source_work current
      WHERE current.merchant_id=${merchantId} AND current.source_type=i."sourceType"::"PublicBusinessSourceType"
        AND current.source_id=i."sourceId" AND current.source_version LIKE 'public-v1:%'
      ORDER BY current.source_version DESC LIMIT 1) p ON TRUE`;
  if (previous.length !== sources.length) throw new Error("public_work_history_incomplete");
  const history = new Map(previous.map(row => [key(row), row]));
  const abiOnly = new Set<string>();
  const changes = sources.flatMap(source => {
    const row = history.get(key(source));
    if (!row) throw new Error("public_work_history_incomplete");
    const outdatedAbi = expectedIndexAbi && row.status === "completed" && row.publicationState === "published"
      && (row.embeddingModel !== expectedIndexAbi.model || row.embeddingDimensions !== expectedIndexAbi.dimensions);
    const sameContent = row.sourceVersion && row.sourceHash === source.sourceHash && row.publicationState === source.publicationState && !row.hasLegacy;
    if (sameContent && !outdatedAbi) return [];
    if (sameContent && outdatedAbi) abiOnly.add(key(source));
    return [{ merchantId, sourceType: source.sourceType, sourceId: source.sourceId,
      sourceVersion: nextPublicWorkVersion(row.sourceVersion), sourceHash: source.sourceHash, publicationState: source.publicationState }];
  });
  if (!changes.length) return;
  const byType = new Map<PublicBusinessSourceType, { all: string[]; canonical: string[]; abi: string[] }>();
  for (const source of changes) {
    const ids = byType.get(source.sourceType) ?? { all: [], canonical: [], abi: [] };
    ids.all.push(source.sourceId);
    (abiOnly.has(key(source)) ? ids.abi : ids.canonical).push(source.sourceId);
    byType.set(source.sourceType, ids);
  }
  const affected = [...byType].map(([sourceType, ids]) => ({ sourceType, sourceId: { in: ids.all } }));
  const invalidations = [...byType].flatMap(([sourceType, ids]) => [
    ...(ids.canonical.length ? [{ sourceType, sourceId: { in: ids.canonical } }] : []),
    ...(ids.abi.length ? [{ sourceType, sourceId: { in: ids.abi },
      metadata: { path: ["publicSourceNamespace"], equals: PUBLIC_BUSINESS_SOURCE_NAMESPACE } }] : []),
  ]);
  for (let offset = 0; offset < changes.length; offset += 1000)
    await tx.publicSourceWork.createMany({ data: changes.slice(offset, offset + 1000) });
  await tx.knowledgeChunk.deleteMany({ where: { merchantId, OR: invalidations } });
  await tx.publicSourceWork.updateMany({ where: { merchantId, OR: affected,
    sourceVersion: { not: { startsWith: "public-v1:" } }, status: { not: "completed" } },
    data: { status: "completed", lastErrorCode: "legacy_superseded", leaseToken: null, leaseExpiresAt: null, nextAttemptAt: null } });
}

/** Internal completion on the caller-owned transaction. The public wrapper
 * retains tenant authorization; this performs the same original lease CAS. */
function assertCompletionInput(claim: PublicWorkClaim, embedding?: { model: string; dimensions: number }) {
  if (!claim.leaseToken || embedding && (!embedding.model.trim() || embedding.model.length > 191
    || !Number.isSafeInteger(embedding.dimensions) || embedding.dimensions < 1)) throw new Error("public_work_completion_invalid");
}

export async function completePublicSourceWorkWithin(tx: Pick<Prisma.TransactionClient, "$queryRaw" | "$executeRaw">,
  claim: PublicWorkClaim, embedding?: { model: string; dimensions: number }, superseded = false) {
    assertCompletionInput(claim, embedding);
      await tx.$queryRaw`SELECT id FROM public_source_work WHERE id=${claim.id} AND merchant_id=${claim.merchantId} FOR UPDATE`;
      const updated = await tx.$executeRaw`UPDATE public_source_work SET status='completed',
        indexed_at=CASE WHEN ${superseded} THEN NULL ELSE clock_timestamp() END,
        embedding_model=${embedding?.model ?? null}, embedding_dimensions=${embedding?.dimensions ?? null},
        last_error_code=CASE WHEN ${superseded} THEN 'source_superseded' ELSE NULL END,
        lease_token=NULL,lease_expires_at=NULL,next_attempt_at=NULL,updated_at=clock_timestamp()
        WHERE id=${claim.id} AND merchant_id=${claim.merchantId} AND status='processing'
          AND lease_token=${claim.leaseToken} AND lease_expires_at > clock_timestamp()`;
      return updated === 1;
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

  normalizeCurrentPage(merchantId: string, sourceType: PublicBusinessSourceType, sourceIds: string[]) {
    this.assertScope(merchantId);
    if (!sourceTypes.includes(sourceType) || sourceIds.length > 100 || new Set(sourceIds).size !== sourceIds.length
      || sourceIds.some(id => typeof id !== "string" || !id.trim() || id.length > 191)) throw new Error("public_reconciliation_page_invalid");
    if (!sourceIds.length) return Promise.resolve();
    return this.prisma.$transaction(async tx => {
      const merchants = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM merchants WHERE id=${merchantId} FOR UPDATE`;
      if (merchants.length !== 1) throw new Error("public_work_merchant_missing");
      const current = await this.sources.readManyWithin(tx, merchantId, sourceIds.map(sourceId => ({ sourceType, sourceId })));
      const projections = sourceIds.map((sourceId, index) => current[index]
        ?? withdrawnPublicBusinessSource(merchantId, sourceType, sourceId, "missing-source"));
      return enqueuePublicSourceProjections(tx, merchantId, projections,
        { model: GRAPH_EMBEDDING_ID, dimensions: GRAPH_VECTOR_DIMENSIONS });
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
    assertCompletionInput(claim, embedding);
    return this.prisma.$transaction(tx => completePublicSourceWorkWithin(tx, claim, embedding, superseded));
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
