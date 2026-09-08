import { ServiceUnavailableException } from "@nestjs/common";
import type { EmailOtpContext, EmailOtpSender } from "../domain/ports/email-otp.port.js";
import { postOtpMessage, type OtpHttpDeliveryOptions } from "./otp-http-delivery.js";
import { buildEmailOtpFrom, buildEmailOtpMessage } from "./email-otp-template.js";

export class ResendEmailOtpSender implements EmailOtpSender {
  constructor(
    private readonly config: { apiKey?: string; fromEmail?: string },
    private readonly http: OtpHttpDeliveryOptions = {},
  ) {}

  async send(email: string, code: string, context?: EmailOtpContext): Promise<void> {
    const apiKey = this.config.apiKey?.trim();
    const fromEmail = this.config.fromEmail?.trim();
    if (!apiKey || !fromEmail) throw new ServiceUnavailableException("otp_email_unavailable");
    let from: string;
    try { from = buildEmailOtpFrom(fromEmail, context); }
    catch { throw new ServiceUnavailableException("otp_email_unavailable"); }
    await postOtpMessage("email", "https://api.resend.com/emails", {
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from,
        to: email,
        ...buildEmailOtpMessage(code, context),
      }),
    }, this.http);
  }
}
