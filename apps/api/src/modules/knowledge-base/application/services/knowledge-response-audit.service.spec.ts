import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { RecordAuditEventUseCase } from "../../../audit/application/audit.use-cases.js";
import type { AuditRepository, MerchantAuditEvent } from "../../../audit/domain/ports/audit-repository.port.js";
import { TenantContextService } from "../../../../shared/tenant/tenant-context.service.js";
import type { ValidatedPublicEvidence } from "../../domain/public-source-evidence.js";
import { KnowledgeResponseAuditService, type KnowledgeResponseAuditInput } from "./knowledge-response-audit.service.js";

const sha = (value: string) => createHash("sha256").update(value).digest("hex");
function evidence(sourceId = "faq-one"): ValidatedPublicEvidence {
  return { id: "sql-row-one", content: "PUBLIC-CONTEXT-CANARY", provenance: {
    origin: "legacy_sql", namespace: "canonical-legacy", merchantId: "tenant-a", sourceType: "faq",
    sourceId, sourceVersion: "faq:current", sourceHash: "a".repeat(64), publicWorkVersion: null,
    publicationState: "published", embeddingModel: null, embeddingDimensions: null,
    chunkId: "same-text-chunk", contentHash: sha("PUBLIC-CONTEXT-CANARY"),
  } };
}
function fixture(beforeRecord: () => Promise<void> = async () => {}) {
  const rows: MerchantAuditEvent[] = [];
  const repository: AuditRepository = {
    record: async input => {
      await beforeRecord();
      const event = { ...structuredClone(input), id: "audit-one", occurredAt: "2026-11-16T00:00:00.000Z" };
      rows.push(event);return event;
    },
    list: async () => rows,
  };
  const tenant = new TenantContextService();
  const service = new KnowledgeResponseAuditService(new RecordAuditEventUseCase(repository), tenant);
  const input: KnowledgeResponseAuditInput = { merchantId: "tenant-a", channel: "support",
    finalResponse: "FINAL-ANSWER-CANARY", admission: { status: "ready", evidence: [evidence()] } };
  const run = (value = input) => tenant.run({ merchantId: "tenant-a", role: "buyer", userId: "PRIVATE-BUYER-CANARY",
    buyerGlobalUserId: "PRIVATE-USER-CANARY", embedSessionToken: "PRIVATE-TOKEN-CANARY", correlationId: "correlation-one" },
  () => service.execute(value));
  return { rows, service, input, run, tenant };
}

