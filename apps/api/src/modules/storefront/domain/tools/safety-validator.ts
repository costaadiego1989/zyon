import {
  isSafeGeneratedMessageV2,
  validateAssistantMessage,
  type SafetyValidatorOptions,
  type ValidationResult
} from "@zyon/conversation-engine";

export interface StorefrontMessageContext {
  toolResults?: Record<string, unknown>;
  authorizedDiscountPercent?: number;
  freeShippingAuthorized?: boolean;
  shippingDiscountAuthorized?: boolean;
  /** Canonical merchant restriction, never an authorization to grant either benefit. */
  allowStackDiscountAndFreeShipping?: boolean;
  maxLength?: number;
}

export interface ValidateMessageResult {
  safe: boolean;
  message: string; // original if safe, fallback template if unsafe
  reason?: string; // why unsafe (if not safe)
}

const FALLBACK_MESSAGES_PT = [
  "Desculpe, não consegui processar sua mensagem. Como posso ajudá-lo?",
  "Deixa eu tentar novamente. O que você gostaria de fazer?",
  "Poderia reformular sua pergunta? Estou aqui para ajudar.",
  "Tive um problema ao processar isso. Posso buscar um produto para você?"
];

function getRandomFallback(): string {
  return FALLBACK_MESSAGES_PT[Math.floor(Math.random() * FALLBACK_MESSAGES_PT.length)];
}

const freeShippingWords = "(?:frete gratis|frete gratuito|envio gratis|free shipping)";
const offerWords = "(?:(?:a|essa|esta) )?(?:oferta|promocao|desconto)";
const directStackingDenial = new RegExp(`^(?:(?:a loja|a regra atual da loja) )?nao (?:permite|e permitido|e possivel|podemos|pode|posso) (?:acumular|combinar) (?:${offerWords} com (?:o )?${freeShippingWords}|(?:o )?${freeShippingWords} com ${offerWords})$`);
const benefitStackingDenial = new RegExp(`^(?:(?:o )?${freeShippingWords} nao pode ser (?:usado|acumulado|combinado) com ${offerWords}|${offerWords} nao pode ser (?:usad[ao]|acumulad[ao]|combinad[ao]) com (?:o )?${freeShippingWords})$`);
const jointStackingDenial = new RegExp(`^(?:a regra atual da loja nao permite combinar esses beneficios, entao )?(?:a|essa|esta) oferta(?: d[oa] ([\\p{L}\\p{N} —-]{1,160}))? e (?:o )?${freeShippingWords} nao podem ser usados juntos$`, "u");

function normalized(value: string): string {
  return value.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
}

/** A false policy can substantiate a refusal to combine, but grants nothing.
 * Match only complete declarative clauses. Questions, quotes, hypothetical or
 * double-negative prose remain subject to the unchanged generic validator.
 * Only the benefit words inside a matched denial are masked for validation;
 * all other claims, percentages and sensitive data are still checked.
 */
function policySupportedStackingDenials(message: string, context: StorefrontMessageContext): string {
  if (context.allowStackDiscountAndFreeShipping !== false) return message;
  const framing = normalized(message);
  if (/["'“”‘’«»`]/u.test(framing)
    || /(?:^|[.!?\n]\s*)(?:hipotese|hipoteticamente|suponha|digamos|imagine|caso|se)\b/u.test(framing)
    || /\b(?:nao e verdade|isso e falso|ao contrario)\b/u.test(framing)) return message;
  return message.replace(/[^.!?\r\n]+[.!?]?/g, clause => {
    const plain = normalized(clause).replace(/[*_~]/g, "").trim().replace(/^🤖\s*/, "").replace(/[.!]$/, "").trim();
    if (/["'“”‘’«»`:;?()[\]{}]/u.test(plain)) return clause;
    const joint = plain.match(jointStackingDenial);
    const productName = joint?.[1];
    if (productName && /\b(?:nao|sem|nem|nunca|se|caso|que|verdade|proibido|permitido|talvez)\b/u.test(productName)) return clause;
    if (!directStackingDenial.test(plain) && !benefitStackingDenial.test(plain) && !joint) return clause;
    return clause.replace(/frete gr[áa]tis|frete gratuito|envio gr[áa]tis|free shipping/gi, "esses benefícios");
  });
}

export function validateStorefrontMessage(
  message: string,
  context: StorefrontMessageContext = {}
): ValidateMessageResult {
  const validatorOptions: SafetyValidatorOptions = {
    authorizedPercent: context.authorizedDiscountPercent ?? 0,
    freeShippingAuthorized: context.freeShippingAuthorized ?? false,
    shippingDiscountAuthorized: context.shippingDiscountAuthorized ?? false
  };

  // These are affirmative zero-cost promises despite containing "não".
  // A denial exception must never turn them into authorized shipping.
  if (!validatorOptions.freeShippingAuthorized && /\bnao (?:(?:precisa|precisara|precisam|precisarao) pagar (?:o )?frete|ha (?:taxa|cobranca|custo) (?:de|do) frete)\b/.test(normalized(message).replace(/[*_~]/g, ""))) {
    return { safe: false, message: getRandomFallback(), reason: "unauthorized_shipping_claim" };
  }

  const maximum = context.maxLength ?? 2000;
  const validationMessage = message.length <= maximum ? policySupportedStackingDenials(message, context) : message;

  const result: ValidationResult = validateAssistantMessage(validationMessage, {
    ...validatorOptions,
    maxLength: maximum
  } as any);

  if (result.safe) {
    return {
      safe: true,
      message,
      reason: undefined
    };
  }

  if (
    context.toolResults &&
    (/prec[oó]|custa|cobro|valor|reais|r\$/.test(message.toLowerCase()) ||
      /(\d+(?:[.,]\d+)?)\s*(?:reais|r\$|cents?|centavos?)/.test(message))
  ) {
    // If message claims a price, it should come from a tool result.}
  }

  if (
    /em estoque|disponivel|disponível|temos em|tenho em|nao.*disponivel|não.*disponível|fora de estoque|esgotado/.test(
      message.toLowerCase()
    )
  ) {
    // If message claims stock status, it should come from a tool result.
    // Flag as unsafe if we cannot verify.
  }

  if (/entrega|chegara|chegará|receber|dias uteis|dias úteis|amanha|amanhã/.test(message.toLowerCase())) {
    const hasShippingContext =
      context.toolResults &&
      (context.toolResults["quote_shipping"] || context.toolResults["shipping_options"]);
    if (!hasShippingContext) {
      return {
        safe: false,
        message: getRandomFallback(),
        reason: "unverified_delivery_claim"
      };
    }
  }

  if (/(?<![a-z0-9])[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/.test(message.toLowerCase())) {
    return {
      safe: false,
      message: getRandomFallback(),
      reason: "pii_leakage_email"
    };
  }

  if (/\(\d{2}\)\s*\d{4,5}-\d{4}|(\d{2})\s*9\s*\d{4}-\d{4}/.test(message)) {
    return {
      safe: false,
      message: getRandomFallback(),
      reason: "pii_leakage_phone"
    };
  }

  return {
    safe: false,
    message: getRandomFallback(),
    reason: result.reason ?? "unknown_safety_violation"
  };
}

export function isStoreMessageSafe(message: string, options: SafetyValidatorOptions = {}): boolean {
  return isSafeGeneratedMessageV2(message, options);
}
