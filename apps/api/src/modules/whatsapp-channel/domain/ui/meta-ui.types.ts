import type { ConversationBlock } from "../../../storefront/domain/types/conversation-block.js";

export type StoreUiAction =
  | { kind: "message"; message: string }
  | { kind: "tool"; tool: string; args: Record<string, unknown> }
  | { kind: "variant"; productId: string; variantId: string }
  | { kind: "option"; productId: string; groupId: string; itemId: string }
  | { kind: "slot"; productId: string; slotId: string }
  | { kind: "option_group"; productId: string; groupId?: string }
  | { kind: "page"; page: number }
  | { kind: "back" }
  | { kind: "menu" };

export interface MetaUiChoice { label: string; description?: string; action: StoreUiAction }
export type MetaUiMessage =
  | { type: "text"; text: { body: string; preview_url?: boolean } }
  | { type: "image" | "video" | "document"; media: { link: string; caption?: string } }
  | { type: "interactive"; interactive: Record<string, unknown> };

export interface MetaUiView {
  title: string;
  body: string;
  choices: MetaUiChoice[];
  media: MetaUiMessage[];
  blocks: Array<ConversationBlock | { type: string; data: Record<string, unknown> }>;
  quickReplies: string[];
}

export interface MetaUiPresentation {
  messages: MetaUiMessage[];
  selections: Record<string, StoreUiAction>;
  numericSelections: StoreUiAction[];
  page: number;
  totalPages: number;
}

export interface WhatsAppConversationState {
  version: 1;
  conversationId: string;
  stage: "store" | "checkout";
  checkoutSessionId?: string;
  checkoutConversationId?: string;
  checkoutGeneration?: number;
  payment?: { intentId: string; sessionId: string; amount_cents: number; status: string; copy_paste?: string; ticket_url?: string };
  expectsFreeInput?: boolean;
  history: Array<{ role: "user" | "assistant"; content: string }>;
  revision: string;
  view?: MetaUiView;
  selections?: Record<string, StoreUiAction>;
  numericSelections?: StoreUiAction[];
  page: number;
  previousViews: MetaUiView[];
  selectedProductId?: string;
  selectedVariantId?: string;
  selectedOptionItemIds?: string[];
  selectedOptionGroupId?: string;
  selectedServiceSlotId?: string;
  pendingFlow?: { token: string; field: "fullName" | "email" | "cpf" | "zip" | "number" | "complement"; checkoutSessionId: string; expiresAt: number };
  catalogId?: string;
  catalogRetailerIds?: Record<string, string>;
  catalogPrices?: Record<string, number>;
  flowIds?: Record<string, string>;
}

export interface WhatsAppStructuredResponse {
  agentMessage: string;
  quickReplies: string[];
  blocks: MetaUiView["blocks"];
  merchantName?: string;
  state: WhatsAppConversationState;
}
