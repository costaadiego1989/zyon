import assert from "node:assert/strict";
import test from "node:test";
import { QueryKnowledgeUseCase } from "./query-knowledge.use-case.js";
import { createHash } from "node:crypto";
import { GraphKnowledgeReader } from "../../infrastructure/graph-knowledge.reader.js";
import { RevalidatePublicSourceService } from "./revalidate-public-source.service.js";
import { projectPublicBusinessSource } from "../../../graph-rag/domain/public-business-source.js";
import { documentProjectionHash } from "../../../graph-rag/application/graph-projection.service.js";
import { GRAPH_EMBEDDING_ID } from "../../../graph-rag/domain/graph-embedding-model.js";
import { SendSupportMessageUseCase } from "../../../support/application/send-support-message.use-case.js";
import { KnowledgeResponseAuditService } from "../services/knowledge-response-audit.service.js";
import { RecordAuditEventUseCase } from "../../../audit/application/audit.use-cases.js";
import type { AuditRepository, MerchantAuditEvent } from "../../../audit/domain/ports/audit-repository.port.js";
import { TenantContextService } from "../../../../shared/tenant/tenant-context.service.js";
import type { GraphRetrievalPort } from "../../../graph-rag/domain/graph-rag.port.js";
import type { KnowledgeRepositoryPort } from "../../domain/ports/knowledge-repository.port.js";
import type { SupportHandoffService } from "../../../support/application/support-handoff.service.js";

function reference(sourceId: string) { return { origin: "legacy_sql", namespace: "canonical-legacy", merchantId: "own",
  sourceType: "faq", sourceId, sourceVersion: "current", sourceHash: "a".repeat(64), publicWorkVersion: null,
  publicationState: "published", embeddingModel: null, embeddingDimensions: null,
  chunkId: "same-text-chunk", contentHash: "b".repeat(64) } as const; }

test("T69 shared chunks retain every admitted source without raw storage metadata", async t => {
  await t.test("text dedup keeps two current FAQ identities and snapshots their scalar provenance", async () => {
    const evidence = ["a", "b"].map(id => ({ id: "same-text-chunk", content: "Same published answer.", provenance: { ...reference(id) } }));
    const query = new QueryKnowledgeUseCase({ isAvailable: () => true, generate: async () => [1] },
      { similaritySearch: async () => [{ id: "raw", merchantId: "own", sourceType: "faq", sourceId: "faq-collection", content: "Same published answer.", metadata: { private: "RAW_PRIVATE_CANARY" } }] } as any,
      undefined, undefined, { revalidateLegacy: async () => ({ status: "ready", evidence }) } as any);
    const result = await query.execute({ merchantId: "own", queryText: "Pergunta" });
    assert.equal(result.chunks.length, 1);
    assert.deepEqual((result.chunks[0] as any).provenance, [reference("a"), reference("b")]);
    assert.equal(JSON.stringify(result).includes("RAW_PRIVATE_CANARY"), false);
    evidence[0]!.provenance.sourceId = "MUTATED";
    assert.equal((result.chunks[0] as any).provenance[0].sourceId, "a");
    assert.equal((result.chunks[0] as any).provenance[0].embeddingModel, null);
  });
  await t.test("new public families propagate their exact canonical proof without becoming product/config evidence", async () => {
    const evidence = ["company", "business_hours", "professional", "service"].map((type, i) => ({ id: "public-" + i,
      content: "Published " + type, provenance: { ...reference(type), sourceType: type, namespace: "public-business-v1",
        origin: "public_sql", publicWorkVersion: "public-v1:00000000000000000001", embeddingModel: "pinned", embeddingDimensions: 384 } }));
    const query = new QueryKnowledgeUseCase({ isAvailable: () => true, generate: async () => [1] },
      { similaritySearch: async () => [] } as any, undefined, undefined,
      { revalidateLegacy: async () => ({ status: "ready", evidence }) } as any);
    const result = await query.execute({ merchantId: "own", queryText: "Pergunta" });
    assert.deepEqual(result.chunks.map(chunk => chunk.sourceType), ["company", "business_hours", "professional", "service"]);
    for (let i = 0; i < evidence.length; i++) assert.deepEqual((result.chunks[i] as any).provenance, [evidence[i]!.provenance]);
  });
});

