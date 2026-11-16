import { createHash } from "node:crypto";
import type { RecordAuditEventUseCase } from "../../../audit/application/audit.use-cases.js";
import type { TenantContextService } from "../../../../shared/tenant/tenant-context.service.js";
import type { KnowledgeResponseEvidence, ValidatedPublicEvidence, LegacyKnowledgeRetrievalEvidence } from "../../domain/public-source-evidence.js";
export type { KnowledgeResponseEvidence } from "../../domain/public-source-evidence.js";

type Reference = Readonly<ValidatedPublicEvidence["provenance"]>;
export interface KnowledgeResponseAuditInput {
  readonly merchantId: string;
  readonly channel: "support" | "storefront" | "whatsapp";
  readonly finalResponse: string;
  readonly admission: KnowledgeResponseEvidence;
}

/** Records admitted context for an application reply, not sentence-level
 * grounding, current-at-delivery proof, or successful provider delivery. */
export class KnowledgeResponseAuditService {
  constructor(
    private readonly audit: Pick<RecordAuditEventUseCase, "execute">,
    private readonly tenant: Pick<TenantContextService, "get">,
  ) {}

  async execute(input: Readonly<KnowledgeResponseAuditInput>): Promise<void> {
    const caller = this.tenant.get();
    if (!caller || caller.merchantId !== input.merchantId)
      throw new Error("knowledge_audit_scope_mismatch");
    if (!["support", "storefront", "whatsapp"].includes(input.channel)
      || typeof input.finalResponse !== "string"
      || !["ready", "insufficient", "conflicting", "unavailable"].includes(input.admission.status))
      throw new Error("knowledge_audit_input_invalid");
    if (!Array.isArray(input.admission.evidence) || input.admission.evidence.length > 20)
      throw new Error("knowledge_audit_evidence_limit");

    // Fresh scalar objects: never serialize evidence content, IDs of buyers,
    // arbitrary metadata, prompt text or caller-supplied extra properties.
    const references: Reference[] = [];
    const retrievalReferences: Readonly<LegacyKnowledgeRetrievalEvidence>[] = [];
    const seen = new Set<string>();
    const seenRetrieval = new Set<string>();
    for (const item of input.admission.evidence) {
      const p = item.provenance;
      if (p.merchantId !== input.merchantId || p.publicationState !== "published")
        throw new Error("knowledge_audit_scope_mismatch");
      if (item.retrieval) {
        const r = item.retrieval;
        const proof = Object.freeze({ kind: r.kind, merchantId: r.merchantId, sourceType: r.sourceType, sourceId: r.sourceId,
          sourceVersion: r.sourceVersion, sourceHash: r.sourceHash, embeddingModel: r.embeddingModel,
          embeddingDimensions: r.embeddingDimensions, chunkId: r.chunkId, contentHash: r.contentHash, projectedAt: r.projectedAt });
        const { sourceVersion, embeddingDimensions, projectedAt, ...strings } = proof;
        if (Object.values(strings).some(value => typeof value !== "string" || !value)
          || proof.kind !== "legacy-graph-retrieval" || proof.merchantId !== input.merchantId
          || proof.sourceType !== p.sourceType || proof.chunkId !== p.chunkId || proof.contentHash !== p.contentHash
          || !(proof.sourceType === "faq" && proof.sourceId === "faq-collection" || proof.sourceId === p.sourceId)
          || p.origin !== "legacy_graph" || p.namespace !== "canonical-legacy" || p.publicWorkVersion !== null
          || proof.embeddingModel !== p.embeddingModel || embeddingDimensions !== p.embeddingDimensions
          || !Number.isSafeInteger(sourceVersion) || sourceVersion < 0
          || !Number.isSafeInteger(embeddingDimensions) || embeddingDimensions < 1 || !Number.isFinite(projectedAt))
          throw new Error("knowledge_audit_retrieval_reference_invalid");
        const key = JSON.stringify(proof);
        if (!seenRetrieval.has(key)) { seenRetrieval.add(key);retrievalReferences.push(proof); }
      }
      const reference: Reference = Object.freeze({
        origin: p.origin, namespace: p.namespace, merchantId: p.merchantId,
        sourceType: p.sourceType, sourceId: p.sourceId, sourceVersion: p.sourceVersion,
        sourceHash: p.sourceHash, publicWorkVersion: p.publicWorkVersion,
        publicationState: p.publicationState, embeddingModel: p.embeddingModel,
        embeddingDimensions: p.embeddingDimensions, chunkId: p.chunkId, contentHash: p.contentHash,
      });
      const { publicWorkVersion, embeddingModel, embeddingDimensions, ...strings } = reference;
      if (Object.values(strings).some(value => typeof value !== "string")
        || publicWorkVersion !== null && typeof publicWorkVersion !== "string"
        || embeddingModel !== null && typeof embeddingModel !== "string"
        || embeddingDimensions !== null && (!Number.isSafeInteger(embeddingDimensions) || embeddingDimensions < 1))
        throw new Error("knowledge_audit_reference_invalid");
      const key = JSON.stringify(reference);
      if (!seen.has(key)) { seen.add(key);references.push(reference); }
    }
    if ((input.admission.status === "ready") !== (references.length > 0))
      throw new Error("knowledge_audit_evidence_status_mismatch");

    await this.audit.execute({
      merchantId: input.merchantId,
      actor: { type: "service", id: "knowledge-response" },
      action: "knowledge.response", resourceType: "knowledge",
      ...(caller.correlationId ? { correlationId: caller.correlationId } : {}),
      outcome: "success",
      metadata: Object.freeze({
        schemaVersion: 1, evidenceRole: "admitted_context", responseStage: "application_reply",
        channel: input.channel, evidenceStatus: input.admission.status,
        responseSha256: createHash("sha256").update(input.finalResponse).digest("hex"),
        references: Object.freeze(references),
        ...(retrievalReferences.length ? { retrievalReferences: Object.freeze(retrievalReferences) } : {}),
      }),
    });
  }
}
