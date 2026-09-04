import type { ConversationBlock } from "../types/conversation-block.js";

export interface MerchantPolicy {
  maxDiscountPercent?: number;
  allowFreeShipping?: boolean;
  allowShippingDiscount?: boolean;
  freeShippingMinCartValue?: number;
  maxPartialShippingDiscount?: number;
  offerExpirationMinutes?: number;
}

export interface BuyerContext {
  globalUserId: string;
  name?: string;
  phone?: string;
  email?: string;
}

export interface StorefrontConversationInput {
  userMessage: string;
  cartId?: string;
  merchantId: string;
  sessionId: string;
  history: Array<{ role: "user" | "assistant"; content: string }>;
  merchantName?: string;
  storeCategory: string;
  storeSettings?: Record<string, any>;
  agentIdentity?: { agentName?: string; persona?: string; tone?: string; greeting?: string; language?: string };
  merchantPolicy?: MerchantPolicy;
  advancedRules?: string[];
  experimentSystemPrompt?: string;
  buyerContext?: BuyerContext;
  deviceType?: "mobile" | "tablet" | "desktop";
}

export interface StorefrontConversationOutput {
  message: string;
  blocks: ConversationBlock[];
  cartId?: string;
  suggestedNext?: string[];
}

export type NudgeTrigger = "idle_30_seconds" | "exit_intent_detected";

export interface NudgeCopyInput {
  merchantId: string;
  trigger: NudgeTrigger;
  stage?: "cart" | "browsing";
  experimentSystemPrompt?: string;
  agentTone?: string;
  availableOffers: string[];
  fallback: string;
}

export const STOREFRONT_CONVERSATION_PORT = Symbol("StorefrontConversationPort");

export interface StorefrontConversationPort {
  reply(input: StorefrontConversationInput): Promise<StorefrontConversationOutput>;
  generateNudge(input: NudgeCopyInput): Promise<string>;
}
