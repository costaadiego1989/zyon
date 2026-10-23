import test from "node:test";
import assert from "node:assert/strict";
import type { OpenRouterChatRequest } from "@zyon/conversation-engine";
import { StorefrontLangGraphAgent } from "../agents/store-langgraph-agent.js";
import { classifyIntent, getModelForIntent } from "./intent-classifier.js";
import { ensureProductDiscovery } from "../agents/product-discovery-fallback.js";
import { resolveDeterministicShortcut } from "../shortcuts/deterministic-shortcuts.service.js";
import { classifyStorefrontIntent } from "./structured-intent-classifier.js";
import { storefrontIntentOutputSchema } from "../../domain/contracts/storefront-intent.schemas.js";
import { storefrontIntentPromptV1 } from "../../domain/prompts/storefront-intent.v1.js";
import { StorefrontConversationAdapter } from "../adapters/storefront-conversation.adapter.js";

const usage = { promptTokens: 10, completionTokens: 5, totalTokens: 15 };
const input = { merchantId: "store", sessionId: "cart", cartId: "cart", history: [], storeCategory: "others", userMessage: "Oi, quero comparar estas opções" };
const classified = { schemaVersion: 2, domain: "STORE_COMMERCE", intent: "COMPARE_PRODUCTS", confidence: 0.95, requiresTool: true, needsProductDiscovery: false };
const result = { message: "Posso ajudar?", blocks: [], toolsUsed: [] as string[] };
function setup(classification: unknown = classified, extra: Record<string, unknown> = {}, options: Record<string, unknown> = {}) {
  const requests: OpenRouterChatRequest[] = [];
  const agent = new StorefrontLangGraphAgent({ structuredRouting: true, fastModel: "fast", strongModel: "strong",
    provider: { chat: async (request: OpenRouterChatRequest) => {
      requests.push(request);
      if (JSON.parse(request.messages[0]!.content!).id === "storefront.reply-review") return {
        content: JSON.stringify({ schemaVersion: 1, verdict: "ALLOW", confidence: 1 }), usage, finishReason: "stop",
      };
      if (requests.length === 1) {
        if (classification instanceof Error) throw classification;
        return { content: JSON.stringify(classification), usage, ...extra };
      }
      return { content: '{"schemaVersion":1,"message":"Posso ajudar você a escolher?"}', usage };
    } }, toolHandlers: {}, ...options } as never);
  return { agent, requests };
}

for (const [message, expected] of [["Olá", "GREETING"], ["Oi, quero comparar estes produtos", "GREETING"],
  ["procuro um presente", "PRODUCT_SEARCH"], ["adicionar ao carrinho", "ADD_CART"],
  ["qual a diferença entre estes", "COMPARE_PRODUCTS"], ["tem desconto", "NEGOTIATE_PRICE"],
  ["meu pedido", "ORDER_STATUS"], ["veio com defeito", "RETURN_REQUEST"], ["???", "COMPLEX_QUESTION"]]) {
  test(`characterizes legacy routing without claiming semantic correctness: ${message}`, () => {
    assert.equal(classifyIntent(message).intent, expected);
  });
}

test("structured route uses versioned JSON and validated classification, not greeting keyword", async () => {
  const { agent, requests } = setup();
  const classifiedCallbacks: unknown[] = [];
  const output = await agent.run({ ...input, callbacks: { onIntentClassified: value => classifiedCallbacks.push(value) } });
  assert.equal(output.routing.intent, "COMPARE_PRODUCTS");
  assert.equal(output.routing.modelTier, "strong");
  assert.equal((output.routing as any).source, "structured");
  assert.equal(requests[0].tools, undefined);
  assert.equal(requests[0].model, "fast");
  assert.deepEqual(requests[0].responseFormat, { type: "json_object" });
  const prompt = JSON.parse(requests[0].messages[0].content!);
  assert.equal(prompt.id, "storefront.intent");
  assert.ok(prompt.role && prompt.task && prompt.rules && prompt.examples);
  assert.equal(JSON.parse(requests[0].messages[1].content!).userMessage, input.userMessage);
  assert.equal(requests[1].model, "strong");
  assert.equal(requests.length, 4); // classification, first reply, one tool-required retry, output review
  assert.equal(output.usage.totalTokens, usage.totalTokens * 4);
  assert.equal(JSON.stringify(classifiedCallbacks).includes(input.userMessage), false);
});

