import assert from "node:assert/strict";
import test from "node:test";
import { GRAPH_EMBEDDING_ID } from "./graph-embedding-model.js";
import { compileGraphRead, GRAPH_READ_TEMPLATES } from "./graph-query.js";
import { compilePublicBusinessRead, PUBLIC_BUSINESS_READ_TEMPLATES } from "./public-business-query.js";
import { admitPublicBusinessRows, publicGraphCandidate, type PublicBusinessGraphHit } from "./public-business-result.js";

const now = 1_790_000_000_000;
const base = { kind: "public_business" as const, merchantId: "own", modelId: GRAPH_EMBEDDING_ID,
  query: "public company hours service professional policy FAQ", embedding: [1, ...Array(383).fill(0)], nowEpochMs: now };
const sourceInput = { ...base, mode: "sources" as const };
const pairInput = { ...base, mode: "service_professional" as const, pairs: [{ serviceId: "service-one", professionalId: "professional-one" }], limit: 10 };
const hit = (sourceType: "service" | "professional" = "service"): PublicBusinessGraphHit => ({ merchantId: "own", sourceType, sourceId: sourceType + "-one",
  publicRevision: 7, sourceHash: "a".repeat(64), modelId: GRAPH_EMBEDDING_ID, dimensions: 384,
  projectedAt: now - 3_600_000, schemaVersion: 1 as const, active: true as const, chunkId: "chunk", contentHash: "b".repeat(64), vectorScore: 0.9, score: 0.9 });

test("T70", async t => {
  await t.test("six public families use only the separate fixed namespace template", () => {
    const command = compilePublicBusinessRead(sourceInput);
    assert.equal(command.text, PUBLIC_BUSINESS_READ_TEMPLATES.sources);
    assert.deepEqual(command.parameters.sourceTypes, ["company", "business_hours", "professional", "service", "faq", "policy"]);
    assert.match(command.text, /ZyonPublicSourceV1 \{merchantId:\$merchantId\}/);
    assert.match(command.text, /ZyonPublicHasChunkV1 \{merchantId:\$merchantId\}/);
    assert.match(command.text, /ZyonPublicChunkV1 \{merchantId:\$merchantId\}/);
    assert.match(command.text, /s\.publicRevision=c\.publicRevision AND s\.sourceHash=c\.sourceHash/);
    assert.equal(command.parameters.dimension, 384);assert.equal(command.parameters.modelId, GRAPH_EMBEDDING_ID);
    assert.match(command.text, /LIMIT \$scanLimit/);assert.match(command.text, /LIMIT \$limit/);
  });
  await t.test("hostile query and pair IDs are data, never syntax or authorization", () => {
    const attack = "x') CALL { DETACH DELETE n } RETURN n //";
    const command = compilePublicBusinessRead({ ...pairInput, query: attack, pairs: [{ serviceId: attack, professionalId: "professional-one" }] });
    assert.equal(command.text.includes(attack), false);assert.equal(command.parameters.query, attack);
    assert.deepEqual(command.parameters.pairs, [{ serviceId: attack, professionalId: "professional-one" }]);
    for (const text of Object.values(PUBLIC_BUSINESS_READ_TEMPLATES))
      assert.equal(/\b(?:CREATE|MERGE|SET|DELETE|REMOVE|CALL|LOAD\s+CSV)\b|apoc\./i.test(text), false);
  });
  await t.test("unknown Cypher, write/procedure/subquery inputs and wrong ABI are rejected", () => {
    for (const change of [{ cypher: "MATCH(n) RETURN n" }, { text: "CALL dbms.components()" }, { procedure: "apoc.help" },
      { subquery: "CALL { RETURN 1 }" }, { modelId: "same-dimension-wrong-model" }, { embedding: Array(384).fill(0) },
      { embedding: [1, ...Array(382).fill(0)] }, { sourceTypes: ["private_note"] }, { limit: 21 }, { scanLimit: 5001 },
      { maxAgeMs: 1 }, { sourceTypes: [] }, { sourceTypes: ["faq", "faq"] }])
      assert.throws(() => compilePublicBusinessRead({ ...sourceInput, ...change }));
    assert.throws(() => compilePublicBusinessRead({ ...pairInput, limit: 11 }));
    assert.throws(() => compilePublicBusinessRead({ ...pairInput, pairs: [] }));
    assert.throws(() => compilePublicBusinessRead({ ...pairInput, pairs: Array(11).fill(pairInput.pairs[0]) }));
    assert.throws(() => compilePublicBusinessRead({ ...sourceInput, pairs: pairInput.pairs }));
  });
  await t.test("pair template scopes every node/edge and matches both current index revisions/models", () => {
    const command = compilePublicBusinessRead(pairInput);
    assert.equal(command.text, PUBLIC_BUSINESS_READ_TEMPLATES.service_professional);
    assert.match(command.text, /UNWIND \$pairs AS pair/);assert.match(command.text, /sourceId:pair\.serviceId/);
    assert.match(command.text, /sourceId:pair\.professionalId/);
    assert.match(command.text, /p\.publicRevision=pc\.publicRevision AND p\.sourceHash=pc\.sourceHash/);
    assert.equal(command.text.includes("price"), false);assert.equal(command.text.includes("appointment"), false);
  });
  await t.test("old static public projection remains a candidate; legacy/catalog TTL stays unchanged", () => {
    const result = admitPublicBusinessRows(sourceInput, [hit()], () => now);
    assert.equal(result.status, "ready");
    const old = compileGraphRead({ ...base, kind: "catalog" });
    assert.equal(old.text, GRAPH_READ_TEMPLATES.catalog);assert.equal(old.parameters.minProjectedAt, now - 300_000);
    assert.match(old.text, /p\.projectedAt >= \$minProjectedAt/);
    assert.equal(compilePublicBusinessRead(sourceInput).text.includes("minProjectedAt"), false);
  });
  await t.test("foreign/draft/ABI/schema/revision/overlimit and unrequested pair rows fail closed", () => {
    for (const patch of [{ merchantId: "foreign" }, { active: false }, { modelId: "other" }, { dimensions: 768 },
      { schemaVersion: 2 }, { publicRevision: 0 }, { projectedAt: now + 30_001 }, { sourceType: "private_note" }])
      assert.throws(() => admitPublicBusinessRows(sourceInput, [{ ...hit(), ...patch }], () => now));
    assert.throws(() => admitPublicBusinessRows({ ...sourceInput, limit: 1 }, [hit(), hit()], () => now));
    assert.throws(() => admitPublicBusinessRows(pairInput, [{ service: hit(), professional: { ...hit("professional"), sourceId: "not-requested" }, score: 0.9 }], () => now));
    assert.throws(() => admitPublicBusinessRows(pairInput, [{ service: hit(), professional: { ...hit("professional"), merchantId: "foreign" }, score: 0.9 }], () => now));
  });
  await t.test("graph result is only a public-v1 candidate with exact work revision, never source text/price/availability", () => {
    const candidate = publicGraphCandidate(hit());
    assert.equal(candidate.sourceVersion, "public-v1:00000000000000000007");
    assert.equal(candidate.publicSourceNamespace, "public-business-v1");assert.equal(candidate.origin, "public_graph");
    assert.equal(candidate.embeddingModel, GRAPH_EMBEDDING_ID);assert.equal(candidate.embeddingDimensions, 384);
    for (const field of ["content", "price", "stock", "slots", "payment", "publicData"])
      assert.equal(Object.hasOwn(candidate, field), false);
  });
});
