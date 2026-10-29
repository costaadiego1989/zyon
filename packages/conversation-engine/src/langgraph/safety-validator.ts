/**
 * Safety validator — runs on EVERY assistant message before it reaches the
 * buyer. Implements CLAUDE.md critical invariants:
 *
 *   - LLM NEVER authorizes discounts — only proposes.
 *   - isSafeGeneratedMessage() validates every LLM output.
 *   - Unsafe messages fall back to deterministic templates.
 *   - Never claim unauthorized discounts, free shipping, delivery guarantees,
 *     stock guarantees, payment confirmation, or request CVV/password.
 */

export interface SafetyValidatorOptions {
  /** Max percent discount the rules-engine has authorized (0 if none). */
  authorizedPercent?: number;
  /** Whether free shipping was authorized by the rules-engine. */
  freeShippingAuthorized?: boolean;
  /** Whether a shipping discount was authorized. */
  shippingDiscountAuthorized?: boolean;
}

export interface ValidationResult {
  safe: boolean;
  reason?: string;
}

export interface ValidateOptions extends SafetyValidatorOptions {
  /** Max characters allowed. Defaults to 2000. */
  maxLength?: number;
}

const DEFAULT_MAX_LENGTH = 2000;

function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

const FORBIDDEN_CLAIMS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /entrega (garantida|amanha|hoje)|garanto a entrega|prazo garantido/, reason: "delivery_guarantee" },
  { pattern: /estoque garantido|temos em estoque garantido|produto reservado/, reason: "stock_guarantee" },
  {
    pattern: /pagamento (foi )?(aprovado|confirmado)|pix (foi )?confirmado|cartao (foi )?aprovado/,
    reason: "payment_confirmation"
  },
  { pattern: /desconto (aprovado|liberado|garantido)/, reason: "discount_approval_claim" },
  { pattern: /oferta (aprovada|liberada|garantida)/, reason: "offer_approval_claim" },
  { pattern: /pedido (ja esta|segue|esta) (em andamento|para processamento)/, reason: "order_status_claim" },
  { pattern: /cadastro (esta|ta) completo|encaminhar para finalizacao|cadastro confirmado/, reason: "data_collection_done_claim" },
  { pattern: /senha|c[óo]digo de seguran[çc]a|cvv|token do cart[ãa]o/, reason: "sensitive_data_request" }
];

export function isSafeGeneratedMessage(message: string, options: SafetyValidatorOptions = {}): boolean {
  if (!message || typeof message !== "string") return false;
  const normalized = normalize(message);
  if (normalized.trim().length === 0) return false;

  // Discount math — must not exceed authorized percent.
  const authorizedPercent = options.authorizedPercent ?? 0;
  const mentionedPercentages = [...normalized.matchAll(/(\d+(?:[,.]\d+)?)\s*%/g)].map((match) =>
    Number(match[1]?.replace(",", "."))
  );
  if (mentionedPercentages.some((p) => p > authorizedPercent)) return false;

  // Free shipping claim — requires explicit authorization.
  if (/frete gratis|frete gratuito|envio gratis|free shipping/.test(normalized)) {
    if (!options.freeShippingAuthorized) return false;
  }

  // Shipping discount claim — requires explicit authorization.
  if (/desconto no frete|reducao no frete|abatimento no frete/.test(normalized)) {
    if (!options.shippingDiscountAuthorized) return false;
  }

  // Forbidden claims — always block.
  for (const { pattern } of FORBIDDEN_CLAIMS) {
    if (pattern.test(normalized)) return false;
  }

  return true;
}

export function validateAssistantMessage(message: string, options: ValidateOptions = {}): ValidationResult {
  if (typeof message !== "string") {
    return { safe: false, reason: "invalid_type" };
  }
  if (message.trim().length === 0) {
    return { safe: false, reason: "empty" };
  }
  const maxLength = options.maxLength ?? DEFAULT_MAX_LENGTH;
  if (message.length > maxLength) {
    return { safe: false, reason: "too_long" };
  }
  if (!isSafeGeneratedMessage(message, options)) {
    return { safe: false, reason: "unsafe_content" };
  }
  return { safe: true };
}