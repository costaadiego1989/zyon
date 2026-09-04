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
 * This validator detects if LLM output contains offer-authorization language,
 * which would violate the guarantee that only rules-engine/shipping-engine authorize offers.
 */

export interface MessageSafetyResult {
  safe: boolean;
  reason?: string;
}

/**
 * Regex patterns for unsafe claims that an LLM might generate.
 * These would mislead the buyer into thinking an offer has been authorized
 * when it hasn't been approved by the rules-engine.
 */
const UNAUTHORIZED_OFFER_PATTERNS = [
  // Portuguese - discount claims
  /(?:estou|vou|posso)\s+(?:te\s+)?(?:dar|oferecer|conceder|aplicar)\s+\d+%/i,
  /(?:ganhou|garantido|aprovado)\s+(?:um\s+)?(?:desconto|cupom)/i,
  /(?:seu\s+)?desconto\s+(?:de\s+)?\d+%\s+(?:foi\s+)?(?:aprovado|garantido|confirmado)/i,
  // Portuguese - free shipping claims
  /(?:frete\s+gr[aá]tis|envio\s+gr[aá]tis)\s+(?:garantido|aprovado|confirmado)/i,
  /(?:estou|vou)\s+(?:te\s+)?(?:dar|oferecer|conceder)\s+frete\s+gr[aá]tis/i,
  // Portuguese - delivery guarantee claims
  /(?:garanto|garantimos)\s+(?:que\s+)?(?:chega|entrega)/i,
  // Portuguese - stock guarantee claims
  /(?:garanto|garantimos)\s+(?:que\s+)?(?:tem|h[aá])\s+(?:em\s+)?estoque/i,
  // Portuguese - payment confirmation claims
  /(?:pagamento|pix|boleto)\s+(?:j[aá]\s+)?(?:foi\s+)?(?:confirmado|aprovado|processado)/i,
  // Sensitive data requests (CVV, password)
  /(?:informe|digite|envie|preciso)\s+(?:o\s+)?(?:seu\s+)?(?:cvv|c[oó]digo\s+de\s+seguran[cç]a|senha|password)/i,
  // English equivalents (for safety)
  /(?:I'm giving|I'll give|here's your)\s+\d+%\s+(?:off|discount)/i,
  /(?:free shipping|delivery)\s+(?:guaranteed|confirmed|approved)/i
];

/**
 * Validates that a generated (LLM) message does NOT contain unauthorized authorization claims.
 * Returns { safe: true } if the message is safe to show the buyer.
 * Returns { safe: false, reason } if the message contains unsafe claims.
 *
 * USAGE:
 * ```typescript
 * const result = isSafeGeneratedMessage(reply.message);
 * if (!result.safe) {
 *   // Fall back to deterministic safe template
 *   message = getFallbackMessage(stage, missingFields);
 * }
 * ```
 */
export function isSafeGeneratedMessage(message: string): MessageSafetyResult {
  if (!message || message.trim().length === 0) {
    return { safe: true };
  }

  for (const pattern of UNAUTHORIZED_OFFER_PATTERNS) {
    if (pattern.test(message)) {
      return {
        safe: false,
        reason: `Message contains potential unauthorized claim matching: ${pattern.source}`
      };
    }
  }

  return { safe: true };
}
