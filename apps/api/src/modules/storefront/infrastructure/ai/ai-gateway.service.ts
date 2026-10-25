import { Injectable, Logger } from "@nestjs/common";
import { LocalLLMProvider } from "./local-llm-provider.js";
import {
  OpenRouterProvider,
  type OpenAIChatMessage,
  type OpenAIChatResult
} from "./openrouter-provider.js";
import { ModelRouter } from "./model-router.js";
import { BudgetTrackerService, MerchantPlan } from "./budget-tracker.service.js";

export interface AIGatewayMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface AIGatewayContext {
  merchantId: string;
  plan?: MerchantPlan;
  conversationLength: number;
  userMessage: string;
}

export interface AIGatewayResult {
  content: string;
  model: string;
  provider: "local" | "openai" | "fallback";
  tokens: {
    prompt: number;
    completion: number;
    total: number;
  };
  latencyMs: number;
  costEstimate: number; // USD
}

const OPENAI_COST_INPUT_PER_1M = 0.15; // $/1M input tokens
const OPENAI_COST_OUTPUT_PER_1M = 0.6; // $/1M output tokens
const LOCAL_COST = 0;

const FALLBACK_RESPONSE = "Como posso ajudá-lo?";

@Injectable()
export class AIGatewayService {
  private readonly logger = new Logger(AIGatewayService.name);
  private readonly router: ModelRouter;

  constructor(
    private readonly localLlm: LocalLLMProvider,
    private readonly openai: OpenRouterProvider,
    private readonly budgetTracker: BudgetTrackerService
  ) {
    this.router = new ModelRouter();
  }

  async routeAndCall(
    messages: AIGatewayMessage[],
    context: AIGatewayContext
  ): Promise<AIGatewayResult> {
    const start = Date.now();
    const intent = this.router.detectIntent(context.userMessage);
    const plan = context.plan ?? MerchantPlan.STORE_ONLY;
    const isOverBudget = await this.budgetTracker.isOverBudget(context.merchantId, plan);

    const decision = this.router.route({
      intentCategory: intent.category,
      isOverBudget,
      conversationLength: context.conversationLength
    });

    this.logger.debug(
      `Routing: intent=${intent.category} budget_over=${isOverBudget} decision=${decision.model} reason="${decision.reason}"`
    );

    let result: AIGatewayResult;
    if (decision.model === "local") {
      result = await this.tryLocalFirst(messages, start);
    } else {
      result = await this.tryOpenAIFirst(messages, start);
    }

    await this.budgetTracker.increment(context.merchantId);

    this.logger.log(
      `AI call: provider=${result.provider} model=${result.model} tokens=${result.tokens.total} latency=${result.latencyMs}ms cost=$${result.costEstimate.toFixed(6)}`
    );

    return result;
  }

  private async tryLocalFirst(
    messages: AIGatewayMessage[],
    start: number
  ): Promise<AIGatewayResult> {
    const localResult = await this.localLlm.chat({
      messages: messages.map((m) => ({ role: m.role, content: m.content }))
    });

    if (localResult && localResult.content.length > 0) {
      const latency = Date.now() - start;
      return {
        content: localResult.content,
        model: this.localLlm.model,
        provider: "local",
        tokens: {
          prompt: localResult.usage.prompt_tokens,
          completion: localResult.usage.completion_tokens,
          total: localResult.usage.total_tokens
        },
        latencyMs: latency,
        costEstimate: LOCAL_COST
      };
    }

    this.logger.warn("Local LLM unavailable; falling back to OpenAI");
    return this.tryOpenAI(messages, start);
  }

  private async tryOpenAIFirst(
    messages: AIGatewayMessage[],
    start: number
  ): Promise<AIGatewayResult> {
    if (!this.openai.isAvailable()) {
      this.logger.warn("OpenAI not configured; falling back to local LLM");
      return this.tryLocalFirst(messages, start);
    }

    try {
      return await this.tryOpenAI(messages, start);
    } catch (error) {
      this.logger.warn(`OpenAI failed: ${(error as Error).message}; falling back to local`);
      const localResult = await this.localLlm.chat({
        messages: messages.map((m) => ({ role: m.role, content: m.content }))
      });

      if (localResult && localResult.content.length > 0) {
        const latency = Date.now() - start;
        return {
          content: localResult.content,
          model: this.localLlm.model,
          provider: "local",
          tokens: {
            prompt: localResult.usage.prompt_tokens,
            completion: localResult.usage.completion_tokens,
            total: localResult.usage.total_tokens
          },
          latencyMs: latency,
          costEstimate: LOCAL_COST
        };
      }

      return this.deterministicFallback(start);
    }
  }

  private async tryOpenAI(
    messages: AIGatewayMessage[],
    start: number
  ): Promise<AIGatewayResult> {
    if (!this.openai.isAvailable()) {
      return this.deterministicFallback(start);
    }

    const openaiMsgs: OpenAIChatMessage[] = messages.map((m) => ({
      role: m.role,
      content: m.content
    }));

    const result: OpenAIChatResult = await this.openai.chat({ messages: openaiMsgs });
    const latency = Date.now() - start;

    const costEstimate =
      (result.usage.prompt_tokens / 1_000_000) * OPENAI_COST_INPUT_PER_1M +
      (result.usage.completion_tokens / 1_000_000) * OPENAI_COST_OUTPUT_PER_1M;

    return {
      content: result.content || FALLBACK_RESPONSE,
      model: this.openai.model,
      provider: "openai",
      tokens: {
        prompt: result.usage.prompt_tokens,
        completion: result.usage.completion_tokens,
        total: result.usage.total_tokens
      },
      latencyMs: latency,
      costEstimate
    };
  }

  private deterministicFallback(start: number): AIGatewayResult {
    this.logger.error("Both providers failed; returning deterministic fallback");
    const latency = Date.now() - start;
    return {
      content: FALLBACK_RESPONSE,
      model: "none",
      provider: "fallback",
      tokens: { prompt: 0, completion: 0, total: 0 },
      latencyMs: latency,
      costEstimate: 0
    };
  }
}
