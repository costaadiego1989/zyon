// TEST FIRST. Additive tests; all legacy T69 audit tests stay byte-exact.
import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { TenantContextService } from "../../../../shared/tenant/tenant-context.service.js";
import { KnowledgeResponseAuditService, type BusinessAnswerAdmission } from "./knowledge-response-audit.service.js";
import { RecordAuditEventUseCase } from "../../../audit/application/audit.use-cases.js";
import type { CanonicalReadEvidence } from "../../infrastructure/prisma-canonical-public-snapshot-reader.js";
const sha = (text: string) => createHash("sha256").update(text).digest("hex");
const canonical = (): CanonicalReadEvidence => ({ id: "faq-current", content: "PUBLIC-RAW-CANARY", provenance: {
  origin: "canonical_sql", namespace: "canonical-public", merchantId: "own", sourceType: "faq", sourceId: "faq-one",
  sourceVersion: "opaque:current", sourceHash: "a".repeat(64), publicWorkVersion: null, publicationState: "published",
  embeddingModel: null, embeddingDimensions: null, chunkId: "faq-current", contentHash: sha("PUBLIC-RAW-CANARY") } });
test("T71 canonical application audit arm", async t => {
  const tenant = new TenantContextService(), rows: unknown[] = [];
  const audit = new KnowledgeResponseAuditService(new RecordAuditEventUseCase({ record: async input => {
    const row = { ...structuredClone(input), id: "audit-one", occurredAt: "2030-01-01T00:00:00.000Z" }; rows.push(row); return row;
  }, list: async () => [] }), tenant);
  const run = (admission: BusinessAnswerAdmission) => tenant.run({ merchantId: "own", role: "buyer", userId: "PRIVATE-BUYER-CANARY" }, () =>
    audit.execute({ merchantId: "own", channel: "support", finalResponse: "FINAL-RAW-CANARY", admission }));
  await t.test("distinct canonical provenance preserves null work/model/dimensions and only response hash", async () => {
    rows.length = 0; const item = canonical(); await run({ status: "ready", evidence: [item] });
    const serialized = JSON.stringify(rows); for (const raw of ["PUBLIC-RAW-CANARY", "FINAL-RAW-CANARY", "PRIVATE-BUYER-CANARY"]) assert.equal(serialized.includes(raw), false);
    assert.match(serialized, /canonical_sql/); assert.match(serialized, /canonical-public/); assert.ok(serialized.includes(sha("FINAL-RAW-CANARY")));
    assert.ok(serialized.includes('"publicWorkVersion":null')); assert.ok(serialized.includes('"embeddingModel":null')); assert.ok(serialized.includes('"embeddingDimensions":null'));
  });
  await t.test("canonical tags cannot disguise a fake indexed work/model ABI", async () => {
    for (const key of ["publicWorkVersion", "embeddingModel", "embeddingDimensions", "namespace"] as const) {
      rows.length = 0; const item = canonical(); Object.assign(item.provenance, { [key]: key === "embeddingDimensions" ? 384 : "invented-proof" });
      await assert.rejects(run({ status: "ready", evidence: [item] }), /canonical_reference_invalid/); assert.deepEqual(rows, []);
    }
  });
  await t.test("wrong tenant and non-ready-with-evidence fail before audit persistence", async () => {
    rows.length = 0; const item = canonical(); Object.assign(item.provenance, { merchantId: "foreign" });
    await assert.rejects(run({ status: "ready", evidence: [item] }), /scope_mismatch/);
    await assert.rejects(run({ status: "insufficient", evidence: [canonical()] }), /evidence_status_mismatch/); assert.deepEqual(rows, []);
  });
});
