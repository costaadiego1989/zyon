import assert from "node:assert/strict";
import test from "node:test";
import { createAllowedScopeAgent } from "./storefront-scope.fixture.js";
import { STOREFRONT_REPLY_CONTRACT_REMINDER } from "./storefront-reply-contract.js";

const usage = { promptTokens: 5, completionTokens: 5, totalTokens: 10 };
const reply = (message: string) => JSON.stringify({ schemaVersion: 1, message });
const message = "Compare o Kit Organizador Essencial e o Kit Organizador Completo para levar poucos cabos na mochila. Explique as diferenças, sem adicionar nem cobrar.";
const input = { merchantId: "merchant", sessionId: "owned", cartId: "owned", userMessage: message,
  history: [{ role: "user" as const, content: message },
    { role: "assistant" as const, content: "Não encontrei esses dois kits com esses nomes. Quer que eu procure?" },
    { role: "user" as const, content: "Está caro para mim." },
    { role: "assistant" as const, content: "Qual faixa de valor fica confortável?" },
    { role: "user" as const, content: message }],
};
const classification = { intent: "COMPARE_PRODUCTS" as const, requiresTool: true, needsProductDiscovery: false };
const comparison = { comparison: [{ id: "essential", name: "Kit Organizador Essencial", price: 6000, attributes: { cor: "preto" }, stock: 10,
  description: "Estojo de 0,5 L com uma divisória e duas presilhas." },
  { id: "complete", name: "Kit Organizador Completo", price: 10000, attributes: { cor: "preto" }, stock: 10,
    description: "Estojo de 2 L com três divisórias e seis presilhas." }], requiresProductNames: false };
const tool = { id: "comparison", name: "compare_products", args: { productNames: ["Kit Organizador Essencial", "Kit Organizador Completo"], includeSimilar: false } };
const demand = { type: "function", function: { name: "compare_products" } };

test("restored comparison context cannot let main and retry omit the mandatory current read", async () => {
  const requests: any[] = []; let reads = 0;
  const agent = createAllowedScopeAgent({ structuredRouting: true,
    toolHandlers: { compareProducts: async (args: unknown) => { reads++; assert.deepEqual(args, tool.args); return comparison; } } as never,
    provider: { chat: async (request: any) => {
      requests.push(structuredClone(request));
      if (requests.length === 1 || requests.length === 2 && !request.toolChoice)
        return { content: reply("Não encontrei os kits. Posso procurar?"), usage };
      if (requests.length === 2) return { content: "", toolCalls: [tool], usage };
      return { content: reply("O Essencial tem 0,5 L e uma divisória; o Completo tem 2 L e três divisórias. Para poucos cabos, o Essencial é mais compacto."), usage };
    } } as never }, classification);
  const result = await agent.run(input);
  assert.equal(reads, 1); assert.equal(requests.length, 3);
  assert.deepEqual(requests[1].toolChoice, demand);
  assert.deepEqual(requests[1].tools.map((value: any) => value.function.name), ["compare_products"]);
  assert.deepEqual(requests[1].messages.at(-1), { role: "system", content: STOREFRONT_REPLY_CONTRACT_REMINDER });
  assert.equal(requests[1].responseFormat.type, "json_object");
  assert.equal(result.safetyValidation.safe, true); assert.deepEqual(result.toolsUsed, ["compare_products"]);
  assert.equal(result.blocks.some(block => block.type === "product_comparison"), true);
  assert.match(result.message, /Essencial|Completo/); assert.doesNotMatch(result.message, /não consegui confirmar/i);
});

test("a provider cannot execute an unadvertised write during a demanded comparison read", async () => {
  let calls = 0, writes = 0;
  const agent = createAllowedScopeAgent({ structuredRouting: true,
    toolHandlers: { createQuestion: async () => { writes++; return { id: "unexpected" }; } } as never,
    provider: { chat: async () => {
      calls++; return calls === 1 ? { content: reply("Posso procurar os produtos?"), usage }
        : calls === 2 ? { content: "", toolCalls: [{ id: "write", name: "create_question", args: { productId: "essential", question: "Not requested", authorName: "Customer" } }], usage }
          : { content: reply("Sua pergunta foi enviada."), usage };
    } } as never }, classification);
  const result = await agent.run(input);
  assert.equal(writes, 0); assert.equal(result.safetyValidation.safe, false);
  assert.deepEqual(result.toolsUsed, []); assert.deepEqual(result.blocks, []);
  assert.doesNotMatch(result.message, /Sua pergunta foi enviada/);
});

test("a provider that ignores or rejects forced read receives no fabricated comparison", async () => {
  for (const rejects of [false, true]) {
    let calls = 0, reads = 0;
    const agent = createAllowedScopeAgent({ structuredRouting: true,
      toolHandlers: { compareProducts: async () => { reads++; return comparison; } } as never,
      provider: { chat: async () => { calls++; if (calls === 2 && rejects) throw Error("unsupported_tool_choice");
        return { content: reply("Não encontrei os kits."), usage }; } } as never }, classification);
    const result = await agent.run(input);
    assert.equal(calls, 2); assert.equal(reads, 0); assert.equal(result.safetyValidation.safe, false); assert.deepEqual(result.blocks, []);
    assert.doesNotMatch(result.message, /unsupported_tool_choice|Não encontrei os kits/);
  }
});

