import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { once } from "node:events";
import neo4j from "neo4j-driver";
import { Neo4jGraphAdapter } from "../src/modules/graph-rag/infrastructure/neo4j-graph.adapter.ts";
import { GraphLocalEmbeddingService } from "../src/modules/graph-rag/infrastructure/graph-local-embedding.service.ts";
import { GraphProjectionService, GRAPH_SCHEMA_STATEMENTS } from "../src/modules/graph-rag/application/graph-projection.service.ts";
import { GraphRetrievalService } from "../src/modules/graph-rag/application/graph-retrieval.service.ts";
import { CommunityReadEngine } from "../src/modules/graph-rag/gateway/community-read-engine.ts";
import { createQueryGateway } from "../src/modules/graph-rag/gateway/query-gateway.ts";
import { CommunityGatewayAdapter } from "../src/modules/graph-rag/infrastructure/community-gateway.adapter.ts";
import { GraphCatalogSearch } from "../src/modules/catalog/infrastructure/graph-catalog-search.ts";
import { matchesCatalogVariant } from "../src/modules/catalog/domain/services/catalog-search-criteria.ts";
import { GraphKnowledgeReader } from "../src/modules/knowledge-base/infrastructure/graph-knowledge.reader.ts";

// No environment connection string, commercial database, buyer or order is used.
// This runner owns a fresh, loopback-only disposable engine and only that engine.
if (process.argv.slice(2).join(" ") !== "--local-disposable") throw Error("explicit_local_disposable_mode_required");
const image = "neo4j:5.26-community@sha256:249a1ec6e3c52d82101a5ed33d6ed2b5ed5b0017b21a28c0bfebc335e87fb177";
const runId = randomUUID(), name = `zyon-graph-proof-${runId}`, password = randomBytes(32).toString("hex");
const label = `graph-rag-${runId}`;
const docker = (args, options = {}) => {
  const result = spawnSync("docker", args, { encoding: "utf8", timeout: 120_000, windowsHide: true, ...options });
  if (result.status !== 0) throw Error("disposable_docker_operation_failed");
  return result.stdout.trim();
};
let container, adapter, admin, proof, gateway, queryClient;
const started = Date.now();
const recordProof = value => writeFileSync(new URL("../../../.specs/features/graph-rag-cypher/integration-proof.json", import.meta.url), JSON.stringify(value, null, 2) + "\n");
recordProof({ passed: false, state: "running", observedAt: new Date().toISOString() });
try {
  container = docker(["run", "--detach", "--rm", "--name", name, "--label", `com.zyon.qa=${label}`,
    "--publish", "127.0.0.1::7687", "--memory", "1g", "--cpus", "2", "--env", "NEO4J_AUTH",
    "--env", "NEO4J_server_memory_heap_initial__size=256m", "--env", "NEO4J_server_memory_heap_max__size=512m",
    "--env", "NEO4J_server_memory_pagecache_size=128m", image], { env: { ...process.env, NEO4J_AUTH: `neo4j/${password}` } });
  const binding = docker(["port", container, "7687/tcp"]);
  assert.match(binding, /^127\.0\.0\.1:\d+$/);
  const uri = `bolt://${binding}`;
  admin = neo4j.driver(uri, neo4j.auth.basic("neo4j", password), { connectionTimeout: 1000, maxTransactionRetryTime: 0 });
  let connected = false;
  for (let attempt = 0; attempt < 90; attempt++) {
    try { await admin.verifyConnectivity();connected = true;break; } catch { await new Promise(resolve => setTimeout(resolve, 1000)); }
  }
  assert.equal(connected, true, "isolated Neo4j did not become ready");
  const session = admin.session();
  let engine;
  try {
    engine = (await session.run("CALL dbms.components() YIELD name, versions, edition RETURN name, versions, edition")).records[0].toObject();
    for (const statement of GRAPH_SCHEMA_STATEMENTS) await session.run(statement);
  } finally { await session.close(); }
  const settings = { enabled: true, merchantIds: ["fixture-shop-a", "fixture-shop-b"], uri, database: "neo4j",
    readUser: "neo4j", readPassword: password, writeUser: "neo4j", writePassword: password, production: false, timeoutMs: 10_000 };
  adapter = new Neo4jGraphAdapter(settings);
  // This administrative loopback credential is only a test fixture. It is
  // deliberately rejected by the same adapter when production=true.
  const production = new Neo4jGraphAdapter({ ...settings, production: true });
  try { assert.equal(await production.admitReader(), false); } finally { await production.close(); }
  const embedding = new GraphLocalEmbeddingService();
  const projection = new GraphProjectionService(adapter, embedding);
  const secret = randomBytes(32).toString("hex"), keyId = "fixture-key";
  gateway = createQueryGateway({ secret, keyId, merchantIds: settings.merchantIds }, new CommunityReadEngine({ uri,
    user: "neo4j", password, database: "neo4j", merchantIds: settings.merchantIds }));
  gateway.server.listen(0, "127.0.0.1");await once(gateway.server, "listening");
  const queryUri = `http://127.0.0.1:${gateway.server.address().port}`;
  queryClient = new CommunityGatewayAdapter({ ...settings, queryMode: "community_gateway", queryGateway: { uri: queryUri, secret, keyId } }, adapter);
  assert.equal(await queryClient.admitReader(), true);
  const retrieval = new GraphRetrievalService({ enabled: true, merchantIds: settings.merchantIds,
    timeoutMs: 60_000, maxAgeMs: 300_000, threshold: 0.65 }, embedding, queryClient);
  const version = Date.now();
  const care = merchantId => ({ kind: "catalog", merchantId, id: "p-care", version, active: true,
    name: "Creme reparador", description: "Hidratacao e protecao da barreira cutanea contra o ressecamento",
    category: { id: "skin", name: "Cuidados com a pele" }, variants: [
      { id: "v-care", sku: "care", active: true, attributes: { fragrancia: "nao" } },
      { id: "v-unknown", sku: "unknown", active: true, attributes: {} }] });
  const tech = { kind: "catalog", merchantId: "fixture-shop-a", id: "p-tech", version, active: true,
    name: "Organizador de cabos", description: "Kit de cabos de computador para viagens",
    variants: [{ id: "v-tech", sku: "tech", active: true, attributes: {} }] };
  for (const source of [care("fixture-shop-a"), care("fixture-shop-b"), tech]) {
    assert.equal((await projection.projectCatalog(source)).status, "applied");
  }
  assert.equal((await projection.projectCatalog(care("fixture-shop-a"))).status, "applied");
  const query = "Quero restaurar a barreira da minha pele e reduzir o ressecamento";
  const found = await retrieval.searchCatalog({ merchantId: "fixture-shop-a", query, categoryId: "skin",
    attributes: [{ name: "fragrancia", value: "sim", operator: "not_equals" }] });
  assert.equal(found.status, "ready");assert.equal(found.partial, true);
  assert.deepEqual(found.hits.map(hit => hit.variantId), ["v-care"]);
  assert.ok(found.hits.every(hit => hit.merchantId === "fixture-shop-a" && hit.modelId === embedding.modelId));
  // Actual application readers consume real signed HTTP/Neo4j candidates.
  // The canonical ports below are synthetic current snapshots, not PostgreSQL.
  let currentProduct = care("fixture-shop-a"), stock = 2, price = 3000, canonicalReads = 0;
  const catalogReader = new GraphCatalogSearch(retrieval, { read: async (merchant, id) => {
    assert.equal(merchant, "fixture-shop-a");assert.equal(id, "p-care");return currentProduct;
  } });
  const catalogInput = { merchantId: "fixture-shop-a", query, categoryId: "skin", queryMode: "contextual",
    allowSemantic: true, inStockOnly: true, currency: "BRL", minPriceCents: 2000, maxPriceCents: 10000,
    attributes: [{ name: "fragrancia", value: "sim", operator: "not_equals" }] };
  const canonicalCatalog = async input => {
    canonicalReads++;
    if (!input.candidateVariantIds) return { products: [], total: 0 };
    assert.deepEqual(input.candidateVariantIds, ["v-care"]);
    for (const key of ["merchantId", "categoryId", "inStockOnly", "currency", "minPriceCents", "maxPriceCents", "attributes"])
      assert.deepEqual(input[key], catalogInput[key]);
    assert.equal(input.query, undefined);
    const variants = [{ id: "v-care", isActive: true, currency: "BRL", basePriceInCents: price,
      stockQuantity: stock, stockReserved: 0, attributes: { fragrancia: "nao" } },
    { id: "v-unknown", isActive: true, currency: "BRL", basePriceInCents: 3000,
      stockQuantity: 2, stockReserved: 0, attributes: {} }]
      .filter(variant => matchesCatalogVariant(variant, input, "physical"));
    return { products: variants.length ? [{ id: "p-care", variants }] : [], total: variants.length ? 1 : 0 };
  };
  const canonicalFound = await catalogReader.search(catalogInput, canonicalCatalog);
  assert.deepEqual(canonicalFound.products.map(product => product.variants.map(variant => variant.id)), [["v-care"]]);
  assert.deepEqual(canonicalFound.retrieval, { engine: "neo4j", match: "semantic", partial: true });
  stock = 0;assert.deepEqual((await catalogReader.search(catalogInput, canonicalCatalog)).products, []);
  stock = 2;price = 10001;assert.deepEqual((await catalogReader.search(catalogInput, canonicalCatalog)).products, []);
  price = 3000;
  for (const snapshot of [null, { ...care("fixture-shop-a"), version: version + 1 },
    { ...care("fixture-shop-a"), name: "Changed current name" }, { ...care("fixture-shop-a"), active: false }]) {
    currentProduct = snapshot;const before = canonicalReads;
    assert.deepEqual(await catalogReader.search(catalogInput, canonicalCatalog), { products: [], total: 0 });
    assert.equal(canonicalReads, before + 1, "unverified candidates must not reach the second canonical query");
  }
  const foreign = await retrieval.searchCatalog({ merchantId: "fixture-shop-c", query });
  assert.deepEqual(foreign, { status: "unavailable", reason: "disabled" });
  const faq = { kind: "knowledge", merchantId: "fixture-shop-a", sourceType: "faq", id: "faq-collection", version,
    active: true, chunks: [{ id: "returns", content: "Voce pode devolver seu produto em sete dias apos receber a compra." }] };
  assert.equal((await projection.projectDocument(faq)).status, "applied");
  const documents = await retrieval.searchKnowledge({ merchantId: "fixture-shop-a", query: "Posso devolver o produto depois de receber?" });
  assert.equal(documents.status, "ready");assert.equal(documents.hits[0]?.sourceId, "faq-collection");
  let currentKnowledge = faq;
  const knowledgeReader = new GraphKnowledgeReader(retrieval, { read: async (merchant, type, id) => {
    assert.equal(merchant, "fixture-shop-a");assert.equal(type, "faq");assert.equal(id, "faq-collection");return currentKnowledge;
  } });
  const knowledgeInput = { merchantId: "fixture-shop-a", queryText: "Posso devolver o produto depois de receber?" };
  const currentChunks = await knowledgeReader.search(knowledgeInput);
  assert.equal(currentChunks.length, 1);assert.equal(currentChunks[0].content, faq.chunks[0].content);
  for (const snapshot of [null, { ...faq, active: false }, { ...faq, version: version + 1 },
    { ...faq, merchantId: "fixture-shop-b" }, { ...faq, chunks: [{ id: "returns", content: "Changed public terms" }] }]) {
    currentKnowledge = snapshot;assert.deepEqual(await knowledgeReader.search(knowledgeInput), []);
  }
  const tombstone = { kind: "catalog", merchantId: "fixture-shop-a", id: "p-care", version: version + 1, active: false };
  assert.equal((await projection.projectCatalog(tombstone)).status, "applied");
  assert.equal((await projection.projectCatalog(care("fixture-shop-a"))).status, "ignored");
  assert.equal((await projection.projectCatalog({ ...care("fixture-shop-a"), version: tombstone.version })).status, "ignored");
  const documentTombstone = { ...faq, version: version + 1, active: false, chunks: [] };
  assert.equal((await projection.projectDocument(documentTombstone)).status, "applied");
  assert.equal((await projection.projectDocument({ ...faq, version: documentTombstone.version })).status, "ignored");
  const removedDocument = await retrieval.searchKnowledge({ merchantId: "fixture-shop-a", query: "Posso devolver?" });
  assert.equal(removedDocument.status, "ready");assert.deepEqual(removedDocument.hits, []);
  const after = await retrieval.searchCatalog({ merchantId: "fixture-shop-a", query, categoryId: "skin" });
  assert.equal(after.status, "ready");assert.deepEqual(after.hits, []);
  const other = await retrieval.searchCatalog({ merchantId: "fixture-shop-b", query, categoryId: "skin" });
  assert.equal(other.status, "ready");assert.ok(other.hits.length > 0);
  // Reconciliation has its own snapshot boundary: it must keep newer sources.
  await projection.retireMissingCatalog("fixture-shop-b", [], version - 1);
  assert.ok((await retrieval.searchCatalog({ merchantId: "fixture-shop-b", query })).hits.length > 0);
  await projection.retireMissingCatalog("fixture-shop-b", [], Date.now());
  assert.deepEqual((await retrieval.searchCatalog({ merchantId: "fixture-shop-b", query })).hits, []);
  proof = { passed: true, observedAt: new Date().toISOString(), engine,
    model: embedding.modelId, dimensions: embedding.dimensions, durationMs: Date.now() - started,
    checks: ["real multilingual inference", "signed HTTP admission and nonce-bound responses", "tenant-first scoped Cypher", "same-variant negative attribute",
      "current canonical port fixtures reject out-of-stock, over-budget and changed product candidates",
      "current public knowledge port rejects changed, revoked, foreign and removed sources",
      "FAQ vector retrieval", "duplicate projection", "tombstone rejects old and conflicting same-version upsert", "document equal-version tombstone", "other tenant retained",
      "complete enumeration retirement", "newer versions retained", "production administrative credential rejected"],
    scope: "Real disposable Neo4j, signed HTTP and application readers with synthetic canonical port fixtures. No real PostgreSQL engine, commerce writes or production-channel acceptance." };
} catch (error) {
  recordProof({ passed: false, observedAt: new Date().toISOString(), error: error instanceof Error ? error.message : "unknown_test_failure" });
  throw error;
} finally {
  await queryClient?.close();await gateway?.close();
  await Promise.allSettled([adapter?.close(), admin?.close()]);
  if (container) {
    const owned = JSON.parse(docker(["inspect", container]))[0];
    assert.equal(owned.Id, container);assert.equal(owned.Config.Labels["com.zyon.qa"], label);
    docker(["stop", "--time", "5", container]);
  }
}
recordProof(proof);
console.log(JSON.stringify(proof));
