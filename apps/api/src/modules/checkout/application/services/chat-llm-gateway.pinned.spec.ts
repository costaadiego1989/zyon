import test, { beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { ChatLlmGatewayService } from "./chat-llm-gateway.service.js";
import { captureCheckoutChatBaseline } from "../../infrastructure/adapters/checkout-chat-baseline-capture.js";

const originalEnv = { ...process.env };
const originalFetch = globalThis.fetch;
let requests: Array<{ url: string; init: RequestInit }>;
let answer: () => Promise<Response>;
const payload = () => ({ model: "fixture-version", choices: [{ finish_reason: "stop",
  message: { role: "assistant", content: "Posso explicar esta etapa." } }] });
const baseline = () => captureCheckoutChatBaseline({ merchantId: "store", merchantName: "Fixture",
  rules: { normal: [], paymentFailed: [] }, settingsHash: "settings", policyHash: "policy" })!;
beforeEach(() => {
  process.env = { ...originalEnv, REVENUE_CHECKOUT_CONTRACT_ENABLED: "true", CHECKOUT_BEHAVIOR_REVISION: "a".repeat(40),
    CHECKOUT_LLM_PROVIDER: "openai", OPENAI_API_KEY: "fixture-key", OPENAI_MODEL: "fixture-version",
    OPENAI_BASE_URL: "https://fixture.invalid/v1", OPENROUTER_API_KEY: "must-not-fallback" };
  delete process.env.LOCAL_LLM_BASE_URL; delete process.env.OLLAMA_BASE_URL;
  requests = []; answer = async () => Response.json(payload());
  globalThis.fetch = (async (url, init) => { requests.push({ url: String(url), init: init! }); return answer(); }) as typeof fetch;
});
afterEach(() => { process.env = { ...originalEnv }; globalThis.fetch = originalFetch; });

test("pinned dispatch sends exact captured model/tools/sampling and no fallback", async () => {
  const captured = baseline();
  const messages = [{ role: "system" as const, content: "Captured prompt" }, { role: "user" as const, content: "Ajuda" }];
  const result = await new ChatLlmGatewayService().callPinned("store", captured, messages);
  assert.equal(result.outcome, "provider_completed");
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, "https://fixture.invalid/v1/chat/completions");
  assert.equal(requests[0].init.redirect, "error");
  assert.deepEqual(JSON.parse(String(requests[0].init.body)), { model: "fixture-version", messages, tools: captured.tools, ...captured.sampling });
  assert.equal(JSON.stringify(captured).includes("fixture-key"), false);
});

test("configuration, tenant and captured program drift never sends a request", async () => {
  const captured = baseline();
  const gateway = new ChatLlmGatewayService();
  assert.equal((await gateway.callPinned("foreign", captured, [])).outcome, "provider_not_dispatched");
  for (const [key, value] of [["OPENAI_MODEL", "other-model"], ["OPENAI_BASE_URL", "https://other.invalid"],
    ["CHECKOUT_BEHAVIOR_REVISION", "b".repeat(40)], ["CHECKOUT_LLM_PROVIDER", ""],
    ["REVENUE_CHECKOUT_CONTRACT_ENABLED", "false"], ["OPENAI_API_KEY", ""]]) {
    const saved = process.env[key]; process.env[key] = value;
    assert.equal((await gateway.callPinned("store", captured, [])).outcome, "provider_not_dispatched", key);
    process.env[key] = saved;
  }
  assert.equal((await gateway.callPinned("store", { ...captured, tools: [] }, [])).outcome, "provider_not_dispatched");
  assert.equal(requests.length, 0);
});

