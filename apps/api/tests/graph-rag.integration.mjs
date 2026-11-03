import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import neo4j from "neo4j-driver";
import { Neo4jGraphAdapter } from "../src/modules/graph-rag/infrastructure/neo4j-graph.adapter.ts";
import { GraphLocalEmbeddingService } from "../src/modules/graph-rag/infrastructure/graph-local-embedding.service.ts";
import { GraphProjectionService, GRAPH_SCHEMA_STATEMENTS } from "../src/modules/graph-rag/application/graph-projection.service.ts";
import { GraphRetrievalService } from "../src/modules/graph-rag/application/graph-retrieval.service.ts";

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
let container, adapter, admin, proof;
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
  const retrieval = new GraphRetrievalService({ enabled: true, merchantIds: settings.merchantIds,
    timeoutMs: 60_000, maxAgeMs: 300_000, threshold: 0.65 }, embedding, adapter);
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
  const foreign = await retrieval.searchCatalog({ merchantId: "fixture-shop-c", query });
  assert.deepEqual(foreign, { status: "unavailable", reason: "disabled" });
  const faq = { kind: "knowledge", merchantId: "fixture-shop-a", sourceType: "faq", id: "faq-collection", version,
    active: true, chunks: [{ id: "returns", content: "Voce pode devolver seu produto em sete dias apos receber a compra." }] };
  assert.equal((await projection.projectDocument(faq)).status, "applied");
  const documents = await retrieval.searchKnowledge({ merchantId: "fixture-shop-a", query: "Posso devolver o produto depois de receber?" });
  assert.equal(documents.status, "ready");assert.equal(documents.hits[0]?.sourceId, "faq-collection");
  const tombstone = { kind: "catalog", merchantId: "fixture-shop-a", id: "p-care", version: version + 1, active: false };
  assert.equal((await projection.projectCatalog(tombstone)).status, "applied");
  assert.equal((await projection.projectCatalog(care("fixture-shop-a"))).status, "ignored");
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
    checks: ["real multilingual inference", "tenant-first scoped Cypher", "same-variant negative attribute",
      "FAQ vector retrieval", "duplicate projection", "tombstone rejects old upsert", "other tenant retained",
      "complete enumeration retirement", "newer versions retained", "production administrative credential rejected"],
    scope: "Disposable graph and synthetic public fixtures; no PostgreSQL commerce writes or production-channel acceptance." };
} catch (error) {
  recordProof({ passed: false, observedAt: new Date().toISOString(), error: error instanceof Error ? error.message : "unknown_test_failure" });
  throw error;
} finally {
  await Promise.allSettled([adapter?.close(), admin?.close()]);
  if (container) {
    const owned = JSON.parse(docker(["inspect", container]))[0];
    assert.equal(owned.Id, container);assert.equal(owned.Config.Labels["com.zyon.qa"], label);
    docker(["stop", "--time", "5", container]);
  }
}
recordProof(proof);
console.log(JSON.stringify(proof));
