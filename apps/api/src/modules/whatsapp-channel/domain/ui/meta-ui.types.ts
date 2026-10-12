import type { ConversationBlock } from "../../../storefront/domain/types/conversation-block.js";

export type StoreUiAction =
  | { kind: "message"; message: string }
  | { kind: "tool"; tool: string; args: Record<string, unknown> }
  | { kind: "variant"; productId: string; variantId: string }
  | { kind: "option"; productId: string; groupId: string; itemId: string }
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
  catalogId?: string;
  catalogRetailerIds?: Record<string, string>;
  flowIds?: Record<string, string>;
}

export interface WhatsAppStructuredResponse {
  agentMessage: string;
  quickReplies: string[];
  blocks: MetaUiView["blocks"];
  merchantName?: string;
  state: WhatsAppConversationState;
}
