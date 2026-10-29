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

export function validateStorefrontMessage(
  message: string,
  context: StorefrontMessageContext = {}
): ValidateMessageResult {
  const validatorOptions: SafetyValidatorOptions = {
    authorizedPercent: context.authorizedDiscountPercent ?? 0,
    freeShippingAuthorized: context.freeShippingAuthorized ?? false,
    shippingDiscountAuthorized: context.shippingDiscountAuthorized ?? false
  };

  const result: ValidationResult = validateAssistantMessage(message, {
    ...validatorOptions,
    maxLength: context.maxLength ?? 2000
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
