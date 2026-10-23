import test from "node:test";
import assert from "node:assert/strict";
import {
  OpenRouterProvider,
  type OpenRouterChatMessage
} from "./openrouter-provider.js";

// ─── Constructor defaults ──────────────────────────────────────────────────

test("OpenRouterProvider uses OpenRouter base URL by default", () => {
  const provider = new OpenRouterProvider({ apiKey: "or-test-key" });
  assert.equal(provider.getBaseUrl(), "https://openrouter.ai/api/v1");
});

test("OpenRouterProvider defaults to anthropic/claude-sonnet-4 model", () => {
  const provider = new OpenRouterProvider({ apiKey: "or-test-key" });
  assert.equal(provider.getModel(), "anthropic/claude-sonnet-4");
});

test("OpenRouterProvider allows custom baseUrl and model", () => {
  const provider = new OpenRouterProvider({
    apiKey: "or-test-key",
    baseUrl: "https://proxy.test/v1",
    model: "openai/gpt-4o-mini"
  });
  assert.equal(provider.getBaseUrl(), "https://proxy.test/v1");
  assert.equal(provider.getModel(), "openai/gpt-4o-mini");
});

test("OpenRouterProvider throws if apiKey is missing", () => {
  assert.throws(() => new OpenRouterProvider({ apiKey: "" }), /apiKey/);
});

// ─── chat() request format ────────────────────────────────────────────────

test("OpenRouterProvider.chat POSTs to /chat/completions with bearer auth", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
  globalThis.fetch = (async (url, init) => {
    calls.push({ url: String(url), init });
    return new Response(
      JSON.stringify({
        choices: [{ message: { content: "Oi!" } }],
        usage: { prompt_tokens: 12, completion_tokens: 4, total_tokens: 16 }
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  }) as typeof fetch;

  try {
    const provider = new OpenRouterProvider({ apiKey: "or-key-123" });
    const result = await provider.chat({
      messages: [{ role: "user", content: "ola" }]
    });
    assert.equal(result.content, "Oi!");
    assert.equal(result.usage.totalTokens, 16);
    assert.equal(calls[0]?.url, "https://openrouter.ai/api/v1/chat/completions");
    const headers = new Headers(calls[0]?.init?.headers);
    assert.equal(headers.get("authorization"), "Bearer or-key-123");
    const body = JSON.parse(String(calls[0]?.init?.body));
    assert.equal(body.model, "anthropic/claude-sonnet-4");
    assert.equal(body.stream, false);
    assert.equal(body.messages[0].role, "user");
    assert.equal(body.messages[0].content, "ola");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("OpenRouterProvider.chat forwards system message, tools and max_tokens", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ body: any }> = [];
  globalThis.fetch = (async (_url, init) => {
    calls.push({ body: JSON.parse(String(init?.body)) });
    return new Response(
      JSON.stringify({ choices: [{ message: { content: "ok" } }] }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  }) as typeof fetch;

  try {
    const provider = new OpenRouterProvider({ apiKey: "or-key" });
    await provider.chat({
      messages: [
        { role: "system", content: "be brief" },
        { role: "user", content: "oi" }
      ],
      tools: [
        {
          type: "function",
          function: {
            name: "search_catalog",
            description: "find products",
            parameters: { type: "object", properties: { query: { type: "string" } } }
          }
        }
      ],
      maxTokens: 500,
      temperature: 0.4
    });
    const sent = calls[0]?.body;
    assert.equal(sent.messages[0].role, "system");
    assert.equal(sent.messages[0].content, "be brief");
    assert.equal(sent.max_tokens, 500);
    assert.equal(sent.temperature, 0.4);
    assert.equal(sent.tools[0].function.name, "search_catalog");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// ─── Error handling ────────────────────────────────────────────────────────

test("OpenRouterProvider.chat throws on HTTP 4xx/5xx with status code", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response("rate limited", { status: 429 })) as typeof fetch;
  try {
    const provider = new OpenRouterProvider({ apiKey: "or-key" });
    await assert.rejects(
      () => provider.chat({ messages: [{ role: "user", content: "x" }] }),
      /openrouter_http_429/
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("OpenRouterProvider.chat returns empty content if response has no choices", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ choices: [] }), {
      status: 200,
      headers: { "content-type": "application/json" }
    })) as typeof fetch;
  try {
    const provider = new OpenRouterProvider({ apiKey: "or-key" });
    const result = await provider.chat({ messages: [{ role: "user", content: "x" }] });
    assert.equal(result.content, "");
    assert.equal(result.usage.totalTokens, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// ─── Tool-call decoding ────────────────────────────────────────────────────

test("OpenRouterProvider.chat decodes tool_calls into typed result", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: null,
              tool_calls: [
                {
                  id: "call_1",
                  type: "function",
                  function: { name: "search_catalog", arguments: "{\"query\":\"camiseta\"}" }
                }
              ]
            }
          }
        ]
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    )) as typeof fetch;
  try {
    const provider = new OpenRouterProvider({ apiKey: "or-key" });
    const result = await provider.chat({
      messages: [{ role: "user", content: "tem camiseta?" }]
    });
    assert.equal(result.toolCalls?.length, 1);
    assert.equal(result.toolCalls?.[0].name, "search_catalog");
    assert.deepEqual(result.toolCalls?.[0].args, { query: "camiseta" });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// ─── isAvailable() / fallback ──────────────────────────────────────────────

test("OpenRouterProvider.isAvailable returns true when apiKey set", () => {
  assert.equal(new OpenRouterProvider({ apiKey: "k" }).isAvailable(), true);
});

test("OpenRouterProvider.isAvailable returns false when apiKey missing", () => {
  // Bypass constructor validation to test the public surface.
  const provider = Object.create(OpenRouterProvider.prototype);
  provider.apiKey = "";
  provider.baseUrl = "https://openrouter.ai/api/v1";
  provider.model = "anthropic/claude-sonnet-4";
  assert.equal(provider.isAvailable(), false);
});

// Suppress unused import warning for type-only usage in the test.
type _ChatMessage = OpenRouterChatMessage;
const _check: _ChatMessage = { role: "user", content: "x" };
void _check;

test("structured format is opt-in and preserves refusal and finish metadata", async () => {
  const bodies: Record<string, unknown>[] = [];
  const provider = new OpenRouterProvider({ apiKey: "test-only", fetchFn: (async (_url, init) => {
    bodies.push(JSON.parse(String(init?.body)));
    return new Response(JSON.stringify({ choices: [{ finish_reason: "content_filter", message: { content: null, refusal: "refused" } }] }));
  }) as typeof fetch });
  const result = await provider.chat({ messages: [], responseFormat: { type: "json_object" } });
  await provider.chat({ messages: [] });
  assert.deepEqual(bodies[0]?.response_format, { type: "json_object" });
  assert.ok(!Object.hasOwn(bodies[1]!, "response_format"));
  assert.equal(result.content, "");
  assert.equal(result.finishReason, "content_filter");
  assert.equal(result.refusal, "refused");
});

test("strict JSON Schema is forwarded unchanged to the compatible provider", async () => {
  const format = { type: "json_schema" as const, json_schema: { name: "reply_v1", strict: true, schema: { type: "object", additionalProperties: false, properties: { message: { type: "string" } }, required: ["message"] } } };
  const provider = new OpenRouterProvider({ apiKey: "test-only", fetchFn: (async (_url, init) => {
    assert.deepEqual(JSON.parse(String(init?.body)).response_format, format);
    return new Response(JSON.stringify({ choices: [{ message: { content: '{"message":"Oi"}' } }] }));
  }) as typeof fetch });
  assert.equal((await provider.chat({ messages: [], responseFormat: format })).content, '{"message":"Oi"}');
});

test("optional abort signal is forwarded only to fetch and an aborted call is never retried", async () => {
  const signal = AbortSignal.abort(new DOMException("synthetic_abort", "TimeoutError")); let attempts = 0;
  const provider = new OpenRouterProvider({ apiKey: "synthetic-test-only", fetchFn: (async (_url, init) => {
    attempts++; assert.equal(init?.signal, signal); assert.equal(Object.hasOwn(JSON.parse(String(init?.body)), "signal"), false);
    signal.throwIfAborted(); throw new Error("unreachable_after_abort");
  }) as typeof fetch });
  await assert.rejects(provider.chat({ messages: [], signal }), error => error === signal.reason);
  assert.equal(attempts, 1);
});

test("legacy request without signal keeps the original fetch defaults and wire body", async () => {
  let attempts = 0;
  const provider = new OpenRouterProvider({ apiKey: "synthetic-test-only", fetchFn: (async (_url, init) => {
    attempts++; assert.equal(Object.hasOwn(init!, "signal"), false); assert.equal(Object.hasOwn(JSON.parse(String(init?.body)), "signal"), false);
    return new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: "ok" } }] }));
  }) as typeof fetch });
  assert.equal((await provider.chat({ messages: [] })).content, "ok"); assert.equal(attempts, 1);
});