test("current DeepSeek route supports pinned and regular tool turns without reasoning history", async () => {
  process.env.CHECKOUT_LLM_PROVIDER = "openrouter";
  process.env.OPENROUTER_BASE_URL = "https://api.deepseek.com/v1";
  process.env.OPENROUTER_MODEL = "legacy-other-module";
  process.env.CHECKOUT_LLM_MODEL = "deepseek-flash";
  const captured = baseline(), gateway = new ChatLlmGatewayService();
  const tool = { id: "call_fixture", type: "function", function: { name: captured.tools[0].function.name, arguments: "{}" } };
  const usage = { prompt_tokens: 120, completion_tokens: 10, total_tokens: 130 };
  answer = async () => Response.json({ model: "deepseek-flash", id: "fixture-event", usage,
    choices: [{ finish_reason: "tool_calls", message: { role: "assistant", content: null, tool_calls: [tool] } }] });
  const result = await gateway.callPinned("store", captured, [{ role: "user", content: "Ajuda" }]);
  assert.equal(result.outcome, "provider_completed");
  assert.deepEqual(result.usage, usage);
  assert.deepEqual((await gateway.call([], captured.tools))?.toolCalls, [tool]);
  assert.equal(requests.length, 2);
  for (const request of requests) {
    const body = JSON.parse(String(request.init.body));
    assert.deepEqual(body.thinking, { type: "disabled" });
    assert.equal(body.model, captured.provider.model);
    assert.deepEqual(body.tools, captured.tools);
  }
  process.env.CHECKOUT_LLM_MODEL = "deepseek-v4-pro";
  assert.equal((await gateway.callPinned("store", captured, [])).outcome, "provider_not_dispatched");
  assert.equal(requests.length, 2);
});

test("pinned token evidence is preserved for usable and unusable content without inventing counts", async () => {
  const gateway = new ChatLlmGatewayService(), captured = baseline();
  const usage = { prompt_tokens: 120, completion_tokens: 30, total_tokens: 150 };
  for (const choices of [payload().choices, []]) {
    answer = async () => Response.json({ ...payload(), choices, usage: { ...usage, untrusted_cost: 0 }, id: "provider-event-1" });
    const result = await gateway.callPinned("store", captured, []);
    assert.equal(result.outcome, choices.length ? "provider_completed" : "provider_unknown");
    assert.deepEqual(result.usage, usage); assert.equal(result.providerEventId, "provider-event-1");
    assert.equal((result as any).untrusted_cost, undefined);
  }
});

test("pinned usage rejects mismatched model, fractional, missing, inconsistent and oversized counters", async () => {
  const gateway = new ChatLlmGatewayService(), captured = baseline();
  const usage = { prompt_tokens: 120, completion_tokens: 30, total_tokens: 150 };
  for (const invalid of [undefined, {}, { ...usage, prompt_tokens: "120" }, { ...usage, prompt_tokens: -1 },
    { ...usage, completion_tokens: 1.5 }, { ...usage, total_tokens: 151 },
    { prompt_tokens: 2_147_483_647, completion_tokens: 1, total_tokens: 2_147_483_648 }]) {
    answer = async () => Response.json({ ...payload(), usage: invalid });
    const result = await gateway.callPinned("store", captured, []);
    assert.equal(result.outcome, "provider_completed"); assert.equal(result.usage, undefined);
  }
  answer = async () => Response.json({ ...payload(), model: "different-model", usage });
  assert.equal((await gateway.callPinned("store", captured, [])).usage, undefined);
  answer = async () => Response.json({ ...payload(), usage, id: "untrusted\nmetadata" });
  const valid = await gateway.callPinned("store", captured, []);
  assert.deepEqual(valid.usage, usage); assert.equal(valid.providerEventId, undefined);
});

test("credential rotation retains the pinned behavior without serializing old credentials", async () => {
  const captured = baseline(); process.env.OPENAI_API_KEY = "rotated-fixture-key";
  await new ChatLlmGatewayService().callPinned("store", captured, []);
  assert.equal(new Headers(requests[0].init.headers).get("Authorization"), "Bearer rotated-fixture-key");
});

