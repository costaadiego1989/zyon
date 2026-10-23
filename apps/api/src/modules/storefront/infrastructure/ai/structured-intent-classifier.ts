import type { OpenRouterProvider, OpenRouterChatRequest } from "@zyon/conversation-engine";
import { parseCopyWireResult } from "../../domain/contracts/storefront-copy.schemas.js";
import { storefrontIntentInputSchema, storefrontIntentOutputSchema, storefrontIntentJsonSchema,
  storefrontIntentUsageSchema, isConsistentStorefrontIntent, type StorefrontSemanticIntent } from "../../domain/contracts/storefront-intent.schemas.js";
import { storefrontIntentPromptV1 } from "../../domain/prompts/storefront-intent.v1.js";
import { observeStorefrontChat, observeStorefrontOperation, recordStorefrontDecision } from "../observability/storefront-observation.js";

export interface StructuredIntentResult {
  classification: StorefrontSemanticIntent;
  source: "structured" | "fallback";
  usage: { promptTokens: number; completionTokens: number; totalTokens: number };
}

export async function classifyStorefrontIntent(provider: Pick<OpenRouterProvider, "chat">,
  input: { userMessage: string; history: Array<{ role: "user" | "assistant"; content: string }> },
  options: { model?: string; structuredOutputMode?: "json_object" | "json_schema" } = {},
): Promise<StructuredIntentResult> {
  return observeStorefrontOperation("classifier", () => classify(provider, input, options));
}

async function classify(provider: Pick<OpenRouterProvider, "chat">,
  input: { userMessage: string; history: Array<{ role: "user" | "assistant"; content: string }> },
  options: { model?: string; structuredOutputMode?: "json_object" | "json_schema" },
): Promise<StructuredIntentResult> {
  const fallback: StructuredIntentResult = { source: "fallback", usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    classification: { schemaVersion: 2, domain: "UNCLEAR", intent: "COMPLEX_QUESTION", confidence: 0, requiresTool: false, needsProductDiscovery: false } };
  const parsed = storefrontIntentInputSchema.safeParse(input);
  if (!parsed.success) { recordStorefrontDecision("classifier", "fallback", "invalid_input"); return fallback; }
  const responseFormat: NonNullable<OpenRouterChatRequest["responseFormat"]> = options.structuredOutputMode === "json_schema"
    ? { type: "json_schema", json_schema: { name: "storefront_intent_v2", strict: true, schema: storefrontIntentJsonSchema } }
    : { type: "json_object" };
  try {
    const result = await observeStorefrontChat(provider, {
      messages: [{ role: "system", content: JSON.stringify(storefrontIntentPromptV1) },
        { role: "user", content: JSON.stringify({ userMessage: parsed.data.userMessage, history: parsed.data.history.slice(-6) }) }],
      responseFormat, model: options.model, temperature: 0, maxTokens: 220,
    }, "primary", "classifier");
    const usage = storefrontIntentUsageSchema.safeParse(result.usage);
    if (usage.success) fallback.usage = usage.data;
    // Even if a provider disobeys tools:undefined, classifier tool calls are never executed.
    if (!usage.success || (result.toolCalls !== undefined && (!Array.isArray(result.toolCalls) || result.toolCalls.length > 0))) {
      recordStorefrontDecision("classifier", "fallback", usage.success ? "tool_calls" : "invalid_usage"); return fallback;
    }
    const classified = storefrontIntentOutputSchema.safeParse(parseCopyWireResult(result));
    if (!classified.success || classified.data.confidence < 0.8 || !isConsistentStorefrontIntent(classified.data)) {
      recordStorefrontDecision("classifier", "fallback", !classified.success ? "invalid_output"
        : classified.data.confidence < 0.8 ? "low_confidence" : "inconsistent"); return fallback;
    }
    return { source: "structured", classification: classified.data, usage: usage.data };
  } catch { recordStorefrontDecision("classifier", "fallback", "exception"); return fallback; } // No repair, retry, failover or keyword fallback.
}

