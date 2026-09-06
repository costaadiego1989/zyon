import { ServiceUnavailableException } from "@nestjs/common";
import type { EmailOtpSender } from "../domain/ports/email-otp.port.js";
import { postOtpMessage, type OtpHttpDeliveryOptions } from "./otp-http-delivery.js";

export class ResendEmailOtpSender implements EmailOtpSender {
  constructor(
    private readonly config: { apiKey?: string; fromEmail?: string },
    private readonly http: OtpHttpDeliveryOptions = {},
  ) {}

  async send(email: string, code: string): Promise<void> {
    const apiKey = this.config.apiKey?.trim();
    const fromEmail = this.config.fromEmail?.trim();
    if (!apiKey || !fromEmail) throw new ServiceUnavailableException("otp_email_unavailable");
    await postOtpMessage("email", "https://api.resend.com/emails", {
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: fromEmail,
        to: email,
        subject: "Seu código de verificação",
        text: `Seu código de verificação é ${code}. Válido por 10 minutos. Se não solicitou, ignore este email.`,
      }),
    }, this.http);
  }
}
