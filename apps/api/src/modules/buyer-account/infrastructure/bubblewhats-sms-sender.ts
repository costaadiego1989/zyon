import { ServiceUnavailableException } from "@nestjs/common";
import type { SmsSender } from "../domain/ports/sms.port.js";
import { postOtpMessage, type OtpHttpDeliveryOptions } from "./otp-http-delivery.js";

export class BubbleWhatsSmsSender implements SmsSender {
  constructor(
    private readonly config: { baseUrl?: string; token?: string },
    private readonly http: OtpHttpDeliveryOptions = {},
  ) {}

  async send(phone: string, message: string): Promise<void> {
    const baseUrl = this.config.baseUrl?.trim();
    const token = this.config.token?.trim();
    if (!baseUrl || !token) throw new ServiceUnavailableException("otp_sms_unavailable");
    const digits = phone.replace(/\D/g, "");
    const number = digits.startsWith("55") ? digits : `55${digits}`;
    await postOtpMessage("sms", `${baseUrl.replace(/\/+$/, "")}/send-message`, {
      headers: { Authorization: token, "Content-Type": "application/json" },
      body: JSON.stringify({ jid: `${number}@s.whatsapp.net`, message }),
    }, this.http);
  }
}