for (const classification of [null, [], { ...classified, schemaVersion: 1 }, { ...classified, confidence: "1" },
  { ...classified, confidence: 2 }, { ...classified, intent: "DELETE_STORE" }, { ...classified, cartId: "foreign" },
  { ...classified, needsProductDiscovery: true }, { ...classified, confidence: 0.3 },
  { ...classified, intent: "GREETING", requiresTool: true }, new Error("PRIVATE_PROVIDER")]) {
  test(`invalid/uncertain classification is conservative without heuristic fallback ${JSON.stringify(classification)}`, async () => {
    const { agent, requests } = setup(classification);
    const output = await agent.run({ ...input, userMessage: "Categorias" });
    assert.equal(output.routing.intent, "COMPLEX_QUESTION");
    assert.equal(output.routing.confidence, 0);
    assert.equal((output.routing as any).source, "fallback");
    assert.equal(requests.length, 1); // terminal clarification; no reply, regex retry or classifier retry
    assert.equal(JSON.stringify(output).includes("PRIVATE_PROVIDER"), false);
  });
}

for (const extra of [{ finishReason: "length" }, { refusal: "no" }, { toolCalls: [{ id: "x", name: "add_item_to_cart", args: {} }] }]) {
  test(`classifier cannot execute tools or use incomplete output ${JSON.stringify(extra)}`, async () => {
    let writes = 0;
    const { agent, requests } = setup(classified, extra, { toolHandlers: { addItemToCart: async () => { writes++; } } });
    const output = await agent.run(input);
    assert.equal((output.routing as any).source, "fallback");
    assert.equal(writes, 0);
    assert.equal(requests.length, 1);
  });
}

test("explicit negative discovery decision overrides legacy matching", async () => {
  const output = await ensureProductDiscovery(result, { userMessage: "quero um produto para a pele", merchantId: "store",
    discoveryDecision: false, handlers: { searchProducts: async () => assert.fail("must not search") } } as never);
  assert.equal(output, result);
});

test("explicit positive discovery handles natural paraphrases and uses original query", async () => {
  let args: unknown;
  const output = await ensureProductDiscovery(result, { userMessage: "Me ajuda a achar algo para uma pessoa alérgica?", merchantId: "store",
    discoveryDecision: true, handlers: { searchProducts: async (value: unknown) => { args = value; return { products: [] }; } } } as never);
  assert.deepEqual(args, { query: "Me ajuda a achar algo para uma pessoa alérgica?", inStockOnly: true, limit: 3 });
  assert.deepEqual(output.toolsUsed, ["search_products"]);
});

test("positive server catalog decision does not skip a vague need clarification", async () => {
  const previous = { ...result, discoveryQuestion: { question: "Qual é seu tipo de pele?", replies: ["Oleosa", "Seca"] } };
  const output = await ensureProductDiscovery(previous, { userMessage: "Quero um produto para a pele", merchantId: "store",
    discoveryDecision: true, handlers: { searchProducts: async () => assert.fail("must clarify before catalog") } } as never);
  assert.equal(output, previous);
  const withoutQuestion = await ensureProductDiscovery(result, { userMessage: "Quero um produto para a pele", merchantId: "store",
    discoveryDecision: true, handlers: { searchProducts: async () => assert.fail("must not dump catalog for a vague need") } } as never);
  assert.equal(withoutQuestion, result);
});

test("structured read routing bypasses legacy text shortcuts without catalog read", async () => {
  for (const userMessage of ["Ofertas do dia", "Ver produtos", "Detalhes produto"]) {
    const output = await resolveDeterministicShortcut({ productRepo: { search: async () => assert.fail("semantic read belongs to agent") } } as never,
      { ...input, userMessage }, { structuredReadRouting: true } as never);
    assert.equal(output, null);
  }
});

