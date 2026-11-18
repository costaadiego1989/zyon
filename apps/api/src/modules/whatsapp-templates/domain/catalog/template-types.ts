/**
 * Central union of every WhatsApp business-initiated message type across the
 * platform. Each type maps to one catalog definition and (per merchant WABA)
 * one Meta-approved template.
 */
export const WHATSAPP_TEMPLATE_TYPES = [
  'campaign_ready',
  "marketplace_operational_alert",
  // Merchant subscription notices
  "plan_expiry_7d", "plan_expiry_3d", "plan_expiry_24h", "plan_expiry_expired",
  // Post-sale
  "follow_up",
  "review_request",
  "nps",
  "cross_sell",
  "win_back",
  "loyalty",
  "reorder",
  "shopping_agent_alert",
  "cashback_available",
  "cashback_expiring",
  // Cart recovery
  "cart_recovery",
  // Transactional order notifications
  "order_confirmation",
  "fiscal_invoice",
  "order_nonphysical_confirmation",
  "digital_delivery",
  "order_shipped",
  "order_delivered",
  // Transactional return and exchange decisions
  "return_authorized", "return_approved", "return_rejected", "return_refunded", "exchange_completed", "return_posting_code", "return_declaration_ready",
  // Transactional identity verification for the checkout email fallback.
  "checkout_otp",
  "buyer_whatsapp_link_otp",
] as const;

export type WhatsAppTemplateType = (typeof WHATSAPP_TEMPLATE_TYPES)[number];

export type WhatsAppTemplateCategory = "UTILITY" | "MARKETING" | "AUTHENTICATION";

export const WHATSAPP_TEMPLATE_CHANNELS = ["whatsapp", "email"] as const;
export type WhatsAppTemplateChannel = (typeof WHATSAPP_TEMPLATE_CHANNELS)[number];

export function isWhatsAppTemplateType(v: string): v is WhatsAppTemplateType {
  return (WHATSAPP_TEMPLATE_TYPES as readonly string[]).includes(v);
}

/** Distinct authentication purposes retain their existing validity periods. */
export function authenticationExpirationMinutesFor(type: string): 5 | 10 | undefined {
  return type === "buyer_whatsapp_link_otp" ? 5 : type === "checkout_otp" ? 10 : undefined;
}
export function isAuthenticationTemplateType(type: string): boolean {
  return authenticationExpirationMinutesFor(type) !== undefined;
}
