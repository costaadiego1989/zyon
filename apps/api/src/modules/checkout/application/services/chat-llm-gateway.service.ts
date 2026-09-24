import { Injectable, Logger } from "@nestjs/common";
import { checkoutChatProviders, CHECKOUT_CHAT_SAMPLING } from "../../domain/services/checkout-chat-provider.js";
import { checkoutChatTools, buildCheckoutChatPrompt, buildBuyerIntentContext,
  type CheckoutChatPromptInput, type LlmToolDefinition, type BuyerIntentPromptContext,
  type LlmMessage, type LlmCallResult } from "../../domain/services/checkout-chat-prompt.js";
export type { LlmToolDefinition, BuyerIntentPromptContext, LlmMessage, LlmCallResult } from "../../domain/services/checkout-chat-prompt.js";

/**
 * Gateway to local/cloud LLM providers.
 * Single Responsibility: send messages + tools to an LLM and return raw response.
 */
@Injectable()
export class ChatLlmGatewayService {
  private readonly logger = new Logger(ChatLlmGatewayService.name);

  getTools(): LlmToolDefinition[] { return checkoutChatTools(); }

  buildSystemPrompt(opts: CheckoutChatPromptInput): string { return buildCheckoutChatPrompt(opts); }

  buildBuyerIntentContext(intent?: BuyerIntentPromptContext): string | undefined { return buildBuyerIntentContext(intent); }

  /** Call the same ordered provider routes captured by baseline inspection. */
  async call(messages: LlmMessage[], tools: LlmToolDefinition[]): Promise<LlmCallResult | null> {
    const selected = process.env.CHECKOUT_LLM_PROVIDER?.trim().toLowerCase();
    if (selected && !["local", "openrouter", "openai", "deepseek"].includes(selected)) {
      this.logger.warn("checkout_llm_provider_invalid", { provider: selected });
      return null;
    }
    for (const provider of checkoutChatProviders()) {
      const result = await this.callProvider(provider.url, provider.key, provider.model, messages, tools, provider.timeoutMs);
      if (result) return result;
    }

    return null;
  }

  private async callProvider(
    url: string,
    key: string,
    model: string,
    messages: LlmMessage[],
    tools: LlmToolDefinition[],
    timeoutMs: number,
  ): Promise<LlmCallResult | null> {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
        body: JSON.stringify({ model, messages, tools, ...CHECKOUT_CHAT_SAMPLING }),
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (!res.ok) throw new Error(`http_${res.status}`);

      const json = await res.json() as any;
      const choice = json.choices?.[0];

      if (choice?.message?.tool_calls?.length) {
        return {
          content: choice.message.content?.trim() || null,
          toolCalls: choice.message.tool_calls,
        };
      }

      return {
        content: choice?.message?.content?.trim() || null,
        toolCalls: [],
      };
    } catch {
      return null;
    }
  }
}
