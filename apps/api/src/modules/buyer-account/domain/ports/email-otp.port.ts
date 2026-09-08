export const EMAIL_OTP_PROVIDER = Symbol("EMAIL_OTP_PROVIDER");

export interface EmailOtpContext {
  /** Merchant identity resolved by the application, never copied from a request name. */
  merchantName?: string;
}

export interface EmailOtpSender {
  /** Resolves only after the configured delivery provider accepts the message. */
  send(email: string, code: string, context?: EmailOtpContext): Promise<void>;
}
