import { createHash } from "node:crypto";
import type { Prisma, PrismaClient, PublicSourceWork } from "@prisma/client";
import type { TenantContextService } from "../../../shared/tenant/tenant-context.service.js";
import { PUBLIC_BUSINESS_SOURCE_NAMESPACE } from "../../knowledge-base/domain/knowledge-chunk-namespace.js";
import { GRAPH_EMBEDDING_ID } from "../domain/graph-embedding-model.js";
import { GRAPH_VECTOR_DIMENSIONS, graphReadSchema, normalizeGraphText } from "../domain/graph-query.js";
import { withdrawnPublicBusinessSource, type PublicBusinessSourceProjection } from "../domain/public-business-source.js";
import { PublicIndexFailureError, type PublicIndexAdmissionPort, type PublicIndexClaim, type PublicIndexQueuePort } from "../application/public-business-index.worker.js";
import { publicBusinessTextChunks, type PreparedPublicBusinessProjection } from "../application/public-business-projection.service.js";
import { publicWorkSequence } from "../application/public-source-work-state.js";
import { completePublicSourceWorkWithin, enqueuePublicSourceProjection, type PublicSourceWorkService } from "../application/public-source-work.service.js";
import type { PrismaPublicBusinessSources } from "./prisma-public-business.sources.js";

class LostPublicIndexLease extends Error {}
const digest = (value: string) => createHash("sha256").update(value).digest("hex");

/** Canonical admission, never a public content writer. Every operation retains
 * the original claim and uses a caller-owned scoped PostgreSQL transaction. */
export class PrismaPublicBusinessIndexAdapter implements PublicIndexQueuePort, PublicIndexAdmissionPort<PreparedPublicBusinessProjection> {
  constructor(private readonly prisma: PrismaClient, private readonly tenant: TenantContextService,
    private readonly sources: PrismaPublicBusinessSources, private readonly work: PublicSourceWorkService) {}

  private scope(merchantId: string) {
    if (!merchantId || this.tenant.get()?.merchantId !== merchantId) throw new Error("public_index_scope_mismatch");
  }

  async claimNext(merchantId: string): Promise<PublicIndexClaim | null> {
    this.scope(merchantId);const row = await this.work.claimNext(merchantId);
    if (!row) return null;
    if (!row.leaseToken) throw new PublicIndexFailureError("invalid_source");
    return { merchantId: row.merchantId, id: row.id, leaseToken: row.leaseToken, sourceType: row.sourceType,
      sourceId: row.sourceId, sourceVersion: row.sourceVersion, sourceHash: row.sourceHash, publicationState: row.publicationState };
  }
  failConditional(claim: Readonly<PublicIndexClaim>, code: "canonical_unavailable" | "embedding_unavailable" | "graph_unavailable" | "invalid_source") {
    this.scope(claim.merchantId);return this.work.fail(claim, code);
  }

  private async owned(tx: Prisma.TransactionClient, claim: Readonly<PublicIndexClaim>): Promise<PublicSourceWork | null> {
    await tx.$queryRaw`SELECT id FROM merchants WHERE id=${claim.merchantId} FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM public_source_work WHERE id=${claim.id} AND merchant_id=${claim.merchantId} FOR UPDATE`;
    const row = await tx.publicSourceWork.findFirst({ where: { id: claim.id, merchantId: claim.merchantId } });
    const [clock] = await tx.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AS now`;
    if (!row || row.status !== "processing" || row.leaseToken !== claim.leaseToken || !row.leaseExpiresAt || row.leaseExpiresAt <= clock!.now
      || row.sourceType !== claim.sourceType || row.sourceId !== claim.sourceId || row.sourceVersion !== claim.sourceVersion
      || row.sourceHash !== claim.sourceHash || row.publicationState !== claim.publicationState) return null;
    return row;
  }

  private async canonical(tx: Prisma.TransactionClient, claim: Readonly<PublicIndexClaim>) {
    return await this.sources.readWithin(tx, claim.merchantId, claim.sourceType, claim.sourceId)
      ?? withdrawnPublicBusinessSource(claim.merchantId, claim.sourceType, claim.sourceId, "missing-source");
  }

  private async fresh(tx: Prisma.TransactionClient, owner: PublicSourceWork) {
    const [clock] = await tx.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AS now`;
    if (!owner.leaseExpiresAt || owner.leaseExpiresAt <= clock!.now) throw new LostPublicIndexLease();
  }