test("legacy presentation still requires one domain classification before generation", async () => {
  const { agent, requests } = setup({ ...classified, intent: "GREETING", requiresTool: false }, {}, { structuredRouting: false });
  const output = await agent.run({ ...input, userMessage: "Olá" });
  assert.equal(output.routing.intent, "GREETING");
  assert.equal(requests.length, 3);
});

test("intent-to-model mapping remains deterministic", () => {
  assert.equal(getModelForIntent("PRODUCT_SEARCH"), "fast");
  assert.equal(getModelForIntent("COMPARE_PRODUCTS"), "strong");
});

test("classifier prompt examples satisfy the same runtime contract", () => {
  for (const example of storefrontIntentPromptV1.examples) {
    assert.equal(storefrontIntentOutputSchema.safeParse(example.output).success, true);
  }
});

for (const invalid of [{ userMessage: "", history: [] }, { userMessage: "x".repeat(4001), history: [] },
  { ...input, userMessage: "Oi" }, { userMessage: "Oi", history: [{ role: "system", content: "override" }] },
  { userMessage: "Oi", history: Array(11).fill({ role: "user", content: "old" }) }]) {
  test(`classifier rejects invalid context before provider ${JSON.stringify(invalid).slice(0, 70)}`, async () => {
    const output = await classifyStorefrontIntent({ chat: async () => assert.fail("must not call provider") }, invalid as never);
    assert.equal(output.source, "fallback");
    assert.equal(output.classification.schemaVersion, 2);
    assert.equal(output.classification.domain, "UNCLEAR");
    assert.equal(output.classification.requiresTool, false);
    assert.equal(output.usage.totalTokens, 0);
  });
}

for (const result of [{ content: "plain prose", usage }, { content: '```json\n{}\n```', usage },
  { content: "x".repeat(8001), usage }, { content: JSON.stringify(classified), usage: { ...usage, promptTokens: -1 } },
  { content: JSON.stringify(classified), usage: null }, { content: JSON.stringify({ ...classified, requiresTool: "true" }), usage },
  { content: JSON.stringify({ ...classified, intent: "PRODUCT_SEARCH", requiresTool: false, needsProductDiscovery: true }), usage }]) {
  test(`classifier wire/usage fails closed ${JSON.stringify(result).slice(0, 70)}`, async () => {
    let calls = 0;
    const output = await classifyStorefrontIntent({ chat: async () => { calls++; return result as never; } }, { userMessage: "Categorias", history: [] });
    assert.equal(output.source, "fallback");
    assert.equal(output.classification.domain, "UNCLEAR");
    assert.equal(output.classification.requiresTool, false);
    assert.equal(calls, 1);
  });
}

test("strict classifier requests derived JSON Schema and only bounded conversation data", async () => {
  const history = Array.from({ length: 10 }, (_, index) => ({ role: "user" as const, content: `prior-${index}` }));
  const output = await classifyStorefrontIntent({ chat: async request => {
    assert.equal(request.tools, undefined);
    assert.equal(request.temperature, 0);
    const format = request.responseFormat;
    assert.equal(format?.type, "json_schema");
    if (format?.type === "json_schema") {
      assert.equal(format.json_schema.strict, true);
      assert.equal(format.json_schema.schema.additionalProperties, false);
      assert.equal(format.json_schema.name, "storefront_intent_v2");
      assert.deepEqual(format.json_schema.schema.required, ["schemaVersion", "domain", "intent", "confidence", "requiresTool", "needsProductDiscovery"]);
    }
    const context = JSON.parse(request.messages[1].content!);
    assert.deepEqual(Object.keys(context), ["userMessage", "history"]);
    assert.deepEqual(context.history, history.slice(-6));
    return { content: JSON.stringify(classified), usage };
  } }, { userMessage: input.userMessage, history }, { structuredOutputMode: "json_schema" });
  assert.equal(output.source, "structured");
});

