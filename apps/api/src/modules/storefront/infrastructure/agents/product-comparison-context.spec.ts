import test from "node:test";
import assert from "node:assert/strict";
import { createAllowedScopeAgent } from "./storefront-scope.fixture.js";

test("comparison retains visible identities in the model window and sends compared names to the scope reviewer", async () => {
  let calls = 0;
  const agent = createAllowedScopeAgent({ provider: { chat: async (request: any) => {
    calls++;
    if (calls === 1) {
      const dialogue = request.messages.filter((m: any) => m.role !== "system").map((m: any) => m.content).join("\n");
      assert.match(dialogue, /"id":"one"/);assert.match(dialogue, /"id":"two"/);assert.match(dialogue, /até 100 reais/);
      return { content: "", toolCalls: [{ id: "compare", name: "compare_products", args: { productIds: ["one", "two"], includeSimilar: false } }], usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 } };
    }
    return { content: JSON.stringify({ schemaVersion: 1, message: "Confira as diferenças publicadas entre Mouse M170 e Teclado K120." }), toolCalls: [], usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 } };
  } } as any, toolHandlers: { compareProducts: async (args: any) => {
    assert.deepEqual(args.productIds, ["one", "two"]);
    return { comparison: [
      { id: "one", name: "Mouse M170", price: 6990, description: "Mouse sem fio", attributes: {}, stock: 10, rating: null },
      { id: "two", name: "Teclado K120", price: 7990, description: "Teclado USB", attributes: {}, stock: 10, rating: null },
    ], requiresProductNames: false };
  } } as any }, { intent: "COMPARE_PRODUCTS", requiresTool: true });
  const result = await agent.run({ merchantId: "qa", sessionId: "qa", userMessage: "compare ambos os produtos para eu ver qual e o melhor", history: [
    { role: "user", content: "Quero opções até 100 reais" },
    { role: "assistant", content: 'Produtos apresentados nesta página (somente identidade): [{"id":"one","name":"Mouse M170"},{"id":"two","name":"Teclado K120"}]' },
  ] });
  assert(result.blocks.some(b => b.type === "product_comparison"));
  assert.equal(calls, 2);
  const reviewer = JSON.stringify(agent.outputReviewRequests);
  assert.match(reviewer, /productReferences/);assert.match(reviewer, /Mouse M170/);assert.match(reviewer, /Teclado K120/);
});