  private async current(tx: Prisma.TransactionClient, claim: Readonly<PublicIndexClaim>) {
    const identity = { merchantId: claim.merchantId, sourceType: claim.sourceType, sourceId: claim.sourceId };
    const latest = await tx.publicSourceWork.findFirst({ where: { ...identity, sourceVersion: { startsWith: "public-v1:" } }, orderBy: { sourceVersion: "desc" } });
    const marker = await tx.publicSourceWork.findFirst({ where: { ...identity,
      sourceVersion: { not: { startsWith: "public-v1:" } }, status: { not: "completed" } }, select: { id: true } });
    const source = await this.canonical(tx, claim);
    return { source, ready: latest?.id === claim.id && !marker
      && source.sourceHash === claim.sourceHash && source.publicationState === claim.publicationState };
  }

  private async supersede(tx: Prisma.TransactionClient, claim: Readonly<PublicIndexClaim>, source: PublicBusinessSourceProjection) {
    await enqueuePublicSourceProjection(tx, claim.merchantId, source);
    if (!await completePublicSourceWorkWithin(tx, claim, undefined, true)) throw new LostPublicIndexLease();
  }

  async normalizeMarker(claim: Readonly<PublicIndexClaim>): Promise<"normalized" | "lease_lost"> {
    this.scope(claim.merchantId);
    if (claim.sourceVersion.startsWith("public-v1:")) throw new PublicIndexFailureError("invalid_source");
    try {
      return await this.prisma.$transaction(async tx => {
        const owner = await this.owned(tx, claim);if (!owner) return "lease_lost" as const;
        await enqueuePublicSourceProjection(tx, claim.merchantId, await this.canonical(tx, claim));
        await this.fresh(tx, owner);
        return "normalized" as const;
      });
    } catch (error) { if (error instanceof LostPublicIndexLease) return "lease_lost";throw error; }
  }

  async loadSnapshot(claim: Readonly<PublicIndexClaim>): ReturnType<PublicIndexQueuePort["loadSnapshot"]> {
    this.scope(claim.merchantId);
    try {
      return await this.prisma.$transaction(async tx => {
        const owner = await this.owned(tx, claim);if (!owner) return { status: "lease_lost" as const };
        const state = await this.current(tx, claim);
        if (!state.ready) { await this.supersede(tx, claim, state.source);return { status: "superseded" as const }; }
        await this.fresh(tx, owner);return { status: "ready" as const, source: state.source };
      });
    } catch (error) { if (error instanceof LostPublicIndexLease) return { status: "lease_lost" };throw error; }
  }

  async commit(claim: Readonly<PublicIndexClaim>, source: Readonly<PublicBusinessSourceProjection>,
    prepared: Readonly<PreparedPublicBusinessProjection>, submitGraph: () => Promise<void>): Promise<"completed" | "superseded" | "lease_lost"> {
    this.scope(claim.merchantId);
    try {
      return await this.prisma.$transaction(async tx => {
        const owner = await this.owned(tx, claim);if (!owner) return "lease_lost" as const;
        const current = await this.current(tx, claim);
        if (!current.ready) { await this.supersede(tx, claim, current.source);return "superseded" as const; }
        const rows = this.prepareRows(claim, source, current.source, prepared);
        const column = await this.vectorColumn(tx);
        await this.fresh(tx, owner);
        await submitGraph();
        await this.publishSql(tx, claim, rows, column);
        if (!await completePublicSourceWorkWithin(tx, claim, { model: GRAPH_EMBEDDING_ID, dimensions: GRAPH_VECTOR_DIMENSIONS }))
          throw new LostPublicIndexLease();
        return "completed" as const;
      });
    } catch (error) { if (error instanceof LostPublicIndexLease) return "lease_lost";throw error; }
  }

