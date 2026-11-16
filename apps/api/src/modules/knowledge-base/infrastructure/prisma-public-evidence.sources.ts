import { Prisma, type PrismaClient } from "@prisma/client";
import type { TenantContextService } from "../../../shared/tenant/tenant-context.service.js";
import { resolveStorePolicies } from "../../../shared/legal/store-policies.js";
import { readCanonicalPublicBusinessSourcesWithin } from "../../graph-rag/infrastructure/prisma-public-business.sources.js";
import type { PublicBusinessSourceProjection, PublicBusinessSourceType } from "../../graph-rag/domain/public-business-source.js";
import { parsePublicSupportFaqItems } from "../../support/public-support-knowledge.module.js";
import { PUBLIC_BUSINESS_SOURCE_NAMESPACE } from "../domain/knowledge-chunk-namespace.js";
import { PUBLIC_POLICY_LABELS } from "../domain/public-knowledge-content.js";
import type { LegacyEvidenceSnapshot, PublicEvidenceCandidate, PublicEvidenceCanonicalPort,
  PublicEvidenceSnapshotSet, PublicEvidenceStoredChunk, PublicEvidenceWork } from "../domain/public-source-evidence.js";
import { PublishedGraphKnowledgeSources } from "./published-graph-knowledge.sources.js";

const sourceTypes = ["company", "business_hours", "professional", "service", "faq", "policy"] as const;
type Identity = { sourceType: PublicBusinessSourceType; sourceId: string };
const validId = (value: unknown): value is string => typeof value === "string" && Boolean(value.trim()) && value.length <= 191;
const key = (value: Identity) => JSON.stringify([value.sourceType, value.sourceId]);
const legacyOrigin = (candidate: PublicEvidenceCandidate) => candidate.origin === "legacy_graph" || candidate.origin === "legacy_sql";
interface HistoryRow extends Identity {
  sourceVersion: string | null; sourceHash: string | null; publicationState: string | null; status: string | null;
  indexedAt: Date | null; embeddingModel: string | null; embeddingDimensions: number | null; hasPendingLegacy: boolean;
}

/** One bounded canonical read. The caller's tenant is checked before any I/O.
 * Merchant FOR SHARE serializes with source/index writers' FOR UPDATE. The
 * default READ COMMITTED transaction reads only after acquiring that lock;
 * no nested transaction, model call or graph request belongs in this port.
 */
export class PrismaPublicEvidenceSources implements PublicEvidenceCanonicalPort {
  constructor(private readonly prisma: PrismaClient, private readonly tenant: TenantContextService) {}

  assertScope(merchantId: string): void {
    if (!validId(merchantId) || this.tenant.get()?.merchantId !== merchantId) throw new Error("public_evidence_scope_mismatch");
  }

