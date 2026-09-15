/**
 * Central union of every WhatsApp business-initiated message type across the
 * platform. Each type maps to one catalog definition and (per merchant WABA)
 * one Meta-approved template.
 */
export const WHATSAPP_TEMPLATE_TYPES = [
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
  // Cart recovery
  "cart_recovery",
  // Transactional order notifications
  "order_confirmation",
  "order_shipped",
  "order_delivered",
  // Transactional identity verification for the checkout email fallback.
  "checkout_otp",
] as const;

export type WhatsAppTemplateType = (typeof WHATSAPP_TEMPLATE_TYPES)[number];

export type WhatsAppTemplateCategory = "UTILITY" | "MARKETING";

export const WHATSAPP_TEMPLATE_CHANNELS = ["whatsapp", "email"] as const;
export type WhatsAppTemplateChannel = (typeof WHATSAPP_TEMPLATE_CHANNELS)[number];

export function isWhatsAppTemplateType(v: string): v is WhatsAppTemplateType {
  return (WHATSAPP_TEMPLATE_TYPES as readonly string[]).includes(v);
}
