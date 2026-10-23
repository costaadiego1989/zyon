import { isSafeGeneratedMessageV2 } from "@zyon/conversation-engine";
import { STOREFRONT_COPY_FALLBACK, copyMessageSchema, nudgePublicOutputSchema, nudgeOfferSuffix } from "../contracts/storefront-copy.schemas.js";

export function safeCopyFallback(value: unknown): string {
  const parsed = nudgePublicOutputSchema.safeParse({ message: value });
  return parsed.success && isSafeGeneratedMessageV2(parsed.data.message) ? parsed.data.message : STOREFRONT_COPY_FALLBACK;
}

export function neutralGeneratedCopy(value: unknown, maxWords?: number): string | undefined {
  const parsed = copyMessageSchema.safeParse(value);
  if (!parsed.success || !isSafeGeneratedMessageV2(parsed.data)) return undefined;
  if (maxWords && parsed.data.split(/\s+/u).length > maxWords) return undefined;
  return parsed.data;
}

export function validNudgePortMessage(value: unknown, offers: readonly string[]): string | undefined {
  const parsed = nudgePublicOutputSchema.safeParse({ message: value });
  if (!parsed.success) return undefined;
  const message = parsed.data.message;
  if (neutralGeneratedCopy(message, 18)) return message;
  // Exact suffix matching is structural validation of our renderer, not semantic intent routing.
  for (const offer of offers) {
    const suffix = nudgeOfferSuffix(offer);
    if (message.endsWith(suffix) && neutralGeneratedCopy(message.slice(0, -suffix.length), 18)) return message;
  }
  return undefined;
}