  async read(merchantId: string, candidates: ReadonlyArray<Readonly<PublicEvidenceCandidate>>): Promise<PublicEvidenceSnapshotSet> {
    this.assertScope(merchantId);
    if (!Array.isArray(candidates)) throw new Error("public_evidence_candidates_invalid");
    const requested = new Map<string, Identity>(), legacyRequested = new Map<string, Identity>();
    for (const candidate of candidates) {
      if (!candidate || candidate.merchantId !== merchantId || !validId(candidate.sourceId)
        || !(sourceTypes as readonly string[]).includes(candidate.sourceType)) continue;
      const identity = { sourceType: candidate.sourceType as PublicBusinessSourceType, sourceId: candidate.sourceId };
      requested.set(key(identity), identity);
      if (legacyOrigin(candidate) && (identity.sourceType === "faq" && identity.sourceId === "faq-collection"
        || identity.sourceType === "policy" && Object.hasOwn(PUBLIC_POLICY_LABELS, identity.sourceId)))
        legacyRequested.set(key(identity), identity);
    }
    if (requested.size > 20) throw new Error("public_evidence_groups_invalid");
    if (!requested.size) return { sources: [], legacy: [] };
    const needsFaq = [...legacyRequested.values()].some(identity => identity.sourceType === "faq");
    const needsPolicies = [...legacyRequested.values()].some(identity => identity.sourceType === "policy");

    return this.prisma.$transaction(async tx => {
      const locked = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`SELECT id FROM merchants WHERE id=${merchantId} FOR SHARE`);
      if (locked.length !== 1) return { sources: [], legacy: [] };

      const faqSetting = needsFaq ? await tx.supportSetting.findUnique({ where: { merchantId },
        select: { merchantId: true, faqItems: true, updatedAt: true } }) : null;
      if (faqSetting && faqSetting.merchantId !== merchantId) throw new Error("public_evidence_scope_mismatch");
      const faqItems = needsFaq ? parsePublicSupportFaqItems(faqSetting?.faqItems) : [];
      const faqIds = new Set<string>();
      for (const item of faqItems) {
        if (faqIds.has(item.id)) throw new Error("public_source_ambiguous");
        faqIds.add(item.id);
      }
      // The external bound is20 candidate identities. The existing FAQ parser
      // bounds one aggregate to100 current items; expansion stays set-based.
      const identities = new Map(requested);
      for (const item of faqItems) {
        const identity: Identity = { sourceType: "faq", sourceId: item.id };
        identities.set(key(identity), identity);
      }
      const ordered = [...identities.values()];
      const canonical = await readCanonicalPublicBusinessSourcesWithin(tx, merchantId, ordered);
      if (canonical.length !== ordered.length) throw new Error("public_evidence_snapshot_incomplete");
      const current = new Map(ordered.map((identity, index) => [key(identity), canonical[index] ?? null]));
      const encoded = JSON.stringify(ordered);
      const history = await tx.$queryRaw<HistoryRow[]>(Prisma.sql`
        SELECT i."sourceType",i."sourceId",p.source_version AS "sourceVersion",p.source_hash AS "sourceHash",
          p.publication_state::text AS "publicationState",p.status::text AS status,p.indexed_at AS "indexedAt",
          p.embedding_model AS "embeddingModel",p.embedding_dimensions AS "embeddingDimensions",
          EXISTS(SELECT 1 FROM public_source_work old WHERE old.merchant_id=${merchantId}
            AND old.source_type=i."sourceType"::"PublicBusinessSourceType" AND old.source_id=i."sourceId"
            AND old.source_version NOT LIKE 'public-v1:%' AND old.status<>'completed') AS "hasPendingLegacy"
        FROM jsonb_to_recordset(${encoded}::jsonb) AS i("sourceType" text,"sourceId" text)
        LEFT JOIN LATERAL(SELECT source_version,source_hash,publication_state,status,indexed_at,embedding_model,embedding_dimensions
          FROM public_source_work current WHERE current.merchant_id=${merchantId}
            AND current.source_type=i."sourceType"::"PublicBusinessSourceType" AND current.source_id=i."sourceId"
            AND current.source_version LIKE 'public-v1:%' ORDER BY current.source_version DESC LIMIT 1) p ON TRUE`);
      const byIdentity = new Map(history.map(row => [key(row), row]));
      if (history.length !== ordered.length || byIdentity.size !== ordered.length) throw new Error("public_evidence_snapshot_incomplete");
      const actualChunks = await tx.knowledgeChunk.findMany({ where: { merchantId,
        OR: ordered.map(identity => ({ sourceType: identity.sourceType, sourceId: identity.sourceId })),
        metadata: { path: ["publicSourceNamespace"], equals: PUBLIC_BUSINESS_SOURCE_NAMESPACE } },
        select: { id: true, merchantId: true, sourceType: true, sourceId: true, content: true, metadata: true }, orderBy: { id: "asc" } });
      const chunks = new Map<string, PublicEvidenceStoredChunk[]>();
      for (const chunk of actualChunks) {
        const identity = { sourceType: chunk.sourceType as PublicBusinessSourceType, sourceId: chunk.sourceId ?? "" };
        if (chunk.merchantId !== merchantId || !identities.has(key(identity))) throw new Error("public_evidence_scope_mismatch");
        const values = chunks.get(key(identity)) ?? [];values.push(chunk);chunks.set(key(identity), values);
      }
      const sources = ordered.map(identity => {
        const row = byIdentity.get(key(identity));
        if (!row) throw new Error("public_evidence_snapshot_incomplete");
        let latest: PublicEvidenceWork | null = null;
        if (row.sourceVersion !== null) {
          if (!row.sourceHash || !row.publicationState || !row.status) throw new Error("public_evidence_snapshot_incomplete");
          latest = { sourceVersion: row.sourceVersion, sourceHash: row.sourceHash, publicationState: row.publicationState,
            status: row.status, indexedAt: row.indexedAt, embeddingModel: row.embeddingModel, embeddingDimensions: row.embeddingDimensions };
        }
        return { ...identity, source: current.get(key(identity)) ?? null, latest,
          hasPendingLegacy: row.hasPendingLegacy, chunks: chunks.get(key(identity)) ?? [] };
      });

      const legacy: LegacyEvidenceSnapshot[] = [];
      if (legacyRequested.size) {
        const merchant = needsPolicies ? await tx.merchant.findUnique({ where: { id: merchantId },
          select: { id: true, storeSettings: true, updatedAt: true } }) : null;
        if (needsPolicies && merchant?.id !== merchantId) throw new Error("public_evidence_scope_mismatch");
        const policy = needsPolicies ? await tx.merchantPolicy.findUnique({ where: { merchantId } }) : null;
        const policySnapshot = { merchantId, version: Math.max(merchant?.updatedAt.getTime() ?? 0, policy?.updatedAt.getTime() ?? 0),
          policy: resolveStorePolicies(merchant?.storeSettings, policy) };
        const faqSnapshot = { merchantId, version: faqSetting?.updatedAt.getTime() ?? 0, items: faqItems };
        // This formatter receives memoized TX snapshots only. Its async ports
        // perform no I/O and never call PrismaPolicyRepository.publicSnapshot,
        // which would open an independent nested transaction.
        const formatter = new PublishedGraphKnowledgeSources({ publicSnapshot: async scope => {
          if (scope !== merchantId) throw new Error("public_evidence_scope_mismatch");return policySnapshot;
        } }, { snapshot: async scope => {
          if (scope !== merchantId) throw new Error("public_evidence_scope_mismatch");return faqSnapshot;
        } });
        for (const identity of legacyRequested.values()) {
          const type = identity.sourceType as "faq" | "policy";
          const document = await formatter.read(merchantId, type, identity.sourceId);
          if (!document) continue;
          const references: LegacyEvidenceSnapshot["references"] = [];
          if (type === "faq") {
            // Parser limits question/answer to3000/4000, so a current complete
            // FAQ text fits the formatter's7500 boundary. Exact equality avoids
            // authorizing a substring of a different or withdrawn public item.
            const publicFaqs = faqItems.map(item => current.get(key({ sourceType: "faq", sourceId: item.id })))
              .filter((source): source is PublicBusinessSourceProjection => Boolean(source && source.publicationState === "published"));
            for (const chunk of document.chunks ?? [])
              for (const source of publicFaqs) if (source.text === chunk.content) references.push({ chunkId: chunk.id, source });
          } else {
            const source = current.get(key(identity));
            if (source?.publicationState === "published")
              for (const chunk of document.chunks ?? []) references.push({ chunkId: chunk.id, source });
          }
          legacy.push({ document, references });
        }
      }
      return { sources, legacy };
    });
  }
}