test("network uncertainty and provider failures make exactly one attempt", async () => {
  const gateway = new ChatLlmGatewayService(); const captured = baseline();
  for (const status of [400, 401, 403, 404, 422, 429, 408, 500, 503]) {
    answer = async () => new Response("not usable", { status });
    assert.equal((await gateway.callPinned("store", captured, [])).outcome,
      [400, 401, 403, 404, 422, 429].includes(status) ? "provider_failed" : "provider_unknown");
  }
  answer = async () => { throw new TypeError("connection lost after send"); };
  assert.equal((await gateway.callPinned("store", captured, [])).outcome, "provider_unknown");
  assert.equal(requests.length, 10);
  assert.ok(requests.every(r => r.url.includes("fixture.invalid")));
});

test("malformed, truncated, refused, empty, oversized and wrong-model responses stay uncertain", async () => {
  const captured = baseline(); const gateway = new ChatLlmGatewayService();
  const invalid = [ {}, { ...payload(), model: "moving-alias-version" }, { ...payload(), model: undefined },
    { ...payload(), choices: [] }, { ...payload(), choices: [...payload().choices, ...payload().choices] },
    { model: "fixture-version", choices: [{ ...payload().choices[0], finish_reason: "length" }] },
    ...[{ role: "user", content: "text" }, { role: "assistant", content: null },
      { role: "assistant", content: 123 }, { role: "assistant", content: "text", refusal: "no" }].map(message => ({
        model: "fixture-version", choices: [{ finish_reason: "stop", message }] })),
  ];
  for (const value of invalid) {
    answer = async () => Response.json(value);
    assert.equal((await gateway.callPinned("store", captured, [])).outcome, "provider_unknown");
  }
  answer = async () => new Response("invalid json");
  assert.equal((await gateway.callPinned("store", captured, [])).outcome, "provider_unknown");
  answer = async () => new Response("x".repeat(200_001));
  assert.equal((await gateway.callPinned("store", captured, [])).outcome, "provider_unknown");
});

test("tool output is parsed but never executed; unknown/malformed tools are uncertain", async () => {
  const captured = baseline(); const gateway = new ChatLlmGatewayService();
  const call = { type: "function", function: { name: captured.tools[0].function.name, arguments: "{}" } };
  answer = async () => Response.json({ model: "fixture-version", choices: [{ finish_reason: "tool_calls",
    message: { role: "assistant", content: null, tool_calls: [call] } }] });
  const valid = await gateway.callPinned("store", captured, []);
  assert.equal(valid.outcome, "provider_completed");
  if (valid.outcome === "provider_completed") assert.deepEqual(valid.result.toolCalls, [call]);
  for (const invalid of [{ ...call, function: { name: "invented_offer", arguments: "{}" } },
    ...["invalid", "[]", "null"].map(argumentsValue => ({ ...call, function: { ...call.function, arguments: argumentsValue } }))]) {
    answer = async () => Response.json({ model: "fixture-version", choices: [{ finish_reason: "tool_calls",
      message: { role: "assistant", tool_calls: [invalid] } }] });
    assert.equal((await gateway.callPinned("store", captured, [])).outcome, "provider_unknown");
  }
});

test("timeout remains active while reading the response body and is cleaned afterwards", async () => {
  const captured = baseline(); const gateway = new ChatLlmGatewayService();
  const originalSetTimeout = globalThis.setTimeout; const originalClearTimeout = globalThis.clearTimeout;
  let abort!: () => void; let cleared = 0;
  try {
    globalThis.setTimeout = ((callback: () => void) => { abort = callback; return 42; }) as any;
    globalThis.clearTimeout = (() => { cleared++; }) as any;
    globalThis.fetch = (async (_url, init) => new Response(new ReadableStream({ start(controller) {
      init!.signal!.addEventListener("abort", () => controller.error(new Error("aborted body")), { once: true });
    } }))) as typeof fetch;
    const promise = gateway.callPinned("store", captured, []);
    await Promise.resolve(); abort();
    assert.equal((await promise).outcome, "provider_unknown");
    assert.equal(cleared, 1);
  } finally { globalThis.setTimeout = originalSetTimeout; globalThis.clearTimeout = originalClearTimeout; }
});
