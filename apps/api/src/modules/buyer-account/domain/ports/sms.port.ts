/**
 * C4 fix: SMS delivery port for OTP codes and buyer notifications.
 * Implementations: TwilioSmsSender (production), ConsoleSmsSender (dev).
 */
export const SMS_PROVIDER = Symbol("SMS_PROVIDER");

export interface SmsSender {
  send(phone: string, message: string): Promise<void>;
}
