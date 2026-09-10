import test from "node:test";
import assert from "node:assert/strict";
import { ChatLlmGatewayService } from "./chat-llm-gateway.service.js";

const providerKeys = [
  "LOCAL_LLM_BASE_URL",
  "OLLAMA_BASE_URL",
  "DEEPSEEK_API_KEY",
  "OPENROUTER_API_KEY",
  "OPENAI_API_KEY"
] as const;

test("ChatLlmGatewayService skips provider requests when no provider is configured", async () => {
  const previousEnv = new Map(providerKeys.map((key) => [key, process.env[key]]));
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;

  try {
    for (const key of providerKeys) delete process.env[key];
    globalThis.fetch = (async () => {
      fetchCalls += 1;
      throw new Error("fetch must not be called without an explicitly configured provider");
    }) as typeof fetch;

    const result = await new ChatLlmGatewayService().call([], []);

    assert.equal(result, null);
    assert.equal(fetchCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
    for (const key of providerKeys) {
      const value = previousEnv.get(key);
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
