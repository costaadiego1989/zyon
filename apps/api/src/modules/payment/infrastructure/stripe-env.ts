export function isStripeConfigured(): boolean {
  return Boolean(readStripeConnection().secretKey);
}

export function readStripeConnection(): {
  secretKey: string | undefined;
  publishableKey: string | undefined;
  webhookSecret: string | undefined;
} {
  return {
    secretKey: process.env.STRIPE_SECRET_KEY?.trim() || undefined,
    publishableKey: process.env.STRIPE_PUBLISHABLE_KEY?.trim() || undefined,
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET?.trim() || undefined
  };
}
