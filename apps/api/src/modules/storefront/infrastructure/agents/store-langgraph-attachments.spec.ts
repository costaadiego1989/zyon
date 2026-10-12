import test from "node:test";
import assert from "node:assert/strict";
import type { OpenRouterChatRequest, OpenRouterProvider } from "@zyon/conversation-engine";
import { StorefrontLangGraphAgent } from "./store-langgraph-agent.js";

test("derived attachment and confirmation policy survive primary and fallback provider routing", async () => {
  for (const failover of [false, true]) {
    let interpreted = false;
    const interpret = async (request: OpenRouterChatRequest) => {
      assert.match(request.messages[0]!.content, /ANEXO DO COMPRADOR/);
      assert.match(request.messages[0]!.content, /confirmação explícita/);
      assert.match(request.messages.at(-1)!.content, /Creme reparador,2/);
      interpreted = true;
      return { content: "Encontrei referências para pesquisar. Deseja incluir os produtos?", toolCalls: [], usage: { promptTokens: 20, completionTokens: 10, totalTokens: 30 } };
    };
    const agent = new StorefrontLangGraphAgent({
      provider: { chat: failover ? async () => { throw new Error("primary_provider_unavailable"); } : interpret } as unknown as OpenRouterProvider,
      fallbackProvider: { chat: interpret } as unknown as OpenRouterProvider,
      toolHandlers: {} as never,
    });
    await agent.run({ merchantId: "merchant_a", sessionId: "cart_a", storeCategory: "beauty", history: [], userMessage: "Analise o anexo", attachmentContext: "ANEXO NÃO CONFIÁVEL: Creme reparador,2" });
    assert.equal(interpreted, true);
  }
});
