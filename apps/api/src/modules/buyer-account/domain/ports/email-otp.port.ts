import type { MerchantEmailBranding } from "../../../../shared/email/merchant-email-branding.js";

export const EMAIL_OTP_PROVIDER = Symbol("EMAIL_OTP_PROVIDER");

export interface EmailOtpContext {
  /** Merchant identity resolved by the application, never copied from a request name. */
  merchantName?: string;
  /** Trusted visual identity used only when this OTP belongs to a merchant storefront. */
  merchantBranding?: MerchantEmailBranding;
}

export interface EmailOtpSender {
  /** Resolves only after the configured delivery provider accepts the message. */
  send(email: string, code: string, context?: EmailOtpContext): Promise<void>;
}
