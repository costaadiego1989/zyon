export const EMAIL_OTP_PROVIDER = Symbol("EMAIL_OTP_PROVIDER");

export interface EmailOtpSender {
  /** Resolves only after the configured delivery provider accepts the message. */
  send(email: string, code: string): Promise<void>;
}