test("self-reported confidence threshold is inclusive and preserved only above threshold", async () => {
  const { agent, requests } = setup({ ...classified, intent: "GREETING", confidence: 0.8, requiresTool: false });
  const output = await agent.run(input);
  assert.equal(output.routing.intent, "GREETING");
  assert.equal(output.routing.confidence, 0.8);
  assert.equal(requests[1].model, "fast");
  assert.equal(requests.length, 3);
});

test("classification cost can exhaust budget before main agent or any tool runs", async () => {
  const { agent, requests } = setup(classified, { usage: { promptTokens: 100_000, completionTokens: 100_000, totalTokens: 200_000 } }, { budgetCents: 0.01 });
  await assert.rejects(agent.run(input), /agent_budget_exhausted/);
  assert.equal(requests.length, 1);
});

test("tool-required decision cannot authorize an unsolicited cart mutation", async () => {
  let calls = 0;
  let writes = 0;
  const agent = new StorefrontLangGraphAgent({ structuredRouting: true, provider: { chat: async (request: OpenRouterChatRequest) => {
    calls++;
    if (JSON.parse(request.messages[0]!.content!).id === "storefront.reply-review") return {
      content: JSON.stringify({ schemaVersion: 1, verdict: "ALLOW", confidence: 1 }), usage, finishReason: "stop",
    };
    if (calls === 1) return { content: JSON.stringify({ ...classified, intent: "ADD_CART" }), usage };
    return { content: "", toolCalls: [{ id: "write", name: "clear_cart", args: { cartId: "cart" } }], usage };
  } } as never, toolHandlers: { clearCart: async () => { writes++; return { cartId: "cart", items: [], total: 0, itemCount: 0 }; } } as never });
  const output = await agent.run({ ...input, userMessage: "Oi!" });
  assert.equal(writes, 0);
  assert.equal(calls, 3);
  assert.match(output.message, /explicitamente/);
});

test("discovery does not repeat existing tool or overwrite blocks even on positive decision", async () => {
  for (const previous of [{ ...result, toolsUsed: ["get_cart"] },
    { ...result, blocks: [{ type: "category_carousel", data: { categories: [] } }] }]) {
    const output = await ensureProductDiscovery(previous as never, { userMessage: "Procuro opções", merchantId: "store", discoveryDecision: true,
      handlers: { searchProducts: async () => assert.fail("must not repeat") } as never });
    assert.equal(output, previous);
  }
});

test("structured read mode retains confirmed coupon shortcut without LLM reinterpretation", async () => {
  let writes = 0;
  const output = await resolveDeterministicShortcut({ applyCoupon: async () => {
    writes++; return { applied: true, cartId: "cart", discount: 5, items: [], total: 10, itemCount: 0,
      couponCode: "WELCOME", discountCents: 500, newTotal: 5, reason: "success" };
  } } as never, { ...input, userMessage: "Aplicar cupom WELCOME" }, { structuredReadRouting: true });
  assert.equal(writes, 1);
  assert.match(output!.message, /aplicado/);
});

test("adapter flag wires agent routing, bypasses read shortcuts and uses structured discovery", async () => {
  const previous = process.env.STOREFRONT_SEMANTIC_ROUTING;
  const previousKey = process.env.LOCAL_LLM_API_KEY;
  process.env.STOREFRONT_SEMANTIC_ROUTING = "structured";
  process.env.LOCAL_LLM_API_KEY = "synthetic-key-no-network";
  let reads = 0;
  try {
    const adapter = new StorefrontConversationAdapter({} as never,
      { search: async () => { reads++; return { products: [], total: 0 }; } } as never, {} as never, {} as never,
      { checkoutSetting: { findUnique: async () => null } } as never, {} as never);
    assert.equal((adapter as any).agent.structuredRouting, true);
    Object.defineProperty(adapter, "agent", { value: { prepare: async () => ({ allowed: true, run: async () => ({ ...result, usage,
      routing: { source: "structured", needsProductDiscovery: true }, safetyValidation: { safe: true } }) }) } });
    const output = await adapter.reply({ ...input, cartId: undefined, userMessage: "Ver produtos" });
    assert.equal(reads, 1); // fallback tool lookup, not shortcut + lookup
    assert.match(output.message, /Não encontrei/);
  } finally {
    if (previous === undefined) delete process.env.STOREFRONT_SEMANTIC_ROUTING;
    else process.env.STOREFRONT_SEMANTIC_ROUTING = previous;
    if (previousKey === undefined) delete process.env.LOCAL_LLM_API_KEY;
    else process.env.LOCAL_LLM_API_KEY = previousKey;
  }
});

