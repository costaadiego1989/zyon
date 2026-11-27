/** Trusted in-process contract. Channel controllers remain responsible for authentication. */
export const MARKETING_RELATIONSHIP = Symbol("MARKETING_RELATIONSHIP");
export const MARKETING_CONSENT_VERSION = "marketing-opening-v1";
export const MARKETING_CONSENT_TEXT =
  "Quer receber novidades e ofertas desta loja pelo WhatsApp?";
export const MARKETING_ACCEPT = "marketing_accept_v1";
export const MARKETING_DECLINE = "marketing_decline_v1";
export const MERCHANT_MARKETING_MESSAGING = Symbol(
  "MERCHANT_MARKETING_MESSAGING"
);
export interface MerchantMarketingSendResult {
  status: "accepted" | "unknown" | "failed" | "suppressed";
  messageId?: string;
  reason?: string;
}
export interface MerchantMarketingTemplate {
  name: string;
  status: string;
  wabaId: string | null;
}
export interface MerchantMarketingMessaging {
  sendFreeform(input: {
    merchantId: string;
    phone: string;
    deviceId: string | null;
    text: string;
  }): Promise<MerchantMarketingSendResult>;
  sendOpening(input: {
    merchantId: string;
    phone: string;
    deviceId: string | null;
    text: string;
  }): Promise<MerchantMarketingSendResult>;
  submitTemplate(input: {
    merchantId: string;
    name: string;
    body: string;
    language: string;
  }): Promise<MerchantMarketingTemplate>;
  checkTemplate(input: {
    merchantId: string;
    name: string;
    body: string;
    language: string;
    wabaId: string | null;
  }): Promise<boolean>;
  inspectTemplate?(input: {
    merchantId: string;
    name: string;
    body: string;
    language: string;
    wabaId: string | null;
  }): Promise<MerchantMarketingTemplate>;
  sendCampaign(input: {
    merchantId: string;
    phone: string;
    templateName: string;
    body: string;
    language: string;
    wabaId: string | null;
  }): Promise<MerchantMarketingSendResult>;
}
export interface MarketingInboundMessage {
  merchantId: string;
  channel: "site" | "whatsapp";
  conversationKey: string;
  messageId: string;
  text: string;
  receivedAt: string;
  deviceId?: string;
  /** WhatsApp ingress proves this phone; site input must never set this from a form. */
  verifiedPhone?: string;
  /** Only from a verified buyer token, never an arbitrary request-body id. */
  accountId?: string;
  consentChoice?: "granted" | "declined";
  historical?: boolean;
}
export interface MarketingInboundDecision {
  conversationId: string;
  contactId: string | null;
  human: boolean;
  openingRequired: boolean;
  originalQuestion: string;
  duplicate: boolean;
  responseKey?: string;
  optedOut?: boolean;
}
export interface MarketingRelationshipPort {
  enabled(merchantId: string): Promise<boolean>;
  inbound(input: MarketingInboundMessage): Promise<MarketingInboundDecision>;
  aiReply(
    merchantId: string,
    conversationId: string,
    messageId: string,
    content: string,
    deliver: () => Promise<{
      status: "accepted" | "unknown" | "failed";
      messageId?: string;
    }>
  ): Promise<boolean>;
  opening(
    merchantId: string,
    conversationId: string,
    deliver: () => Promise<MerchantMarketingSendResult>
  ): Promise<boolean>;
  delivery(
    merchantId: string,
    messageId: string,
    status: "accepted" | "delivered" | "read" | "failed"
  ): Promise<void>;
  permission(
    merchantId: string,
    accountId: string,
    channel: "email" | "whatsapp"
  ): Promise<boolean | null>;
  reserveCommercial(
    merchantId: string,
    accountId: string,
    dispatchKey: string
  ): Promise<boolean>;
  identified(
    merchantId: string,
    accountId: string,
    conversationKey?: string
  ): Promise<void>;
  conversationState(
    merchantId: string,
    channel: "site" | "whatsapp",
    conversationKey: string
  ): Promise<{ mode: "ai" | "human" } | null>;
  commerce(merchantId: string, conversationKey: string): Promise<void>;
  history(
    merchantId: string,
    channel: "site" | "whatsapp",
    conversationKey: string
  ): Promise<Array<{
    id: string;
    role: "buyer" | "ai" | "agent" | "system";
    content: string;
    createdAt: string;
    status: string;
    requestId?: string;
  }> | null>;
}
