export interface PaymentRoutingSettings {
  pix?: "asaas" | "mercadopago";
  card?: "asaas" | "stripe" | "mercadopago";
  fallbackWhenUnavailable?: boolean;
}

/** Settings for new payments. Retired historical methods stay in their records. */
export function normalizePaymentRouting(value: unknown): PaymentRoutingSettings {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const data = value as Record<string, unknown>;
  return {
    ...(data.pix === "asaas" || data.pix === "mercadopago" ? { pix: data.pix } : {}),
    ...(data.card === "asaas" || data.card === "stripe" || data.card === "mercadopago" ? { card: data.card } : {}),
    ...(typeof data.fallbackWhenUnavailable === "boolean" ? { fallbackWhenUnavailable: data.fallbackWhenUnavailable } : {}),
  };
}