test("T69 graph-to-support composition retains canonical and retrieval identities through the actual audit use case", async () => {
  const sha = (value: string) => createHash("sha256").update(value).digest("hex");
  const merchantId = "own", question = "Hours?", answer = "9-12.", content = "P: " + question + "\nR: " + answer;
  const chunkId = sha("faq-collection\0" + content);
  const document = { kind: "knowledge" as const, merchantId, id: "faq-collection", sourceType: "faq" as const,
    version: 123, active: true, chunks: [{ id: chunkId, content }] };
  const sources = ["faq-one", "faq-two"].map(sourceId => projectPublicBusinessSource(merchantId, {
    merchantId, sourceType: "faq", sourceId, sourceVersion: "canonical:" + sourceId, publicationState: "published",
    row: { question, answer },
  }));
  const graph = { enabledFor: () => true, searchKnowledge: async () => ({ status: "ready", partial: true, hits: [{
    merchantId, sourceType: "faq", sourceId: "faq-collection", sourceVersion: 123, sourceHash: documentProjectionHash(document),
    modelId: GRAPH_EMBEDDING_ID, projectedAt: 456, chunkId, contentHash: sha(content), vectorScore: 0.9, score: 0.9,
  }] }) } as unknown as GraphRetrievalPort;
  const reader = new GraphKnowledgeReader(graph, { read: async () => document, list: async () => [] });
  const tenant = new TenantContextService();
  const canonical = new RevalidatePublicSourceService({
    assertScope: id => { assert.equal(id, merchantId);assert.equal(tenant.get()?.merchantId, merchantId); },
    read: async () => ({ sources: [], legacy: [{ document, references: sources.map(source => ({ chunkId, source })) }] }),
  });
  const query = new QueryKnowledgeUseCase({ isAvailable: () => false, generate: async () => { throw Error("unexpected_sql_embedding"); } },
    { similaritySearch: async () => { throw Error("unexpected_sql_fallback"); } } as unknown as KnowledgeRepositoryPort,
    undefined, reader, canonical);
  const rows: MerchantAuditEvent[] = [];
  const repository: AuditRepository = { record: async value => {
    const row = { ...structuredClone(value), id: "audit", occurredAt: "2026-11-16T00:00:00.000Z" };rows.push(row);return row;
  }, list: async () => rows };
  const audit = new KnowledgeResponseAuditService(new RecordAuditEventUseCase(repository), tenant);
  const reply = "O atendimento funciona das 9h as 12h.";
  let prompt = "";
  const support = new SendSupportMessageUseCase({ complete: async messages => { prompt = messages[0]!.content;return reply; } },
    { createHandoff: async () => { throw Error("unexpected_handoff"); } } as unknown as SupportHandoffService,
    query, undefined, audit);
  const result = await tenant.run({ merchantId, userId: "visitor:private-canary", role: "buyer", correlationId: "correlation-composed" },
    () => support.execute({ merchant_id: merchantId, message: "Qual o horario?" }));
  assert.deepEqual(result, { reply, safe: true });
  assert.equal(prompt.split(content).length - 1, 1, "agreeing FAQ text appears only once in the model context");
  assert.equal(rows.length, 1);assert.equal(rows[0]!.merchantId, merchantId);assert.equal(rows[0]!.correlationId, "correlation-composed");
  assert.deepEqual(rows[0]!.metadata, {
    schemaVersion: 1, evidenceRole: "admitted_context", responseStage: "application_reply", channel: "support",
    evidenceStatus: "ready", responseSha256: sha(reply),
    references: sources.map(source => ({ origin: "legacy_graph", namespace: "canonical-legacy", merchantId,
      sourceType: "faq", sourceId: source.sourceId, sourceVersion: source.sourceVersion, sourceHash: source.sourceHash,
      publicWorkVersion: null, publicationState: "published", embeddingModel: GRAPH_EMBEDDING_ID, embeddingDimensions: 384,
      chunkId, contentHash: sha(content) })),
    retrievalReferences: [{ kind: "legacy-graph-retrieval", merchantId, sourceType: "faq", sourceId: "faq-collection",
      sourceVersion: 123, sourceHash: documentProjectionHash(document), embeddingModel: GRAPH_EMBEDDING_ID,
      embeddingDimensions: 384, chunkId, contentHash: sha(content), projectedAt: 456 }],
  });
  for (const secret of [content, reply, "visitor:private-canary"]) assert.equal(JSON.stringify(rows).includes(secret), false);
  assert.equal(tenant.get(), null);
});
