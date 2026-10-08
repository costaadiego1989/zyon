/** Signed, server-issued identity of one existing marketplace charge in its original environment. */
export interface MarketplacePaymentResumeBinding {
  version: 1;
  sessionId: string;
  intentId: string;
  providerPaymentId: string;
  provider: "stripe" | "asaas";
  environment: "test" | "live";
  accountFingerprint: string;
  fundingInstructionsHash: string;
  checkoutFingerprint: string;
  method: "card" | "pix" | "boleto";
  amountCents: number;
  currency: "BRL";
}

export type MarketplacePaymentActionKind = "stripe_card_entry" | "stripe_card_3ds" | "asaas_pix" | "asaas_boleto";
export type MarketplacePaymentActionReason = "observation_only" | "payment_processing" | "payment_terminal" |
  "payment_retry_not_authorized" | "payment_action_unavailable";
export type MarketplacePaymentProviderStatus = "requires_payment_method" | "requires_action" | "processing" |
  "succeeded" | "canceled" | "requires_confirmation" | "requires_capture" | "unknown";

const keys = ["version", "sessionId", "intentId", "providerPaymentId", "provider", "environment", "accountFingerprint",
  "fundingInstructionsHash", "checkoutFingerprint", "method", "amountCents", "currency"];
const identifier = (value: unknown): value is string => typeof value === "string" &&
  value.length > 0 && value.length <= 200 && /^[A-Za-z0-9_-]+$/.test(value);

export function isMarketplacePaymentResumeBinding(value: unknown): value is MarketplacePaymentResumeBinding {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const input = value as Record<string, unknown>;
  return Object.keys(input).length === keys.length && keys.every(key => Object.hasOwn(input, key)) &&
    input.version === 1 && identifier(input.sessionId) && identifier(input.intentId) && identifier(input.providerPaymentId) &&
    (input.provider === "stripe" && input.providerPaymentId.startsWith("pi_") && input.method === "card" ||
      input.provider === "asaas" && input.providerPaymentId.startsWith("pay_") &&
        (input.method === "pix" || input.method === "boleto" && input.environment === "test")) &&
    (input.environment === "test" || input.environment === "live") &&
    typeof input.accountFingerprint === "string" && /^[a-f0-9]{64}$/.test(input.accountFingerprint) &&
    typeof input.fundingInstructionsHash === "string" && /^[a-f0-9]{64}$/.test(input.fundingInstructionsHash) &&
    typeof input.checkoutFingerprint === "string" && /^[a-f0-9]{64}$/.test(input.checkoutFingerprint) &&
    Number.isSafeInteger(input.amountCents) && (input.amountCents as number) > 0 && input.currency === "BRL";
}