  private prepareRows(claim: Readonly<PublicIndexClaim>, source: Readonly<PublicBusinessSourceProjection>,
    canonical: PublicBusinessSourceProjection, prepared: Readonly<PreparedPublicBusinessProjection>) {
    const active = canonical.publicationState === "published" && Boolean(canonical.text.trim());
    if (source.merchantId !== claim.merchantId || source.sourceType !== claim.sourceType || source.sourceId !== claim.sourceId
      || source.sourceHash !== canonical.sourceHash || source.publicationState !== canonical.publicationState || source.text !== canonical.text
      || prepared.merchantId !== claim.merchantId || prepared.sourceType !== claim.sourceType || prepared.sourceId !== claim.sourceId
      || prepared.sourceHash !== canonical.sourceHash || prepared.publicRevision !== publicWorkSequence(claim.sourceVersion)
      || prepared.active !== active || prepared.modelId !== GRAPH_EMBEDDING_ID || prepared.dimensions !== GRAPH_VECTOR_DIMENSIONS)
      throw new PublicIndexFailureError("invalid_source");
    const texts = active ? publicBusinessTextChunks(canonical.text) : [];
    if (texts.length !== prepared.chunks.length) throw new PublicIndexFailureError("invalid_source");
    return texts.map((content, index) => {
      const chunk = prepared.chunks[index]!, id = digest(JSON.stringify([claim.sourceType, claim.sourceId, index]));
      if (chunk.id !== id || chunk.contentHash !== digest(content) || chunk.normalizedText !== normalizeGraphText(content)
        || !graphReadSchema.shape.embedding.safeParse(chunk.embedding).success) throw new PublicIndexFailureError("invalid_source");
      return { id: digest(JSON.stringify([claim.merchantId, claim.sourceType, claim.sourceId, prepared.publicRevision, id])),
        merchantId: claim.merchantId, sourceType: claim.sourceType, sourceId: claim.sourceId, content, embedding: JSON.stringify(chunk.embedding),
        metadata: { publicSourceNamespace: PUBLIC_BUSINESS_SOURCE_NAMESPACE, schemaVersion: 1, sourceVersion: claim.sourceVersion,
          sourceHash: claim.sourceHash, publicationState: claim.publicationState, chunkId: id, contentHash: chunk.contentHash,
          embeddingModel: GRAPH_EMBEDDING_ID, embeddingDimensions: GRAPH_VECTOR_DIMENSIONS } };
    });
  }

  private async vectorColumn(tx: Prisma.TransactionClient) {
    const column = await tx.$queryRaw<Array<{ type: string }>>`SELECT format_type(a.atttypid,a.atttypmod) AS type
      FROM pg_attribute a WHERE a.attrelid='public.knowledge_chunks'::regclass AND a.attname='embedding_vec' AND NOT a.attisdropped`;
    if (column.length && column[0]!.type !== "vector(384)") throw new PublicIndexFailureError("embedding_unavailable");
    return column.length === 1;
  }

  private async publishSql(tx: Prisma.TransactionClient, claim: Readonly<PublicIndexClaim>, rows: ReturnType<PrismaPublicBusinessIndexAdapter["prepareRows"]>, vectorColumn: boolean) {
    await tx.$executeRaw`DELETE FROM knowledge_chunks WHERE merchant_id=${claim.merchantId} AND source_type=${claim.sourceType}
      AND source_id=${claim.sourceId} AND metadata->>'publicSourceNamespace'=${PUBLIC_BUSINESS_SOURCE_NAMESPACE}`;
    if (!rows.length) return;
    await tx.knowledgeChunk.createMany({ data: rows });
    if (vectorColumn) {
      const vectors = JSON.stringify(rows.map(row => ({ id: row.id, embedding: row.embedding })));
      await tx.$executeRaw`UPDATE knowledge_chunks k SET embedding_vec=p.embedding::vector(384)
        FROM jsonb_to_recordset(${vectors}::jsonb) AS p(id text,embedding text)
        WHERE k.id=p.id AND k.merchant_id=${claim.merchantId} AND k.source_type=${claim.sourceType}
          AND k.source_id=${claim.sourceId} AND k.metadata->>'publicSourceNamespace'=${PUBLIC_BUSINESS_SOURCE_NAMESPACE}`;
    }
  }
}
