/**
 * Validator for generated (LLM) messages to ensure they don't contain unauthorized claims.
 *
 * INVARIANT (CLAUDE.md):
 * - LLM never authorizes offers.
 * - Never claim unauthorized discounts, free shipping, delivery guarantees, stock guarantees,
 *   payment confirmation, or request CVV/password.
 * - Always validate generated messages with isSafeGeneratedMessage.
 * - Unsafe generated messages must fall back to deterministic safe templates.
 *
 * Source of truth: @zyon/conversation-engine (offer-aware %). API keeps a thin
 * extra blacklist for phrasing the package does not cover.
 */

import { isSafeGeneratedMessage as packageIsSafeGeneratedMessage } from "@zyon/conversation-engine";
import type { AuthorizedOffer } from "@zyon/shared-types";

export interface MessageSafetyResult {
  safe: boolean;
  reason?: string;
}

/**
 * Extra API patterns (authorization-sounding phrasing without relying only on %).
 * Keep small — percentage / frete gates live in conversation-engine.
 */
const EXTRA_UNAUTHORIZED_PATTERNS = [
  /(?:estou|vou|posso)\s+(?:te\s+)?(?:dar|oferecer|conceder|aplicar)\s+(?:um\s+)?(?:desconto|cupom)/i,
  /(?:ganhou|garantido|aprovado)\s+(?:um\s+)?(?:desconto|cupom)/i,
  /(?:estou|vou)\s+(?:te\s+)?(?:dar|oferecer|conceder)\s+frete\s+gr[aá]tis/i,
  /(?:garanto|garantimos)\s+(?:que\s+)?(?:chega|entrega)/i,
  /(?:garanto|garantimos)\s+(?:que\s+)?(?:tem|h[aá])\s+(?:em\s+)?estoque/i,
  /(?:informe|digite|envie|preciso)\s+(?:o\s+)?(?:seu\s+)?(?:cvv|c[oó]digo\s+de\s+seguran[cç]a|senha|password)/i,
  /(?:I'm giving|I'll give|here's your)\s+\d+%\s+(?:off|discount)/i,
];

/**
 * Validates that a generated (LLM) message is safe to show the buyer.
 * Pass `offer` so authorized % / frete grátis can be mentioned when approved.
 */
export function isSafeGeneratedMessage(
  message: string,
  offer?: AuthorizedOffer,
): MessageSafetyResult {
  if (!message || message.trim().length === 0) {
    return { safe: true };
  }

  if (!packageIsSafeGeneratedMessage(message, offer)) {
    return {
      safe: false,
      reason: "Message failed conversation-engine safety validation",
    };
  }

  for (const pattern of EXTRA_UNAUTHORIZED_PATTERNS) {
    if (pattern.test(message)) {
      return {
        safe: false,
        reason: `Message contains potential unauthorized claim matching: ${pattern.source}`,
      };
    }
  }

  return { safe: true };
}