for (const rawUsage of [undefined, null, {}, { prompt_tokens: 12 }, { prompt_tokens: "12", completion_tokens: 4, total_tokens: 16 },
  { prompt_tokens: -1, completion_tokens: 4, total_tokens: 3 }, { prompt_tokens: 1.5, completion_tokens: 4, total_tokens: 5.5 },
  { prompt_tokens: 12, completion_tokens: 4, total_tokens: 1 }, { prompt_tokens: Number.MAX_SAFE_INTEGER + 1, completion_tokens: 0, total_tokens: Number.MAX_SAFE_INTEGER + 1 }]) {
  test(`RAW usage provenance remains unknown rather than normalized zero: ${JSON.stringify(rawUsage)}`, async () => {
    const provider = new OpenRouterProvider({ apiKey: "synthetic-test-only", fetchFn: (async () => new Response(JSON.stringify({
      choices: [{ finish_reason: "stop", message: { content: "ok" } }], ...(rawUsage === undefined ? {} : { usage: rawUsage }),
    }))) as typeof fetch });
    const result = await provider.chat({ messages: [] }); assert.equal(result.usageKnown, false); assert.equal(result.content, "ok");
  });
}
for (const rawUsage of [{ prompt_tokens: 12, completion_tokens: 4, total_tokens: 16 }, { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }]) {
  test(`RAW complete measured counts preserve usage provenance: ${JSON.stringify(rawUsage)}`, async () => {
    const provider = new OpenRouterProvider({ apiKey: "synthetic-test-only", fetchFn: (async () => new Response(JSON.stringify({
      choices: [{ finish_reason: "stop", message: { content: "ok" } }], usage: rawUsage,
    }))) as typeof fetch });
    const result = await provider.chat({ messages: [] }); assert.equal(result.usageKnown, true);
    assert.deepEqual(result.usage, { promptTokens: rawUsage.prompt_tokens, completionTokens: rawUsage.completion_tokens, totalTokens: rawUsage.total_tokens });
  });
}
