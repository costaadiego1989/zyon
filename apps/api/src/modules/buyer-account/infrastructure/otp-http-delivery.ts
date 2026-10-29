import { Logger, ServiceUnavailableException } from "@nestjs/common";

export interface OtpHttpDeliveryOptions {
  fetch?: typeof fetch;
  timeoutMs?: number;
}

/** A single bounded request: retries can send multiple authentication codes. */
export async function postOtpMessage(
  channel: "sms" | "email",
  url: string,
  request: RequestInit,
  options: OtpHttpDeliveryOptions = {},
): Promise<void> {
  const logger = new Logger("BuyerOtpDelivery");
  let status: number | undefined;
  try {
    const response = await (options.fetch ?? fetch)(url, {
      ...request,
      method: "POST",
      // Refuse redirects so the message/authorization never reaches a new origin.
      redirect: "error",
      signal: AbortSignal.timeout(options.timeoutMs ?? 10000),
    });
    status = response.status;
    // Never parse or log a response body: providers may echo the OTP and recipient.
    if (!response.ok) throw new Error("provider_rejected");
  } catch {
    logger.warn({ event: "buyer_otp.delivery_failed", channel, ...(status === undefined ? {} : { status }) });
    throw new ServiceUnavailableException(`otp_${channel}_delivery_failed`);
  }
}
