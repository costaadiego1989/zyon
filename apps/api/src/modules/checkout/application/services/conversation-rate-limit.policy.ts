/**
 * Compatibility policy for callers displaying plan throughput. All plans use
 * ten messages per user; enforcement lives in AiUserRateLimitService.
 */
export const CONVERSATION_RATE_LIMIT_WINDOW_MS = 60_000;

const MESSAGES_PER_MINUTE = {
  starter: 10,
  growth: 10,
  scale: 10,
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
