import test from "node:test";
import assert from "node:assert/strict";
import { providerRequestOptions } from "./provider-request-options.js";

test("official DeepSeek current models use the non-thinking tool protocol even under a route alias", () => {
  for (const endpoint of ["https://api.deepseek.com/v1", "https://api.deepseek.com/chat/completions"])
    for (const model of ["deepseek-flash", "deepseek-v4-pro"])
      assert.deepEqual(providerRequestOptions(endpoint, model), { thinking: { type: "disabled" } });
});

test("other providers, legacy models and misleading hostnames retain their own protocol", () => {
  for (const endpoint of ["https://api.openai.com/v1", "https://openrouter.ai/api/v1",
    "https://api.deepseek.com.evil.invalid/v1", "https://evil.invalid/api.deepseek.com",
    "http://api.deepseek.com/v1", "not a URL"])
    assert.deepEqual(providerRequestOptions(endpoint, "deepseek-flash"), {});
  assert.deepEqual(providerRequestOptions("https://api.deepseek.com/v1", "deepseek-chat"), {});
});
