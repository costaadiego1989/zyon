const isProd = process.env.NODE_ENV === "production";

// Buyer service fee (taxa de serviço do comprador), em R$. Modelo iFood: fixo,
// somado ao total do pedido em todos os planos e métodos. Default R$0,99;
// PLATFORM_FEE_BRL é override de emergência.
const DEFAULT_BUYER_SERVICE_FEE_BRL = 0.99;

export function isStripeConfigured(): boolean {
  return Boolean(readStripeConnection().secretKey);
}

/**
 * Taxa de serviço do buyer em centavos. Fonte: env PLATFORM_FEE_BRL (override),
 * senão o default R$0,99. Cobrada do comprador (somada ao amount), todos os
 * métodos de pagamento.
 */
export function readBuyerServiceFeeCents(): number {
  const raw = process.env.PLATFORM_FEE_BRL?.trim() || String(DEFAULT_BUYER_SERVICE_FEE_BRL);
  const major = Number(raw.replace(",", "."));
  if (!Number.isFinite(major) || major < 0) return Math.round(DEFAULT_BUYER_SERVICE_FEE_BRL * 100);
  return Math.round(major * 100);
}

export function readBuyerServiceFeeMajorUnits(): number {
  return readBuyerServiceFeeCents() / 100;
}

export function readStripeConnection(): {
  secretKey: string | undefined;
  publishableKey: string | undefined;
  webhookSecret: string | undefined;
} {
  if (isProd) {
    return {
      secretKey: process.env.STRIPE_SECRET_KEY?.trim() || undefined,
      publishableKey: process.env.STRIPE_PUBLISHABLE_KEY?.trim() || undefined,
      webhookSecret: process.env.STRIPE_WEBHOOK_SECRET?.trim() || undefined,
    };
  }

  // dev / test: prefer *_TEST keys; fall back to live only when explicitly set
  const testSecret = process.env.STRIPE_SECRET_KEY_TEST?.trim();
  const testPublishable = process.env.STRIPE_PUBLISHABLE_KEY_TEST?.trim();
  const testWebhook = process.env.STRIPE_WEBHOOK_SECRET_TEST?.trim();

  // Guard: refuse live keys in non-production to avoid accidental real charges
  const liveSecret = process.env.STRIPE_SECRET_KEY?.trim();
  const livePublishable = process.env.STRIPE_PUBLISHABLE_KEY?.trim();
  const liveWebhook = process.env.STRIPE_WEBHOOK_SECRET?.trim();

  return {
    secretKey: testSecret || (liveSecret?.startsWith("sk_test_") ? liveSecret : undefined),
    publishableKey: testPublishable || (livePublishable?.startsWith("pk_test_") ? livePublishable : undefined),
    webhookSecret: testWebhook || (liveWebhook?.startsWith("whsec_") ? liveWebhook : undefined),
  };
}
