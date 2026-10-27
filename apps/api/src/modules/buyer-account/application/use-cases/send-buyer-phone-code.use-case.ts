import { BadRequestException, Inject, Injectable, Optional, ServiceUnavailableException } from "@nestjs/common";
import { createHash, randomInt } from "node:crypto";
import { OTP_STORE, type OtpStore } from "../../domain/ports/otp-store.port.js";
import { SMS_PROVIDER, type SmsSender } from "../../domain/ports/sms.port.js";

export interface SendBuyerPhoneCodeRequest {
  phone: string;
  countryCode?: string;
  merchantName?: string;
  buyerName?: string;
  fallbackEmail?: string;
}

const OTP_TTL_MS = 5 * 60 * 1000;

function buildOtpMessage(code: string, merchantName?: string, buyerName?: string): string {
  const greeting = buyerName ? `Olá, ${buyerName.split(" ")[0]}! ` : "";
  const store = merchantName ? ` à ${merchantName}` : "";
  return `${greeting}Seu código de acesso${store} é ${code}. Válido por 5 minutos. Não compartilhe com ninguém.`;
}

@Injectable()
export class SendBuyerPhoneCodeUseCase {
  constructor(
    @Inject(OTP_STORE) private readonly otpStore: OtpStore,
    @Optional() @Inject(SMS_PROVIDER) private readonly sms?: SmsSender,
  ) {}

  async execute(input: SendBuyerPhoneCodeRequest): Promise<{ sent: true; delivered_to: string }> {
    if (typeof input.phone !== "string") throw new BadRequestException("phone_invalid_length");
    const normalized = input.phone.replace(/\D/g, "");
    const countryCode = input.countryCode ?? "BR";
    if (normalized.length < 8 || normalized.length > 15) throw new BadRequestException("phone_invalid_length");
    if (!this.sms) throw new ServiceUnavailableException("otp_sms_unavailable");

    const code = String(randomInt(100000, 1000000));
    try {
      await this.sms.send(normalized, buildOtpMessage(code, input.merchantName, input.buyerName));
    } catch (error) {
      const unavailable = error instanceof ServiceUnavailableException && error.message === "otp_sms_unavailable";
      throw new ServiceUnavailableException(unavailable ? "otp_sms_unavailable" : "otp_sms_delivery_failed");
    }

    // A challenge becomes active only after the provider accepts delivery.
    await this.otpStore.save({
      phone: `${countryCode}:${normalized}`,
      codeHash: createHash("sha256").update(code).digest("hex"),
      maxAttempts: 5,
      expiresAt: new Date(Date.now() + OTP_TTL_MS),
    });
    return { sent: true, delivered_to: `***${normalized.slice(-4)}` };
  }
}