test("T69", async t => {
  await t.test("exact scalar reference and final response SHA reach the existing audit use case", async () => {
    const f = fixture();await f.run();
    assert.equal(f.rows.length, 1);
    assert.equal(f.rows[0]!.merchantId, "tenant-a");
    assert.equal(f.rows[0]!.actorType, "service");assert.equal(f.rows[0]!.actorId, "knowledge-response");
    assert.equal(f.rows[0]!.correlationId, "correlation-one");
    assert.deepEqual(f.rows[0]!.metadata, { schemaVersion: 1, evidenceRole: "admitted_context", responseStage: "application_reply",
      channel: "support", evidenceStatus: "ready", responseSha256: sha(f.input.finalResponse), references: [evidence().provenance] });
    for (const secret of ["PUBLIC-CONTEXT-CANARY", "FINAL-ANSWER-CANARY", "PRIVATE-BUYER-CANARY", "PRIVATE-USER-CANARY", "PRIVATE-TOKEN-CANARY"])
      assert.equal(JSON.stringify(f.rows).includes(secret), false);
  });
  await t.test("no tenant or foreign caller/evidence is rejected before any audit write", async () => {
    const f = fixture();await assert.rejects(f.service.execute(f.input), /scope_mismatch/);
    await assert.rejects(f.tenant.run({ merchantId: "foreign", userId: "actor", role: "buyer" }, () => f.service.execute(f.input)), /scope_mismatch/);
    const foreign = evidence();foreign.provenance.merchantId = "foreign";
    await assert.rejects(f.run({ ...f.input, admission: { status: "ready", evidence: [foreign] } }), /scope_mismatch/);
    assert.deepEqual(f.rows, []);
  });
  await t.test("allowlist ignores raw metadata, prompt, answer and private order extras", async () => {
    const f = fixture();const item = { ...evidence(), metadata: { private: "RAW-METADATA-CANARY" }, order: "ORDER-CANARY" };
    const provenance = { ...item.provenance, credential: "CREDENTIAL-CANARY" };
    await f.run({ ...f.input, admission: { status: "ready", evidence: [{ ...item, provenance }] } });
    assert.deepEqual(f.rows[0]!.metadata.references, [evidence().provenance]);
    for (const secret of ["RAW-METADATA-CANARY", "ORDER-CANARY", "CREDENTIAL-CANARY"])
      assert.equal(JSON.stringify(f.rows).includes(secret), false);
  });
  await t.test("copy is captured before an awaited audit write and retains no mutable input reference", async () => {
    let release!: () => void;const barrier = new Promise<void>(resolve => { release = resolve; });
    const f = fixture(() => barrier);const item = evidence();
    const pending = f.run({ ...f.input, admission: { status: "ready", evidence: [item] } });
    item.provenance.sourceVersion = "MUTATED-AFTER-CALL";item.provenance.sourceId = "MUTATED-ID";
    release();await pending;
    assert.deepEqual(f.rows[0]!.metadata.references, [evidence().provenance]);
  });
  await t.test("dedup retains two exact FAQ identities sharing text and chunk ID", async () => {
    const f = fixture();await f.run({ ...f.input, admission: { status: "ready", evidence: [evidence("a"), evidence("b"), evidence("a")] } });
    assert.deepEqual(f.rows[0]!.metadata.references, [evidence("a").provenance, evidence("b").provenance]);
  });
  await t.test("public work revision and pinned ABI are copied without changing canonical revision", async () => {
    const f = fixture();const item = evidence();Object.assign(item.provenance, { origin: "public_sql", namespace: "public-business-v1",
      sourceVersion: "canonical:private-edit-newer", publicWorkVersion: "public-v1:00000000000000000009", embeddingModel: "pinned-model", embeddingDimensions: 384 });
    await f.run({ ...f.input, admission: { status: "ready", evidence: [item] } });
    assert.deepEqual(f.rows[0]!.metadata.references, [item.provenance]);
  });
  await t.test("legacy model/work remain null and 21 references are refused rather than silently truncated", async () => {
    const f = fixture();await f.run();assert.deepEqual(f.rows[0]!.metadata.references, [evidence().provenance]);
    await assert.rejects(f.run({ ...f.input, admission: { status: "ready", evidence: Array.from({ length: 21 }, (_, i) => evidence(String(i))) } }), /evidence_limit/);
    assert.equal(f.rows.length, 1);
  });
  await t.test("insufficient/conflicting/unavailable do not become ready or carry references", async () => {
    const f = fixture();
    for (const status of ["insufficient", "conflicting", "unavailable"] as const) {
      await f.run({ ...f.input, admission: { status, evidence: [] } });
      assert.deepEqual(f.rows.at(-1)!.metadata.references, []);assert.equal(f.rows.at(-1)!.metadata.evidenceStatus, status);
      await assert.rejects(f.run({ ...f.input, admission: { status, evidence: [evidence()] } }), /status_mismatch/);
    }
    await assert.rejects(f.run({ ...f.input, admission: { status: "ready", evidence: [] } }), /status_mismatch/);
  });
  await t.test("objects in selected scalar fields cannot leak through an unsafe metadata cast", async () => {
    const f = fixture();const malformed = { ...evidence().provenance, sourceHash: { private: "HASH-CANARY" } };
    const item = { ...evidence(), provenance: malformed } as unknown as ValidatedPublicEvidence;
    await assert.rejects(f.run({ ...f.input, admission: { status: "ready", evidence: [item] } }), /reference_invalid/);
    assert.deepEqual(f.rows, []);
  });
  await t.test("audit persistence failure is awaited and propagated, never converted into a success", async () => {
    const f = fixture(async () => { throw Error("synthetic_owned_audit_failure"); });
    await assert.rejects(f.run(), /synthetic_owned_audit_failure/);assert.deepEqual(f.rows, []);
  });
  await t.test("legacy graph document proof is audited separately from the individual canonical source", async () => {
    const f = fixture();const item = evidence("individual-faq");
    Object.assign(item.provenance, { origin: "legacy_graph", embeddingModel: "pinned-model", embeddingDimensions: 384 });
    const proof = { kind: "legacy-graph-retrieval", merchantId: "tenant-a", sourceType: "faq", sourceId: "faq-collection",
      sourceVersion: 123, sourceHash: "c".repeat(64), embeddingModel: "pinned-model", embeddingDimensions: 384,
      chunkId: item.provenance.chunkId, contentHash: item.provenance.contentHash, projectedAt: 456 } as const;
    item.retrieval = { ...proof, privateToken: "RETRIEVAL-PRIVATE-CANARY" } as typeof proof;
    await f.run({ ...f.input, admission: { status: "ready", evidence: [item, item] } });
    assert.deepEqual(f.rows[0]!.metadata.references, [item.provenance]);
    assert.deepEqual(f.rows[0]!.metadata.retrievalReferences, [proof]);
    assert.equal(JSON.stringify(f.rows).includes("RETRIEVAL-PRIVATE-CANARY"), false);
    assert.equal((f.rows[0]!.metadata.references as any[])[0].sourceVersion, "faq:current");
    assert.equal((f.rows[0]!.metadata.retrievalReferences as any[])[0].sourceVersion, 123);
  });
  await t.test("foreign or mismatched retrieval proof cannot donate an audit identity", async () => {
    const f = fixture();const item = evidence();
    Object.assign(item.provenance, { origin: "legacy_graph", embeddingModel: "pinned-model", embeddingDimensions: 384 });
    item.retrieval = { kind: "legacy-graph-retrieval", merchantId: "foreign", sourceType: "faq", sourceId: "faq-collection",
      sourceVersion: 123, sourceHash: "c".repeat(64), embeddingModel: "pinned-model", embeddingDimensions: 384,
      chunkId: item.provenance.chunkId, contentHash: item.provenance.contentHash, projectedAt: 456 };
    await assert.rejects(f.run({ ...f.input, admission: { status: "ready", evidence: [item] } }), /retrieval_reference_invalid/);
    assert.deepEqual(f.rows, []);
  });
});
