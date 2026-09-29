import { Injectable, Logger } from "@nestjs/common";
import { assertCheckoutChatBaseline, checkoutContractHash, type CheckoutChatBaseline } from "../../domain/services/checkout-chat-baseline.js";
import { checkoutChatProviders, CHECKOUT_CHAT_SAMPLING } from "../../infrastructure/adapters/checkout-chat-provider.js";
import { checkoutChatTools, buildCheckoutChatPrompt, buildBuyerIntentContext,
  type CheckoutChatPromptInput, type LlmToolDefinition, type BuyerIntentPromptContext,
  type LlmMessage, type LlmCallResult } from "../../domain/services/checkout-chat-prompt.js";
export type { LlmToolDefinition, BuyerIntentPromptContext, LlmMessage, LlmCallResult } from "../../domain/services/checkout-chat-prompt.js";

export type PinnedChatUsage = { prompt_tokens: number; completion_tokens: number; total_tokens: number };
export type PinnedChatResult = (
  | { outcome: "provider_completed"; result: LlmCallResult }
  | { outcome: "provider_not_dispatched" | "provider_failed" | "provider_unknown" }
) & { usage?: PinnedChatUsage; providerEventId?: string };

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

  /** One attempt against the captured route. Never falls back or retries an
   * uncertain request. This returns provider evidence, not a safe buyer reply. */
  async callPinned(merchantId: string, baseline: CheckoutChatBaseline, messages: LlmMessage[]): Promise<PinnedChatResult> {
    try { assertCheckoutChatBaseline(baseline, merchantId); }
    catch { return { outcome: "provider_not_dispatched" }; }
    const routes = checkoutChatProviders();
    const route = routes[0];
    if (process.env.REVENUE_CHECKOUT_CONTRACT_ENABLED !== "true"
      || process.env.CHECKOUT_BEHAVIOR_REVISION !== baseline.runtimeRevision
      || !process.env.CHECKOUT_LLM_PROVIDER?.trim() || routes.length !== 1 || !route
      || checkoutContractHash({ name: route.name, model: route.model,
        endpointHash: checkoutContractHash(route.url), timeoutMs: route.timeoutMs }) !== checkoutContractHash(baseline.provider)) {
      return { outcome: "provider_not_dispatched" };
    }
    const controller = new AbortController();
    // Keep the deadline active through body consumption, not just HTTP headers.
    const timer = setTimeout(() => controller.abort(), route.timeoutMs);
    try {
      const response = await fetch(route.url, {
        method: "POST", redirect: "error",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${route.key}` },
        body: JSON.stringify({ model: route.model, messages, tools: baseline.tools, ...baseline.sampling }),
        signal: controller.signal,
      });
      if (!response.ok) {
        await response.body?.cancel().catch(() => {});
        return { outcome: [400, 401, 403, 404, 422, 429].includes(response.status)
          ? "provider_failed" : "provider_unknown" };
      }
      const payload = await readBoundedProviderResponse(response);
      const result = parsePinnedChatResult(payload, baseline);
      const usage = parsePinnedUsage(payload, baseline.provider.model);
      return result ? { outcome: "provider_completed", result, ...usage } : { outcome: "provider_unknown", ...usage };
    } catch {
      // A network error/timeout does not prove the provider did not process it.
      return { outcome: "provider_unknown" };
    } finally { clearTimeout(timer); }
  }

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

/** Token evidence is separate from valid content. A charged but unusable reply
 * still has cost; absent/invalid counters must never be synthesized as zero. */
function parsePinnedUsage(payload: any, model: string): { usage?: PinnedChatUsage; providerEventId?: string } {
  if (payload?.model !== model) return {};
  const counts = payload?.usage;
  if (!counts || [counts.prompt_tokens, counts.completion_tokens, counts.total_tokens]
    .some(value => !Number.isSafeInteger(value) || value < 0 || value > 2_147_483_647)
    || counts.prompt_tokens + counts.completion_tokens !== counts.total_tokens) return {};
  return { usage: { prompt_tokens: counts.prompt_tokens, completion_tokens: counts.completion_tokens, total_tokens: counts.total_tokens },
    ...(typeof payload.id === "string" && /^[a-zA-Z0-9_.:-]{1,200}$/.test(payload.id) ? { providerEventId: payload.id } : {}) };
}

async function readBoundedProviderResponse(response: Response): Promise<unknown> {
  if (!response.body) throw new Error("EMPTY_PROVIDER_BODY");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 200_000) throw new Error("PROVIDER_BODY_TOO_LARGE");
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

function parsePinnedChatResult(payload: any, baseline: CheckoutChatBaseline): LlmCallResult | undefined {
  // Exact provider model IDs are required for the pilot; moving aliases cannot
  // establish which behavior answered. Missing/mismatched evidence is uncertain.
  if (payload?.model !== baseline.provider.model || !Array.isArray(payload.choices) || payload.choices.length !== 1) return;
  const choice = payload.choices[0];
  const message = choice?.message;
  if (!message || message.role !== "assistant" || message.refusal
    || (message.content != null && typeof message.content !== "string")) return;
  const content = message.content?.trim() || null;
  const calls = message.tool_calls ?? [];
  if (!Array.isArray(calls) || calls.length > 16 || (!content && !calls.length)
    || choice.finish_reason !== (calls.length ? "tool_calls" : "stop")) return;
  const names = new Set(baseline.tools.map(t => t.function.name));
  for (const call of calls) {
    if (call?.type !== "function" || !names.has(call.function?.name) || typeof call.function?.arguments !== "string") return;
    try {
      const args = JSON.parse(call.function.arguments);
      if (!args || typeof args !== "object" || Array.isArray(args)) return;
    } catch { return; }
  }
  return { content, toolCalls: calls };
}
