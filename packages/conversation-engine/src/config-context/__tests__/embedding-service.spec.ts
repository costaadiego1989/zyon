import test from "node:test";
import assert from "node:assert/strict";
import { EmbeddingService } from "../embedding-service.js";

function mockFetch(response: { status: number; body: unknown }): typeof fetch {
  return (async () =>
    new Response(JSON.stringify(response.body), {
      status: response.status,
      headers: { "content-type": "application/json" }
    })) as unknown as typeof fetch;
}

function validEmbeddingResponse(): { status: number; body: unknown } {
  const vector = Array.from({ length: 1536 }, (_, i) => Math.sin(i));
  return {
    status: 200,
    body: {
      data: [{ embedding: vector }],
      model: "openai/text-embedding-3-small",
      usage: { prompt_tokens: 42, total_tokens: 42 }
    }
  };
}

// ─── Correct API call ─────────────────────────────────────────────────────────

test("EmbeddingService calls correct URL: openrouter embeddings endpoint", async () => {
  const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
  const captureFetch = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(validEmbeddingResponse().body), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  }) as unknown as typeof fetch;

  const service = new EmbeddingService({
    apiKey: "or-test-key",
    fetchFn: captureFetch
  });
  await service.embed("hello world");

  assert.equal(calls[0]?.url, "https://openrouter.ai/api/v1/embeddings");
});

test("EmbeddingService uses correct model: text-embedding-3-small", async () => {
  const calls: Array<{ body: any }> = [];
  const captureFetch = (async (_url: string, init?: RequestInit) => {
    calls.push({ body: JSON.parse(String(init?.body)) });
    return new Response(JSON.stringify(validEmbeddingResponse().body), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  }) as unknown as typeof fetch;

  const service = new EmbeddingService({
    apiKey: "or-test-key",
    fetchFn: captureFetch
  });
  await service.embed("test text");

  assert.equal(calls[0]?.body.model, "openai/text-embedding-3-small");
});

test("EmbeddingService returns 1536-dimension vector", async () => {
  const service = new EmbeddingService({
    apiKey: "or-test-key",
    fetchFn: mockFetch(validEmbeddingResponse())
  });

  const result = await service.embed("test text");

  assert.ok(result !== null);
  assert.equal(result!.vector.length, 1536);
  assert.equal(result!.model, "openai/text-embedding-3-small");
  assert.equal(typeof result!.tokensUsed, "number");
});

// ─── Error handling ──────────────────────────────────────────────────────────

test("EmbeddingService returns null on API error (does not throw)", async () => {
  const service = new EmbeddingService({
    apiKey: "or-test-key",
    fetchFn: mockFetch({ status: 500, body: { error: "internal" } })
  });

  const result = await service.embed("test");
  assert.equal(result, null);
});

test("EmbeddingService returns null on network error / timeout", async () => {
  const failFetch = (async () => {
    throw new Error("network timeout");
  }) as unknown as typeof fetch;

  const service = new EmbeddingService({
    apiKey: "or-test-key",
    fetchFn: failFetch
  });

  const result = await service.embed("test");
  assert.equal(result, null);
});

test("EmbeddingService returns null when apiKey is missing", async () => {
  const service = new EmbeddingService({
    apiKey: "",
    fetchFn: mockFetch(validEmbeddingResponse())
  });

  const result = await service.embed("test");
  assert.equal(result, null);
});

test("EmbeddingService includes Authorization header with Bearer token", async () => {
  const calls: Array<{ headers: Headers }> = [];
  const captureFetch = (async (_url: string, init?: RequestInit) => {
    calls.push({ headers: new Headers(init?.headers) });
    return new Response(JSON.stringify(validEmbeddingResponse().body), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  }) as unknown as typeof fetch;

  const service = new EmbeddingService({
    apiKey: "or-secret-key",
    fetchFn: captureFetch
  });
  await service.embed("test");

  assert.equal(calls[0]?.headers.get("authorization"), "Bearer or-secret-key");
});
