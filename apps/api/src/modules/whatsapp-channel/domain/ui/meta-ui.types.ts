import type { ConversationBlock } from "../../../storefront/domain/types/conversation-block.js";

export type StoreUiAction =
  | { kind: "message"; message: string }
  | { kind: "tool"; tool: string; args: Record<string, unknown> }
  | { kind: "variant"; productId: string; variantId: string }
  | { kind: "option"; productId: string; groupId: string; itemId: string }
  | { kind: "slot"; productId: string; slotId: string }
  | { kind: "option_group"; productId: string; groupId?: string }
  | { kind: "page"; page: number }
  | { kind: "catalog_options" }
  | { kind: "cart_edit_items" }
  | { kind: "back" }
  | { kind: "menu" };

export interface MetaUiChoice { label: string; description?: string; summary?: string; action: StoreUiAction; image?: { link: string; caption: string } }
export type MetaUiMessage =
  | { type: "text"; text: { body: string; preview_url?: boolean } }
  | { type: "image" | "video" | "document"; media: { link: string; caption?: string } }
  | { type: "sticker"; media: { link: string } }
  | { type: "interactive"; interactive: Record<string, unknown> };

export interface MetaUiView {
  stage?: "store" | "checkout";
  title: string;
  body: string;
  choices: MetaUiChoice[];
  media: MetaUiMessage[];
  blocks: Array<ConversationBlock | { type: string; data: Record<string, unknown> }>;
  quickReplies: string[];
  primaryAction?: MetaUiChoice & { body: string };
  productContext?: { productId: string; name: string; offerId?: string };
  cartEditing?: boolean;
  offerPresentation?: { confirmation: string; body: string; imageUrl?: string };
}

export interface MetaUiPresentation {
  messages: MetaUiMessage[];
  selections: Record<string, StoreUiAction>;
  numericSelections: StoreUiAction[];
  page: number;
  totalPages: number;
}

export interface WhatsAppConversationState {
  agentTone?: import("@zyon/shared-types").AgentTone;
  version: 1;
  conversationId: string;
  stage: "store" | "checkout";
  cartHasItems?: boolean;
  checkoutSessionId?: string;
  checkoutConversationId?: string;
  checkoutGeneration?: number;
  payment?: { intentId: string; sessionId: string; method?: "pix" | "card" | "boleto"; amount_cents: number; status: string; copy_paste?: string; ticket_url?: string };
  checkoutSummaryFingerprint?: string;
  paymentGeneration?: number;
  paymentRevision?: number;
  pendingCheckoutEdit?: { section: "payment" | "coupon"; fingerprint: string; intentId: string; method?: "pix" | "card" };
  pendingCoupon?: { sessionId: string; fingerprint: string };
  pendingProductQuestion?: { productId: string };
  buyerHub?: import("./buyer-hub.js").BuyerHubState;
  buyerHubIdentity?: { command: string; expiresAt: number };
  postCartOffer?: {
    id: string; merchantId: string; cartId: string; ruleId: string; kind: "recommendation" | "discount";
    variantId: string; productId: string; sourceVariantId: string; addedName: string; name: string;
    imageUrl?: string; expiresAt: number; status: "pending" | "accepted" | "declined" | "invalidated";
    expectedQuote: import("../../../cross-sell/domain/contracts/cross-sell-storefront-quote.schemas.js").CrossSellStorefrontQuote;
  };
  declinedCrossSellKeys?: string[];
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
  welcomeAnimationShown?: boolean;
  cartEmptyAnimationShown?: boolean;
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
