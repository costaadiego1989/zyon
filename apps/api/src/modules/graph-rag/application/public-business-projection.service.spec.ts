import assert from "node:assert/strict";
import { test } from "node:test";
import { projectPublicBusinessSource } from "../domain/public-business-source.js";
import { PublicBusinessProjectionService, PUBLIC_BUSINESS_GRAPH_SCHEMA } from "./public-business-projection.service.js";

const version = "public-v1:00000000000000000007";
const source = () => projectPublicBusinessSource("tenant-a", { merchantId: "tenant-a", sourceId: "general", sourceType: "policy",
  sourceVersion: "snapshot:opaque", publicationState: "published", row: { title: "Policy", content: "Published public policy" } });
const vector = Array.from({ length: 384 }, (_, index) => index === 0 ? 1 : 0);
const graph = { withProjection: async () => { throw new Error("graph_must_not_run_during_preparation"); } };

test("T66", async t => {
  await t.test("captures canonical public identity/hash and the work counter without using a snapshot timestamp", async () => {
    const projection = new PublicBusinessProjectionService(graph as never, { modelId: "synthetic-model-v1", dimensions: 384, generate: async () => vector });
    const canonical = source();
    const result = await projection.prepare(canonical, version);
    assert.equal(result.status, "prepared");
    if (result.status !== "prepared") return;
    assert.deepEqual({ ...result.projection, chunks: [] }, { merchantId: "tenant-a", sourceType: "policy", sourceId: "general",
      sourceHash: canonical.sourceHash, publicRevision: 7, active: true, modelId: "synthetic-model-v1", dimensions: 384, chunks: [] });
    assert.equal(result.projection.chunks.length, 1);
    assert.deepEqual(result.projection.chunks[0]!.embedding, vector);
    assert.equal(result.projection.chunks[0]!.normalizedText, "policy: published public policy");
    assert.match(result.projection.chunks[0]!.contentHash, /^[a-f0-9]{64}$/);
    assert.equal(JSON.stringify(result.projection).includes("snapshot:opaque"), false);
  });

  await t.test("withdrawn and empty public sources produce a tombstone without an embedding dependency", async () => {
    const projection = new PublicBusinessProjectionService(graph as never, { modelId: "synthetic-model-v1", dimensions: 384, generate: async () => { throw new Error("embedding_unavailable"); } });
    for (const canonical of [{ ...source(), publicationState: "withdrawn" as const, text: "" }, { ...source(), text: "   " }]) {
      const result = await projection.prepare(canonical, version);
      assert.equal(result.status, "prepared");
      if (result.status !== "prepared") return;
      assert.equal(result.projection.active, false);
      assert.deepEqual(result.projection.chunks, []);
      assert.equal(result.projection.sourceHash, canonical.sourceHash);
      assert.equal(result.projection.publicRevision, 7);
    }
  });

  await t.test("legacy UUID/epoch versions and malformed identities cannot become graph revisions", async () => {
    const projection = new PublicBusinessProjectionService(graph as never, { modelId: "synthetic-model-v1", dimensions: 384, generate: async () => vector });
    for (const invalid of ["legacy-uuid", "1800000000000", "public-v1:7", "public-v1:00000000000000000000"])
      assert.deepEqual(await projection.prepare(source(), invalid), { status: "unavailable", reason: "invalid_source" });
    for (const canonical of [{ ...source(), merchantId: " " }, { ...source(), sourceHash: "not-a-hash" }])
      assert.deepEqual(await projection.prepare(canonical, version), { status: "unavailable", reason: "invalid_source" });
  });

  await t.test("long public content is split deterministically without losing a surrogate-pair character", async () => {
    const input = projectPublicBusinessSource("tenant-a", { merchantId: "tenant-a", sourceId: "general", sourceType: "policy",
      sourceVersion: "public-snapshot", publicationState: "published", row: { title: "Policy", content: "x".repeat(1591) + "🤖" + "y".repeat(2000) } });
    const projection = new PublicBusinessProjectionService(graph as never, { modelId: "synthetic-model-v1", dimensions: 384, generate: async () => vector });
    const first = await projection.prepare(input, version), second = await projection.prepare(input, version);
    assert.deepEqual(first, second); assert.equal(first.status, "prepared");
    if (first.status !== "prepared") return;
    assert.equal(first.projection.chunks.length, 3);
    assert.equal(first.projection.chunks.map(chunk => chunk.normalizedText).join(""), input.text.toLowerCase());
    for (const chunk of first.projection.chunks) {
      assert.equal(Array.from(chunk.normalizedText).every(character => character.length === 2
        || character.charCodeAt(0) < 0xD800 || character.charCodeAt(0) > 0xDFFF), true);
      assert.equal(chunk.embedding.length, 384); assert.match(chunk.id, /^[a-f0-9]{64}$/);
    }
    assert.equal(new Set(first.projection.chunks.map(chunk => chunk.id)).size, 3);
  });

  await t.test("unavailable or malformed model vectors cannot become a prepared projection", async () => {
    for (const invalid of [null, [], Array(383).fill(1), Array(384).fill(0), Array(384).fill(Number.NaN)]) {
      const projection = new PublicBusinessProjectionService(graph as never,
        { modelId: "synthetic-model-v1", dimensions: 384, generate: async () => invalid } as never);
      assert.deepEqual(await projection.prepare(source(), version), { status: "unavailable", reason: "embedding_unavailable" });
    }
    const failing = new PublicBusinessProjectionService(graph as never,
      { modelId: "synthetic-model-v1", dimensions: 384, generate: async () => { throw new Error("synthetic-private-provider-error"); } });
    assert.deepEqual(await failing.prepare(source(), version), { status: "unavailable", reason: "embedding_unavailable" });
  });

  await t.test("prepared values contain public fields only and use a separate schema from legacy documents", async () => {
    const canonical = { ...source(), administrativeSecret: "SYNTHETIC-PRIVATE-CANARY" };
    const projection = new PublicBusinessProjectionService(graph as never, { modelId: "synthetic-model-v1", dimensions: 384, generate: async () => vector });
    const result = await projection.prepare(canonical, version);
    assert.equal(result.status, "prepared"); assert.equal(JSON.stringify(result).includes("SYNTHETIC-PRIVATE-CANARY"), false);
    assert.equal(PUBLIC_BUSINESS_GRAPH_SCHEMA.length, 2);
    assert.ok(PUBLIC_BUSINESS_GRAPH_SCHEMA.every(statement => statement.includes("ZyonPublic") && !statement.includes("ZyonGraphDocument")));
    assert.deepEqual(await projection.prepare({ ...source(), text: "x".repeat(160001) }, version), { status: "unavailable", reason: "invalid_source" });
  });

  await t.test("a provider declaring a different vector dimension cannot produce current evidence", async () => {
    for (const dimensions of [undefined, 0, 383, 768]) {
      let called = false;
      const projection = new PublicBusinessProjectionService(graph as never,
        { modelId: "synthetic-model-v1", dimensions, generate: async () => { called = true; return vector; } } as never);
      assert.deepEqual(await projection.prepare(source(), version), { status: "unavailable", reason: "embedding_unavailable" });
      assert.equal(called, false);
      const retired = await projection.prepare({ ...source(), publicationState: "withdrawn", text: "" }, version);
      assert.equal(retired.status, "prepared");
      if (retired.status === "prepared") { assert.equal(retired.projection.active, false); assert.deepEqual(retired.projection.chunks, []); }
    }
  });
});
