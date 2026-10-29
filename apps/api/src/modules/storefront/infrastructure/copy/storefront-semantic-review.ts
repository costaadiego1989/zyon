import type { CostTracker, OpenRouterProvider, OpenRouterChatRequest } from "@zyon/conversation-engine";
import { storefrontCopyReviewOutputSchema, storefrontCopyReviewJsonSchema,
  storefrontReplyReviewInputSchema } from "../../domain/contracts/storefront-secondary-guardrails.schemas.js";
import { parseCopyWireResult } from "../../domain/contracts/storefront-copy.schemas.js";
import { storefrontIntentUsageSchema } from "../../domain/contracts/storefront-intent.schemas.js";
import { storefrontReplyReviewPromptV1 } from "../../domain/prompts/storefront-secondary-guardrails.v1.js";
import { observeStorefrontChat, recordStorefrontDecision } from "../observability/storefront-observation.js";

/** Shared with microcopy; the verdict never authorizes commerce or tools. */
export function allowsStorefrontSemanticReview(result: unknown): boolean {
  const parsed = storefrontCopyReviewOutputSchema.safeParse(parseCopyWireResult(result));
  return parsed.success && parsed.data.verdict === "ALLOW" && parsed.data.confidence >= 0.9;
}

export interface StorefrontReviewBudget { tracker: Pick<CostTracker, "canAfford" | "record" | "pricing">; reservedCents: number }
const zeroUsage = () => ({ promptTokens: 0, completionTokens: 0, totalTokens: 0 });

/** One bounded, tool-free call. Never repair, retry, switch provider or throw a
 * reviewer failure into the commerce turn after an operation may have committed. */
export async function reviewStorefrontReply(provider: Pick<OpenRouterProvider, "chat">, raw: unknown,
  options: { model: string; mode: "json_object" | "json_schema"; budget: StorefrontReviewBudget }) {
  const parsed = storefrontReplyReviewInputSchema.safeParse(raw);
  if (!parsed.success) {
    recordStorefrontDecision("validation", "fallback", "invalid_input", { phase: "output_review" });
    return { allowed: false, usage: zeroUsage() };
  }
  const messages: OpenRouterChatRequest["messages"] = [
    { role: "system", content: JSON.stringify(storefrontReplyReviewPromptV1) },
    { role: "user", content: JSON.stringify(parsed.data) },
  ];
  // Conservative upper estimate, including message framing. Unknown usage is
  // charged this bound and rejected, never treated as a free successful review.
  const promptBound = Buffer.byteLength(JSON.stringify(messages), "utf8") + 256;
  const estimate = { promptTokens: promptBound, completionTokens: 120, totalTokens: promptBound + 120 };
  const { tracker } = options.budget;
  const reserve = (estimate.promptTokens * tracker.pricing.promptPer1k + estimate.completionTokens * tracker.pricing.completionPer1k) / 1000;
  if (!tracker.canAfford(reserve + options.budget.reservedCents)) {
    recordStorefrontDecision("validation", "fallback", "budget_exhausted", { phase: "output_review" });
    return { allowed: false, usage: zeroUsage() };
  }
  options.budget.reservedCents += reserve;
  let accounted = false;
  try {
    const result = await observeStorefrontChat(provider, { messages, model: options.model, signal: AbortSignal.timeout(15_000),
      responseFormat: options.mode === "json_schema"
        ? { type: "json_schema", json_schema: { name: "storefront_reply_review_v1", strict: true, schema: storefrontCopyReviewJsonSchema } }
        : { type: "json_object" }, temperature: 0, maxTokens: 120,
    }, "primary", "output_review", options.model);
    const usage = storefrontIntentUsageSchema.safeParse(result.usage);
    const known = result.usageKnown !== false && usage.success && usage.data.totalTokens === usage.data.promptTokens + usage.data.completionTokens;
    const charged = known ? usage.data : estimate;
    tracker.record(charged); accounted = true;
    const allowed = known && result.finishReason === "stop" && tracker.canAfford(0) && allowsStorefrontSemanticReview(result);
    if (!allowed) recordStorefrontDecision("validation", "fallback", !known ? "invalid_usage" : "safety_rejected", { phase: "output_review" });
    return { allowed, usage: charged };
  } catch {
    if (!accounted) tracker.record(estimate);
    recordStorefrontDecision("validation", "fallback", "exception", { phase: "output_review" });
    return { allowed: false, usage: estimate };
  } finally { options.budget.reservedCents -= reserve; }
}
