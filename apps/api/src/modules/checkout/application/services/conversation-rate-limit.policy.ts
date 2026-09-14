/**
 * Product policy for abuse prevention. This is a per-conversation throughput
 * safeguard; it does not meter or cap the merchant's monthly AI usage.
 */
export const CONVERSATION_RATE_LIMIT_WINDOW_MS = 60_000;

const MESSAGES_PER_MINUTE = {
  starter: 10,
  growth: 30,
  scale: 60,
} as const;

export type ConversationRateLimitPlan = keyof typeof MESSAGES_PER_MINUTE;

export function conversationRateLimitForPlan(plan: string): {
  plan: ConversationRateLimitPlan;
  messagesPerMinute: number;
} {
  const normalized: ConversationRateLimitPlan =
    plan === "growth" || plan === "scale" ? plan : "starter";

  return {
    plan: normalized,
    messagesPerMinute: MESSAGES_PER_MINUTE[normalized],
  };
}
