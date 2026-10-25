/**
 * C4 fix: SMS delivery port for OTP codes and buyer notifications.
 * The configured provider must accept the message before send resolves.
 * Missing configuration and provider rejection must throw; logging is not delivery.
 */
export const SMS_PROVIDER = Symbol("SMS_PROVIDER");

export interface SmsSender {
  send(phone: string, message: string): Promise<void>;
}
