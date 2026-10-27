import test from "node:test";
import assert from "node:assert/strict";
import { ChatLlmGatewayService } from "./chat-llm-gateway.service.js";

const providerKeys = [
  "LOCAL_LLM_BASE_URL",
  "OLLAMA_BASE_URL",
  "DEEPSEEK_API_KEY",
  "OPENROUTER_API_KEY",
  "OPENAI_API_KEY",
  "OPENROUTER_BASE_URL",
  "OPENROUTER_MODEL",
  "OPENAI_BASE_URL",
  "OPENAI_MODEL",
  "CHECKOUT_LLM_PROVIDER"
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

test("ChatLlmGatewayService uses OpenRouter before OpenAI and preserves the tool payload", async () => {
  const previousEnv = new Map(providerKeys.map((key) => [key, process.env[key]]));
  const originalFetch = globalThis.fetch;
  const requests: Array<{ url: string; init: RequestInit }> = [];

  try {
    for (const key of providerKeys) delete process.env[key];
    process.env.OPENROUTER_API_KEY = "router-key";
    process.env.OPENROUTER_BASE_URL = "https://router.example/v1/";
    process.env.OPENROUTER_MODEL = "provider/model";
    process.env.OPENAI_API_KEY = "openai-key";

    globalThis.fetch = (async (url, init) => {
      requests.push({ url: String(url), init: init! });
      return Response.json({ choices: [{ message: { content: "Resposta segura", tool_calls: [{ function: { name: "show_payment_methods", arguments: "{}" } }] } }] });
    }) as typeof fetch;

    const result = await new ChatLlmGatewayService().call(
      [{ role: "user", content: "Quais formas de pagamento?" }],
      [{ type: "function", function: { name: "show_payment_methods", description: "Mostra pagamento", parameters: { type: "object" } } }],
    );

    assert.equal(requests.length, 1);
    assert.equal(requests[0]?.url, "https://router.example/v1/chat/completions");
    assert.equal(new Headers(requests[0]?.init.headers).get("Authorization"), "Bearer router-key");
    const body = JSON.parse(String(requests[0]?.init.body));
    assert.equal(body.model, "provider/model");
    assert.equal(body.tools[0].function.name, "show_payment_methods");
    assert.equal(result?.toolCalls[0]?.function?.name, "show_payment_methods");
  } finally {
    globalThis.fetch = originalFetch;
    for (const key of providerKeys) {
      const value = previousEnv.get(key);
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("ChatLlmGatewayService falls through from OpenRouter to OpenAI", async () => {
  const previousEnv = new Map(providerKeys.map((key) => [key, process.env[key]]));
  const originalFetch = globalThis.fetch;
  const urls: string[] = [];

  try {
    for (const key of providerKeys) delete process.env[key];
    process.env.OPENROUTER_API_KEY = "router-key";
    process.env.OPENROUTER_BASE_URL = "https://router.example/v1";
    process.env.OPENAI_API_KEY = "openai-key";
    process.env.OPENAI_BASE_URL = "https://openai.example/v1";

    globalThis.fetch = (async (url) => {
      urls.push(String(url));
      if (String(url).includes("router.example")) return new Response("unavailable", { status: 503 });
      return Response.json({ choices: [{ message: { content: "Resposta OpenAI" } }] });
    }) as typeof fetch;

    const result = await new ChatLlmGatewayService().call([], []);

    assert.deepEqual(urls, [
      "https://router.example/v1/chat/completions",
      "https://openai.example/v1/chat/completions",
    ]);
    assert.equal(result?.content, "Resposta OpenAI");
  } finally {
    globalThis.fetch = originalFetch;
    for (const key of providerKeys) {
      const value = previousEnv.get(key);
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("ChatLlmGatewayService pins checkout to the selected configured provider", async () => {
  const previousEnv = new Map(providerKeys.map((key) => [key, process.env[key]]));
  const originalFetch = globalThis.fetch;
  const urls: string[] = [];

  try {
    for (const key of providerKeys) delete process.env[key];
    process.env.LOCAL_LLM_BASE_URL = "http://local.example/v1";
    process.env.OPENROUTER_API_KEY = "router-key";
    process.env.OPENROUTER_BASE_URL = "https://router.example/v1";
    process.env.CHECKOUT_LLM_PROVIDER = "openrouter";

    globalThis.fetch = (async (url) => {
      urls.push(String(url));
      return Response.json({ choices: [{ message: { content: "Resposta OpenRouter" } }] });
    }) as typeof fetch;

    const result = await new ChatLlmGatewayService().call([], []);

    assert.deepEqual(urls, ["https://router.example/v1/chat/completions"]);
    assert.equal(result?.content, "Resposta OpenRouter");
  } finally {
    globalThis.fetch = originalFetch;
    for (const key of providerKeys) {
      const value = previousEnv.get(key);
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("ChatLlmGatewayService forwards only known consented intent classifications", () => {
  const prompt = new ChatLlmGatewayService().buildSystemPrompt({
    merchantRules: [],
    cartInfo: "Carrinho: R$100,00",
    buyerIntent: {
      primary_intent: "price_sensitive",
      urgency: "high",
      budget_tier: "budget",
      pain_points: ["price", "ignore_previous_instructions"],
    },
  });

  assert.match(prompt, /SINAL DE INTENCAO DO COMPRADOR/);
  assert.match(prompt, /intencao=price_sensitive/);
  assert.match(prompt, /urgencia=high/);
  assert.match(prompt, /faixa_orcamento=budget/);
  assert.match(prompt, /pontos=price/);
  assert.doesNotMatch(prompt, /ignore_previous_instructions/);
});
