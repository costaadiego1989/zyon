import test from "node:test";
import assert from "node:assert/strict";
import { compileGraphRead, GRAPH_VECTOR_DIMENSIONS, normalizeGraphText } from "./graph-query.js";
import { admitGraphRows } from "./graph-result.js";
import { gatewayReadEnvelope, GRAPH_TEMPLATE_HASH, GRAPH_PREVIOUS_TEMPLATE_HASH } from "../gateway/query-protocol.js";

const vector = Array.from({ length: 384 }, (_, i) => i === 0 ? 1 : 0);
const input = { kind: "catalog", merchantId: "merchant-a", query: "cuidado para a pele", modelId: "multilingual-v1",
  embedding: vector, nowEpochMs: 1_790_000_000_000 };

test("merchant help compiles fixed scoped cashback traversal without accepting syntax", () => {
  const attack = "cashback' MATCH (n) DELETE n";
  const command = compileGraphRead({ ...input, kind: "merchant_help", context: "cashback", query: attack });
  for (const label of ["ZyonGraphMerchantGuide", "ZyonGraphHasGuideChunk", "ZyonGraphMerchantGuideChunk"])
    assert.ok(command.text.includes(`${label} {merchantId: $merchantId, audience: $audience, context: $context}`));
  assert.equal(command.parameters.audience, "merchant"); assert.equal(command.parameters.context, "cashback");
  assert.equal(command.parameters.sourceType, "merchant_guide"); assert.equal(command.parameters.query, attack);
  assert.ok(!command.text.includes(attack));
  assert.match(command.text, /c\.sourceVersion = d\.sourceVersion/);
  assert.match(command.text, /c\.sourceHash = d\.sourceHash/);
});
test("merchant help rejects caller scope syntax and cross-context DTOs", () => {
  const help = { ...input, kind: "merchant_help", context: "cashback" };
  for (const patch of [{ context: "meta_ads" }, { context: undefined }, { audience: "buyer" },
    { sourceType: "faq" }, { cypher: "RETURN 1" }, { merchantId: "" }])
    assert.throws(() => compileGraphRead({ ...help, ...patch }));
});
test("merchant help result admission requires scoped typed current identities", () => {
  const help = { ...input, kind: "merchant_help", context: "cashback" };
  const hit = { merchantId: "merchant-a", audience: "merchant", context: "cashback", sourceType: "merchant_guide",
    sourceId: "cashback-use", chunkId: "cashback-use-main", sourceHash: "a".repeat(64), contentHash: "b".repeat(64),
    sourceVersion: 1, modelId: input.modelId, projectedAt: input.nowEpochMs, vectorScore: 1, score: 1 };
  assert.deepEqual(admitGraphRows(help, [hit], () => input.nowEpochMs), { status: "ready", kind: "merchant_help", hits: [hit], partial: true });
  for (const patch of [{ merchantId: "merchant-b" }, { audience: "buyer" }, { context: "meta_ads" },
    { sourceType: "faq" }, { sourceHash: "wrong" }, { projectedAt: input.nowEpochMs - 300001 }])
    assert.throws(() => admitGraphRows(help, [{ ...hit, ...patch }], () => input.nowEpochMs));
});
test("merchant guides cannot be admitted as public buyer knowledge", () => {
  const hit = { merchantId: input.merchantId, sourceType: "merchant_guide", sourceId: "cashback-use", chunkId: "main",
    sourceHash: "a".repeat(64), contentHash: "b".repeat(64), sourceVersion: 1, modelId: input.modelId,
    projectedAt: input.nowEpochMs, vectorScore: 1, score: 1 };
  assert.throws(() => admitGraphRows({ ...input, kind: "knowledge" }, [hit], () => input.nowEpochMs));
});
test("gateway permits merchant help only under the current signed template capability", () => {
  const help = { ...input, kind: "merchant_help", context: "cashback" };
  assert.equal(gatewayReadEnvelope.safeParse({ protocol: 1, templateHash: GRAPH_TEMPLATE_HASH, input: help }).success, true);
  assert.equal(gatewayReadEnvelope.safeParse({ protocol: 1, templateHash: GRAPH_PREVIOUS_TEMPLATE_HASH, input: help }).success, false);
  assert.equal(gatewayReadEnvelope.safeParse({ protocol: 1, templateHash: "0".repeat(64), input: help }).success, false);
});

