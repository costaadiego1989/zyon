import { BadRequestException, Inject, Injectable, Optional, ServiceUnavailableException } from "@nestjs/common";
import { createHash, randomInt } from "node:crypto";
import { OTP_STORE, type OtpStore } from "../../domain/ports/otp-store.port.js";
import { SMS_PROVIDER, type SmsSender } from "../../domain/ports/sms.port.js";

export interface SendBuyerPhoneCodeRequest {
  phone: string;
  countryCode?: string;
}

const OTP_TTL_MS = 5 * 60 * 1000;

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
      await this.sms.send(normalized, `Your verification code: ${code}`);
    } catch (error) {
      // A sender exception may include the message or recipient. Expose only stable codes.
      const unavailable = error instanceof ServiceUnavailableException && error.message === "otp_sms_unavailable";
      throw new ServiceUnavailableException(unavailable ? "otp_sms_unavailable" : "otp_sms_delivery_failed");
    }

    // Only accepted delivery activates the new challenge. A failed resend leaves
    // the previous delivered challenge and its attempts/expiry unchanged.
    await this.otpStore.save({
      phone: `${countryCode}:${normalized}`,
      codeHash: createHash("sha256").update(code).digest("hex"),
      maxAttempts: 5,
      expiresAt: new Date(Date.now() + OTP_TTL_MS),
    });
    return { sent: true, delivered_to: `***${normalized.slice(-4)}` };
  }
}
