import type { OpenRouterProvider, OpenRouterChatRequest } from "@zyon/conversation-engine";
import type { NudgeCopyInput } from "../../domain/ports/conversation.port.js";
import { variantCopyInputSchema, nudgeCopyInputSchema, variantCopyOutputSchema, nudgeCopyOutputSchema,
  copyJsonSchema, parseCopyWireResult, nudgeOfferSuffix } from "../../domain/contracts/storefront-copy.schemas.js";
import { neutralGeneratedCopy, safeCopyFallback } from "../../domain/services/storefront-copy-policy.js";
import { storefrontCopyPromptV1, storefrontNudgePromptV1 } from "../../domain/prompts/storefront-copy.v1.js";
import { observeStorefrontChat, recordStorefrontDecision } from "../observability/storefront-observation.js";
import { storefrontCopyReviewInputSchema,
  storefrontCopyReviewJsonSchema } from "../../domain/contracts/storefront-secondary-guardrails.schemas.js";
import { storefrontCopyReviewPromptV1 } from "../../domain/prompts/storefront-secondary-guardrails.v1.js";
import { allowsStorefrontSemanticReview } from "./storefront-semantic-review.js";

export class AgentCopyService {
  constructor(private readonly copyProvider: Pick<OpenRouterProvider, "chat">,
    private readonly options: { structuredOutputMode?: "json_object" | "json_schema"; model?: string } = {}) {}

  async generateVariantCopy(
    experimentSystemPrompt: string | undefined,
    instruction: string,
    fallback: string,
  ): Promise<string> {
    const safeFallback = safeCopyFallback(fallback);
    const parsed = variantCopyInputSchema.safeParse({ experimentSystemPrompt, instruction, fallback });
    if (!parsed.success || !parsed.data.experimentSystemPrompt?.trim()) return safeFallback;
    try {
      const result = await observeStorefrontChat(this.copyProvider, {
        messages: [
          { role: "system", content: JSON.stringify(storefrontCopyPromptV1) },
          { role: "user", content: JSON.stringify({ styleReference: parsed.data.experimentSystemPrompt, instruction: parsed.data.instruction }) },
        ],
        responseFormat: this.responseFormat("storefront_copy_v1", variantCopyOutputSchema),
        temperature: 0.3,
        maxTokens: 220,
      }, "copy", "variant", this.options.model);
      const output = variantCopyOutputSchema.safeParse(parseCopyWireResult(result));
      const message = output.success ? neutralGeneratedCopy(output.data.message) : undefined;
      if (!message) recordStorefrontDecision("validation", "fallback", "invalid_output", { phase: "variant" });
      return message && await this.reviewCopy(message, parsed.data.instruction, "variant") ? message : safeFallback;
    } catch {
      recordStorefrontDecision("validation", "fallback", "exception", { phase: "variant" });
      return safeFallback;
    }
  }

  async generateNudge(input: NudgeCopyInput): Promise<string> {
    const safeFallback = safeCopyFallback(input?.fallback);
    const parsed = nudgeCopyInputSchema.safeParse(input);
    if (!parsed.success) return safeFallback;
    const context = parsed.data;
    const styleReference = context.experimentSystemPrompt?.trim() || context.agentTone?.trim();
    if (!styleReference) return safeFallback;
    try {
      const result = await observeStorefrontChat(this.copyProvider, {
        messages: [
          { role: "system", content: JSON.stringify(storefrontNudgePromptV1) },
          { role: "user", content: JSON.stringify({ styleReference, trigger: context.trigger,
            stage: context.stage ?? "browsing", availableOffers: context.availableOffers }) },
        ],
        responseFormat: this.responseFormat("storefront_nudge_v1", nudgeCopyOutputSchema),
        temperature: 0.3, maxTokens: 220,
      }, "copy", "nudge", this.options.model);
      const output = nudgeCopyOutputSchema.safeParse(parseCopyWireResult(result));
      if (!output.success) { recordStorefrontDecision("validation", "fallback", "invalid_output", { phase: "nudge" }); return safeFallback; }
      const message = neutralGeneratedCopy(output.data.message, 18);
      if (!message) { recordStorefrontDecision("validation", "fallback", "safety_rejected", { phase: "nudge" }); return safeFallback; }
      const index = output.data.offerIndex;
      const offer = index === null ? undefined : context.availableOffers[index];
      if (index !== null && !offer) {
        recordStorefrontDecision("validation", "fallback", "invalid_output", { phase: "nudge" });
        return safeFallback;
      }
      const task = context.stage === "cart" ? "Ajude o comprador a revisar o carrinho da loja."
        : "Ajude o comprador a escolher produtos da loja.";
      if (!await this.reviewCopy(message, task, "nudge")) return safeFallback;
      return offer ? message + nudgeOfferSuffix(offer) : message;
    } catch { recordStorefrontDecision("validation", "fallback", "exception", { phase: "nudge" }); return safeFallback; }
  }

  /** Independent semantic decision: JSON format/commercial patterns alone do not
   * establish that a generated answer belongs to this store. No tool execution,
   * repair or alternate provider is allowed on rejection/uncertainty. */
  private async reviewCopy(candidate: string, task: string, phase: "variant" | "nudge"): Promise<boolean> {
    const input = storefrontCopyReviewInputSchema.safeParse({ candidate, task });
    if (!input.success) return false;
    const responseFormat: NonNullable<OpenRouterChatRequest["responseFormat"]> = this.options.structuredOutputMode === "json_schema"
      ? { type: "json_schema", json_schema: { name: "storefront_copy_review_v1", strict: true, schema: storefrontCopyReviewJsonSchema } }
      : { type: "json_object" };
    const result = await observeStorefrontChat(this.copyProvider, {
      messages: [{ role: "system", content: JSON.stringify(storefrontCopyReviewPromptV1) },
        { role: "user", content: JSON.stringify(input.data) }],
      responseFormat, temperature: 0, maxTokens: 120,
    }, "copy", phase, this.options.model);
    const allowed = allowsStorefrontSemanticReview(result);
    if (!allowed) recordStorefrontDecision("validation", "fallback", "safety_rejected", { phase });
    return allowed;
  }

  private responseFormat(name: string, schema: typeof variantCopyOutputSchema | typeof nudgeCopyOutputSchema): NonNullable<OpenRouterChatRequest["responseFormat"]> {
    return this.options.structuredOutputMode === "json_schema"
      ? { type: "json_schema", json_schema: { name, strict: true, schema: copyJsonSchema(schema) } }
      : { type: "json_object" };
  }
}
