import { readPlatformFeeBrl, readPlatformFeeCents } from "../../../shared/config/platform-fee.config.js";

const isProd = process.env.NODE_ENV === "production";

// Buyer service fee (taxa de serviço do comprador), em R$. Modelo iFood: fixo,
// somado ao total do pedido em todos os planos e métodos. Default R$0,99;
// PLATFORM_FEE_BRL é override de emergência.

export function isStripeConfigured(): boolean {
  return Boolean(readStripeConnection().secretKey);
}

/**
 * Taxa de serviço do buyer em centavos. Fonte: env PLATFORM_FEE_BRL (override),
 * senão o default R$0,99. Cobrada do comprador (somada ao amount), todos os
 * métodos de pagamento.
 */
export function readBuyerServiceFeeCents(env: NodeJS.ProcessEnv = process.env): number {
  return readPlatformFeeCents(env);
}

export function readBuyerServiceFeeMajorUnits(env: NodeJS.ProcessEnv = process.env): number {
  return readPlatformFeeBrl(env);
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
