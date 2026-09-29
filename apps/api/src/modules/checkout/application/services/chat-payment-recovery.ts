export function chatPaymentRecoveryEnabled(merchantId: string): boolean {
  return process.env.CHECKOUT_CHAT_PAYMENT_RECOVERY_ENABLED === "true"
    && (process.env.CHECKOUT_CHAT_RECOVERY_MERCHANT_IDS ?? "").split(",")
      .map(id => id.trim()).filter(id => id && id !== "*").includes(merchantId);
}