test("mixed comparison responses execute only the announced read, regardless of call order", async () => {
  for (const readFirst of [false, true]) {
    let calls = 0, writes = 0, reads = 0;
    const unexpected = { id: "write", name: "create_question", args: { productId: "essential", question: "Not requested", authorName: "Customer" } };
    const agent = createAllowedScopeAgent({ structuredRouting: true,
      toolHandlers: { compareProducts: async () => { reads++; return comparison; },
        createQuestion: async () => { writes++; return { id: "unexpected" }; } } as never,
      provider: { chat: async () => { calls++; return calls === 2
        ? { content: "", toolCalls: readFirst ? [tool, unexpected] : [unexpected, tool], usage }
        : { content: reply("O Essencial tem uma divisória e o Completo tem três divisórias."), usage }; } } as never }, classification);
    const result = await agent.run(input);
    assert.equal(reads, 1); assert.equal(writes, 0); assert.deepEqual(result.toolsUsed, ["compare_products"]);
    assert.equal(result.blocks.some(block => block.type === "product_comparison"), true);
  }
});

test("an unexpected prototype key cannot become read evidence or alter tool results", async () => {
  let calls = 0;
  const agent = createAllowedScopeAgent({ structuredRouting: true, toolHandlers: {} as never,
    provider: { chat: async () => { calls++; return calls === 2
      ? { content: "", toolCalls: [{ id: "unexpected", name: "__proto__", args: { comparison } }], usage }
      : { content: reply("Os dois kits são iguais."), usage }; } } as never }, classification);
  const result = await agent.run(input);
  assert.deepEqual(result.toolsUsed, []); assert.equal(result.safetyValidation.safe, false); assert.deepEqual(result.blocks, []);
});

test("the comparison intent owns its read demand even when the classifier tool flag is false", async () => {
  for (const available of [false, true]) {
    let calls = 0, reads = 0;
    const agent = createAllowedScopeAgent({ structuredRouting: true,
      toolHandlers: { compareProducts: async () => { reads++; return comparison; } } as never,
      provider: { chat: async (request: any) => {
        calls++;
        if (calls === 2) {
          assert.deepEqual(request.toolChoice, demand);
          if (!available) throw Error("provider_read_unavailable");
          return { content: "", toolCalls: [tool], usage };
        }
        return { content: reply("O Essencial tem uma divisória e o Completo tem três divisórias."), usage };
      } } as never }, { ...classification, requiresTool: false });
    const result = await agent.run(input);
    assert.equal(reads, available ? 1 : 0); assert.equal(result.safetyValidation.safe, available);
    assert.equal(result.blocks.some(block => block.type === "product_comparison"), available);
    if (!available) assert.equal(result.safetyValidation.reason, "required_read_unconfirmed");
  }
});

test("malformed comparison arguments do not bypass the strict tool contract", async () => {
  let calls = 0, reads = 0;
  const agent = createAllowedScopeAgent({ structuredRouting: true,
    toolHandlers: { compareProducts: async () => { reads++; return comparison; } } as never,
    provider: { chat: async () => { calls++; return calls === 2 ? { content: "", toolCalls: [{ ...tool, args: { productNames: "Invented shape" } }], usage }
      : { content: reply("Os kits são iguais."), usage }; } } as never }, classification);
  const result = await agent.run(input);
  assert.equal(reads, 0); assert.equal(result.safetyValidation.safe, false); assert.deepEqual(result.blocks, []);
});

test("a failed comparison read never becomes a comparison from history", async () => {
  let calls = 0, reads = 0;
  const agent = createAllowedScopeAgent({ structuredRouting: true,
    toolHandlers: { compareProducts: async () => { reads++; throw Error("PRIVATE_CATALOG_TIMEOUT"); } } as never,
    provider: { chat: async () => { calls++; return calls === 2 ? { content: "", toolCalls: [tool], usage }
      : { content: reply("Os kits são iguais."), usage }; } } as never }, classification);
  const result = await agent.run(input);
  assert.equal(reads, 1); assert.equal(result.safetyValidation.safe, false); assert.deepEqual(result.blocks, []);
  assert.doesNotMatch(result.message, /PRIVATE_CATALOG_TIMEOUT|Os kits são iguais/);
});

test("malformed main JSON is not repaired or retried by the comparison demand", async () => {
  for (const requiresTool of [false, true]) {
    let calls = 0, reads = 0, writes = 0;
    const agent = createAllowedScopeAgent({ structuredRouting: true,
      toolHandlers: { compareProducts: async () => { reads++; return comparison; }, createQuestion: async () => { writes++; } } as never,
      provider: { chat: async () => { calls++; return { content: "not-json", usage }; } } as never }, { ...classification, requiresTool });
    const result = await agent.run(input);
    assert.equal(calls, 1); assert.equal(reads, 0); assert.equal(writes, 0); assert.deepEqual(result.blocks, []);
  }
});

test("an unknown mutation is terminal and cannot become a forced comparison retry", async () => {
  let calls = 0, writes = 0;
  const agent = createAllowedScopeAgent({ structuredRouting: true,
    toolHandlers: { addItemToCart: async () => { writes++; throw Error("PRIVATE_UNKNOWN_ACK"); } } as never,
    provider: { chat: async () => { assert.equal(++calls, 1); return { content: "", toolCalls: [{ id: "add", name: "add_item_to_cart", args: { variantId: "essential", quantity: 1 } }], usage }; } } as never }, classification);
  const result = await agent.run({ ...input, userMessage: "Adicione uma unidade do Kit ao carrinho.", history: [] });
  assert.equal(writes, 1); assert.match(result.message, /Não consegui confirmar/); assert.deepEqual(result.toolsUsed, ["add_item_to_cart"]);
});
