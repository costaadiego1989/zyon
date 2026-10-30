import type { OpenRouterChatRequest, OpenRouterProvider } from "@zyon/conversation-engine";
import { StorefrontLangGraphAgent, type StorefrontAgentDeps } from "./store-langgraph-agent.js";
import type { StorefrontSemanticIntent } from "../../domain/contracts/storefront-intent.schemas.js";

/** Existing agent suites exercise main/tool/retry behavior. Add the newly
 * mandatory, successful V2 preflight to their provider double, not an opt-out
 * to production. Their original counters still measure the same main calls.
 * Scope/cost/denial suites use raw providers and positive classifier usage. */
export function createAllowedScopeAgent(deps: StorefrontAgentDeps, classification: Partial<StorefrontSemanticIntent> = {}): StorefrontLangGraphAgent & { outputReviewRequests: OpenRouterChatRequest[] } {
  const primary = deps.provider;
  const outputReviewRequests: OpenRouterChatRequest[] = [];
  const provider = {
    async chat(request: OpenRouterChatRequest) {
      let classifier = false, review = false;
      try { const id = JSON.parse(request.messages[0]?.content ?? "null")?.id;
        classifier = id === "storefront.intent"; review = id === "storefront.reply-review"; }
      catch { /* Non-JSON main prompts still go to the existing provider double. */ }
      if (classifier) return {
        content: JSON.stringify({ schemaVersion: 2, domain: "STORE_COMMERCE", intent: "COMPLEX_QUESTION",
          confidence: 1, requiresTool: false, needsProductDiscovery: false, ...classification }),
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 }, finishReason: "stop",
      };
      if (review) {
        outputReviewRequests.push(structuredClone(request));
        return { content: JSON.stringify({ schemaVersion: 1, verdict: "ALLOW", confidence: 1 }),
          usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 }, finishReason: "stop" };
      }
      return primary.chat(request);
    },
  } as unknown as OpenRouterProvider;
  return Object.assign(new StorefrontLangGraphAgent({ ...deps, provider }), { outputReviewRequests });
}
