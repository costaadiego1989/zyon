import test from "node:test";
import assert from "node:assert/strict";
import { compileGraphRead, GRAPH_VECTOR_DIMENSIONS, normalizeGraphText } from "./graph-query.js";

const vector = Array.from({ length: 384 }, (_, i) => i === 0 ? 1 : 0);
const input = { kind: "catalog", merchantId: "merchant-a", query: "cuidado para a pele", modelId: "multilingual-v1",
  embedding: vector, nowEpochMs: 1_790_000_000_000 };

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
