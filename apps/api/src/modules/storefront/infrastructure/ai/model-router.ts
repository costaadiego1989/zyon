/**
 * Hybrid AI model router.
 *
 * Routes requests to local LLM (90%) vs OpenAI (10%) based on:
 *   - Intent complexity (SIMPLE → local, COMPLEX → OpenAI)
 *   - Budget constraints (over budget → always local)
 *   - Conversation length (>15 msgs → OpenAI for context)
 *
 * SIMPLE intents (local):
 *   PRODUCT_SEARCH, ADD_CART, REMOVE_CART, GET_CART, CHECK_STOCK,
 *   GREETING, FAQ, ORDER_STATUS
 *
 * COMPLEX intents (OpenAI):
 *   COMPARE_PRODUCTS, NEGOTIATE_PRICE, RECOMMEND_PERSONALIZED,
 *   COMPLEX_QUESTION, COMPLAINT
 */

export type IntentCategory = "SIMPLE" | "COMPLEX";

export interface IntentDetectionResult {
  category: IntentCategory;
  confidence: number;
}

export interface ModelRouteDecision {
  model: "local" | "openai";
  reason: string;
}

const SIMPLE_KEYWORDS = ["product", "search", "add cart", "remove cart", "cart", "stock", "check", "order status", "greeting", "faq", "hello", "hi", "what is"];
const COMPLEX_KEYWORDS = ["compare", "negotiate", "price", "recommend", "personalize", "complex", "complaint", "help", "issue", "problem"];

export class ModelRouter {
  private readonly localLlmRouter = 0.9; // 90% local by default

  /**
   * Detect user intent from message.
   */
  detectIntent(message: string): IntentDetectionResult {
    const lower = message.toLowerCase();

    // Count keyword matches.
    const simpleMatches = SIMPLE_KEYWORDS.filter((kw) => lower.includes(kw)).length;
    const complexMatches = COMPLEX_KEYWORDS.filter((kw) => lower.includes(kw)).length;

    // Categorize.
    if (complexMatches > simpleMatches) {
      return { category: "COMPLEX", confidence: Math.min(complexMatches / 2, 1) };
    }

    if (simpleMatches > 0) {
      return { category: "SIMPLE", confidence: Math.min(simpleMatches / 3, 1) };
    }

    // Default to SIMPLE if no matches.
    return { category: "SIMPLE", confidence: 0.5 };
  }

  /**
   * Route based on intent, budget, and conversation history.
   *
   * Logic:
   *   1. If over budget → always local
   *   2. If conversation > 15 messages → OpenAI (better context)
   *   3. If SIMPLE intent → local (90% probability)
   *   4. If COMPLEX intent → OpenAI
   */
  route(opts: {
    intentCategory: IntentCategory;
    isOverBudget: boolean;
    conversationLength: number;
  }): ModelRouteDecision {
    // Over budget → always local (never block merchant).
    if (opts.isOverBudget) {
      return {
        model: "local",
        reason: "Over monthly budget; using local LLM only"
      };
    }

    // Long conversation → use OpenAI for better context handling.
    if (opts.conversationLength > 15) {
      return {
        model: "openai",
        reason: "Long conversation (>15 msgs); using OpenAI for context"
      };
    }

    // COMPLEX intents → OpenAI.
    if (opts.intentCategory === "COMPLEX") {
      return {
        model: "openai",
        reason: "Complex intent; using OpenAI"
      };
    }

    // SIMPLE intents → local (90% of the time).
    if (Math.random() < this.localLlmRouter) {
      return {
        model: "local",
        reason: "Simple intent & within budget; using local LLM (90% routing)"
      };
    }

    return {
      model: "openai",
      reason: "Simple intent but OpenAI fallback (10% routing)"
    };
  }
}
