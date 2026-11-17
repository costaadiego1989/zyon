import { BadRequestException } from "@nestjs/common";
import { whatsappE164 } from "../../whatsapp-channel/domain/services/whatsapp-phone.js";

/** Private authenticated configuration, never part of company or FAQ context. */
export interface SupportNotificationSettings {
  channel: "whatsapp";
  fallbackPhone: string | null;
  version: number;
  updatedAt: string | null;
}

export function parseSupportNotificationRecipient(input: unknown): string | null {
  const invalid = () => new BadRequestException("support_notification_settings_invalid");
  if (!input || typeof input !== "object" || Array.isArray(input)
    || !Object.hasOwn(input, "fallbackPhone") || Object.keys(input).length !== 1) throw invalid();
  const value = (input as { fallbackPhone: unknown }).fallbackPhone;
  if (value === null) return null;
  if (typeof value !== "string" || value.length > 40) throw invalid();
  const normalized = whatsappE164(value);
  if (!normalized) throw invalid();
  return normalized;
}
