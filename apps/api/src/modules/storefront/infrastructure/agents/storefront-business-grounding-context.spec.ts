import assert from "node:assert/strict";
import test from "node:test";
import { StorefrontLangGraphAgent } from "./store-langgraph-agent.js";
import { sendStoreMessageInputSchema, storefrontDeferredContextSchema } from "../../domain/contracts/storefront-conversation.schemas.js";

test("T71 grounded business context reaches the one prepared generator only after scope admission", async () => {
  let classifier = 0, generation = 0;
  const agent = new StorefrontLangGraphAgent({ provider: { async chat() {
    classifier++;
    return { content: JSON.stringify({ schemaVersion: 2, domain: "STORE_SUPPORT", intent: "COMPLEX_QUESTION",
      confidence: 0.99, requiresTool: false, needsProductDiscovery: false }),
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 } };
  } } as never, toolHandlers: {} as never });
  Object.defineProperty(agent, "runTurn", { value: async (input: Record<string, unknown>) => {
    generation++; assert.equal(input.groundedBusinessContext, true); assert.equal(input.knowledgeContext, "QUOTED_CURRENT_PUBLIC_CONTEXT");
    assert.equal(input.merchantId, "synthetic-t71-store");
    return { message: "Current answer", blocks: [], toolsUsed: [], cartId: "cart" };
  } });
  const prepared = await agent.prepare({ merchantId: "synthetic-t71-store", sessionId: "turn", cartId: "cart",
    userMessage: "Quais serviços a empresa oferece?", history: [], storeCategory: "services" });
  assert.equal(prepared.allowed, true); if (!prepared.allowed) assert.fail("admitted_turn_required");
  assert.equal(generation, 0); assert.equal(classifier, 1);
  const result = await prepared.run({ knowledgeContext: "QUOTED_CURRENT_PUBLIC_CONTEXT", groundedBusinessContext: true });
  assert.equal(result.message, "Current answer"); assert.equal(generation, 1); assert.equal(classifier, 1);
  await assert.rejects(prepared.run({ groundedBusinessContext: true }), /prepared_turn_consumed/);
});

test("T71 the grounding flag is not accepted from buyer or deferred payloads", () => {
  assert.equal(sendStoreMessageInputSchema.safeParse({ merchant_id: "store", conversation_id: "turn",
    user_message: "oi", groundedBusinessContext: true }).success, false);
  assert.equal(storefrontDeferredContextSchema.safeParse({ groundedBusinessContext: true }).success, false);
});
