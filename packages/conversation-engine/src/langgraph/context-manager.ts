/**
 * Context manager — enforces the 8K token ceiling on the LLM message window.
 *
 * Strategy:
 *  - System message is ALWAYS retained (forced first).
 *  - Walk newest → oldest, append while total <= maxTokens.
 *  - Reverse for output so the conversation reads top → bottom chronologically.
 *
 * Tokens are estimated via the same heuristic used elsewhere (≈4 chars/token).
 * Pass pre-computed `tokens` to bypass estimation.
 */

import { estimateTokens } from "./cost-tracker.js";

export interface ContextMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tokens?: number;
  /** Optional name / tool_call_id passthrough. */
  name?: string;
}

export interface ContextManagerOptions {
  /** Maximum token budget for the whole window. */
  maxTokens: number;
}

export const DEFAULT_CONTEXT_WINDOW = 8000;

export class ContextManager {
  readonly maxTokens: number;

  constructor(opts: ContextManagerOptions) {
    if (!opts || typeof opts.maxTokens !== "number" || opts.maxTokens <= 0) {
      throw new Error("context_manager: maxTokens must be a positive number");
    }
    this.maxTokens = opts.maxTokens;
  }

  /**
   * Estimate token count for content; use provided `tokens` field if present.
   */
  static estimateTokens(content: string): number {
    return estimateTokens(content);
  }

  totalTokens(messages: ContextMessage[]): number {
    return messages.reduce((acc, m) => acc + (m.tokens ?? estimateTokens(m.content)), 0);
  }

  /**
   * Convenience: tokenize a list of messages that don't have explicit token
   * counts yet, then trim to budget.
   */
  fromMessages(messages: Array<Omit<ContextMessage, "tokens">>): ContextMessage[] {
    const tokenized: ContextMessage[] = messages.map((m) => ({
      ...m,
      tokens: estimateTokens(m.content)
    }));
    return this.trim(tokenized);
  }

  /**
   * Trim messages to fit under maxTokens. System messages are always retained
   * and NEVER truncated (per spec: config context is never trimmed).
   * Non-system messages are kept newest-first until the budget is full.
   */
  trim(messages: ContextMessage[]): ContextMessage[] {
    if (messages.length === 0) return [];

    // Separate system message(s) from the rest.
    const systemMessages = messages.filter((m) => m.role === "system");
    const others = messages.filter((m) => m.role !== "system");

    const systemTokens = systemMessages.reduce(
      (acc, m) => acc + (m.tokens ?? estimateTokens(m.content)),
      0
    );

    // System messages are ALWAYS retained in full, even if they exceed maxTokens.
    // This ensures merchant config context and safety rules are never trimmed.
    if (systemTokens >= this.maxTokens) {
      return [...systemMessages];
    }

    let remaining = this.maxTokens - systemTokens;
    const keptReversed: ContextMessage[] = [];

    for (let i = others.length - 1; i >= 0; i -= 1) {
      const m = others[i]!;
      const mTokens = m.tokens ?? estimateTokens(m.content);
      if (mTokens <= remaining) {
        keptReversed.push(m);
        remaining -= mTokens;
      } else if (keptReversed.length === 0 && remaining > 0) {
        // Always keep at least the most recent non-system message.
        keptReversed.push(m);
        break;
      }
    }

    const kept = [...keptReversed].reverse();
    return [...systemMessages, ...kept];
  }
}