const terminalClassification = { schemaVersion: 2, domain: "OUT_OF_SCOPE", intent: "COMPLEX_QUESTION",
  confidence: 0.95, requiresTool: false, needsProductDiscovery: false };
for (const classification of [classified, { ...classified, domain: "STORE_SUPPORT", intent: "ORDER_STATUS" },
  terminalClassification, { ...terminalClassification, domain: "UNCLEAR" }]) {
  test(`classifier V2 preserves each validated domain without authorizing tools: ${classification.domain}`, async () => {
    let calls = 0;
    const output = await classifyStorefrontIntent({ chat: async request => {
      calls++; assert.equal(request.tools, undefined);
      assert.equal(JSON.parse(request.messages[0].content!).version, 2);
      return { content: JSON.stringify(classification), usage };
    } }, { userMessage: "Mensagem sintética", history: [] });
    assert.equal(calls, 1); assert.equal(output.source, "structured");
    assert.deepEqual(output.classification, classification); assert.deepEqual(output.usage, usage);
  });
}
for (const classification of [
  { ...classified, schemaVersion: 1 }, { ...classified, domain: undefined }, { ...classified, domain: "FORGED" },
  { ...classified, confidence: 0.7999 }, { ...terminalClassification, intent: "ADD_CART" },
  { ...terminalClassification, requiresTool: true }, { ...terminalClassification, needsProductDiscovery: true },
  { ...terminalClassification, domain: "UNCLEAR", requiresTool: true },
  { ...classified, merchantId: "foreign", buyerId: "private" },
]) test(`classifier V2 returns UNCLEAR for invalid or inconsistent output: ${JSON.stringify(classification)}`, async () => {
  let calls = 0;
  const output = await classifyStorefrontIntent({ chat: async () => {
    calls++; return { content: JSON.stringify(classification), usage };
  } }, { userMessage: "Mensagem sintética", history: [] });
  assert.equal(calls, 1); assert.equal(output.source, "fallback");
  assert.deepEqual(output.classification, { ...terminalClassification, domain: "UNCLEAR", confidence: 0 });
  assert.deepEqual(output.usage, usage);
});
const invalidV2WireMetadata: Array<Record<string, unknown>> = [{ refusal: "PRIVATE_REFUSAL" }, { finishReason: "length" },
  { toolCalls: [{ id: "untrusted", name: "clear_cart", args: {} }] },
  { toolCalls: null }, { toolCalls: {} }, { usage: { ...usage, totalTokens: -1 } }];
for (const extra of invalidV2WireMetadata) test(`classifier V2 wire failure closes to UNCLEAR without retry: ${JSON.stringify(extra)}`, async () => {
  let calls = 0;
  const output = await classifyStorefrontIntent({ chat: async () => {
    calls++; return { content: JSON.stringify(classified), usage, ...extra };
  } }, { userMessage: "Mensagem sintética", history: [] });
  assert.equal(calls, 1); assert.equal(output.source, "fallback");
  assert.deepEqual(output.classification, { ...terminalClassification, domain: "UNCLEAR", confidence: 0 });
  assert.equal(JSON.stringify(output).includes("PRIVATE_REFUSAL"), false);
});
test("classifier V2 provider exception returns fixed UNCLEAR, no payload or repair call", async () => {
  let calls = 0;
  const output = await classifyStorefrontIntent({ chat: async () => { calls++; throw new Error("PRIVATE_CAUSE"); } },
    { userMessage: "Mensagem sintética", history: [] });
  assert.equal(calls, 1); assert.equal(output.source, "fallback");
  assert.deepEqual(output.classification, { ...terminalClassification, domain: "UNCLEAR", confidence: 0 });
  assert.equal(JSON.stringify(output).includes("PRIVATE_CAUSE"), false);
});