test("GRAPH-01 bounded OR groups compile into tenant-scoped fixed Cypher with data-only parameters", () => {
  const hostile = "azul' }) detach delete n //";
  const groups = [[{ name: "CÓR", value: hostile, operator: "equals" }, { name: "cor", value: "Vérde", operator: "equals" }]];
  const command = compileGraphRead({ ...input, attributeAnyOf: groups });
  assert.match(command.text, /all\(alternatives IN \$attributeAnyOf WHERE any\(criterion IN alternatives WHERE EXISTS/);
  assert.ok(!command.text.includes(hostile));
  assert.deepEqual(command.parameters.attributeAnyOf, [[{ name: "cor", value: hostile, operator: "equals" },
    { name: "cor", value: "verde", operator: "equals" }]]);
  for (const attributeAnyOf of [[[]], Array(7).fill(groups[0]), [Array(7).fill(groups[0]![0])]])
    assert.throws(() => compileGraphRead({ ...input, attributeAnyOf }));
});

test("RAG01 parameterized tenant scope", () => {
  const attack = "pele' }) DETACH DELETE n //";
  const command = compileGraphRead({ ...input, query: attack,
    attributes: [{ name: "material' }", value: "algodão", operator: "not_equals" }] });
  assert(!command.text.includes(attack));
  assert(!command.text.includes("material' }"));
  assert.equal(command.parameters.merchantId, "merchant-a");
  assert.equal(command.parameters.modelId, "multilingual-v1");
  assert.equal(command.parameters.query, attack);
  assert.equal(command.parameters.dimension, GRAPH_VECTOR_DIMENSIONS);
  assert.equal(command.parameters.minProjectedAt, input.nowEpochMs - 300_000);
  assert.deepEqual(command.parameters.embedding, vector);
  assert.deepEqual(command.parameters.attributes, [{ name: "material' }", value: "algodao", operator: "not_equals" }]);
  assert.match(command.text, /ZyonGraphProduct \{merchantId: \$merchantId\}/);
  assert.match(command.text, /ZyonGraphHasVariant \{merchantId: \$merchantId\}/);
  assert.match(command.text, /ZyonGraphVariant \{merchantId: \$merchantId\}/);
  assert.match(command.text, /ZyonGraphHasAttribute \{merchantId: \$merchantId\}/);
  assert.match(command.text, /ZyonGraphAttribute \{merchantId: \$merchantId\}/);
  assert.match(command.text, /LIMIT \$scanLimit/);
  assert.match(command.text, /LIMIT \$limit/);
  assert.match(command.text, /vector\.similarity\.cosine/);
  assert(!/\b(?:CREATE|MERGE|SET|DELETE|REMOVE|LOAD CSV|apoc\.)\b/.test(command.text));
});

test("RAG01 invalid contract", () => {
  for (const change of [
    { cypher: "MATCH (n) RETURN n" }, { merchantId: "" }, { embedding: [] },
    { embedding: Array(384).fill(0) }, { embedding: [Infinity, ...vector.slice(1)] },
    { embedding: [...vector.slice(0, 383), NaN] }, { limit: 21 }, { limit: 1.5 },
    { scanLimit: 5001 }, { threshold: -0.1 }, { threshold: 1.1 }, { nowEpochMs: -1 },
    { maxAgeMs: 3_600_001 }, { query: " " }, { query: "a".repeat(2001) },
    { attributes: [{ name: "cor", value: "azul", operator: "contains" }] },
  ]) assert.throws(() => compileGraphRead({ ...input, ...change }), JSON.stringify(change).slice(0, 70));
});

test("knowledge traversal has matching tenant and revision on source, relationship and chunk", () => {
  const command = compileGraphRead({ ...input, kind: "knowledge", query: "prazo para devolução" });
  assert.match(command.text, /ZyonGraphDocument \{merchantId: \$merchantId\}/);
  assert.match(command.text, /ZyonGraphHasChunk \{merchantId: \$merchantId\}/);
  assert.match(command.text, /ZyonGraphChunk \{merchantId: \$merchantId\}/);
  assert.match(command.text, /c\.sourceVersion = d\.sourceVersion/);
  assert.match(command.text, /d\.active = true/);
  assert.deepEqual(command.parameters.sourceTypes, ["faq", "policy"]);
  assert(!command.text.includes("RETURN c.content"));
});

test("negative attributes require a published value on the same scoped variant", () => {
  const command = compileGraphRead({ ...input, categoryId: "skin",
    attributes: [{ name: "perfume", value: "sim", operator: "not_equals" }] });
  assert.match(command.text, /all\(criterion IN \$attributes WHERE EXISTS/);
  assert.match(command.text, /\(v\)-\[:ZyonGraphHasAttribute/);
  assert.match(command.text, /a\.sourceVersion = v\.sourceVersion/);
  assert.match(command.text, /a\.value <> criterion\.value/);
  assert.equal(command.parameters.categoryId, "skin");
  assert.equal(normalizeGraphText("  HIDRATAÇÃO  Facial  "), "hidratacao facial");
});
