import { BadRequestException, Inject, Injectable, Optional, ServiceUnavailableException } from "@nestjs/common";
import { createHash, randomInt } from "node:crypto";
import { OTP_STORE, type OtpStore } from "../../domain/ports/otp-store.port.js";
import { EMAIL_OTP_PROVIDER, type EmailOtpSender } from "../../domain/ports/email-otp.port.js";

export interface SendBuyerEmailCodeRequest {
  email: string;
}

const OTP_TTL_MS = 10 * 60 * 1000;

@Injectable()
export class SendBuyerEmailCodeUseCase {
  constructor(
    @Inject(OTP_STORE) private readonly otpStore: OtpStore,
    @Optional() @Inject(EMAIL_OTP_PROVIDER) private readonly sender?: EmailOtpSender,
  ) {}

  async execute(input: SendBuyerEmailCodeRequest): Promise<{ sent: true; delivered_to: string }> {
    const email = typeof input.email === "string" ? input.email.trim().toLowerCase() : "";
    if (!email || !email.includes("@")) throw new BadRequestException("email_invalid");
    if (!this.sender) throw new ServiceUnavailableException("otp_email_unavailable");

    const code = String(randomInt(100000, 1000000));
    try {
      await this.sender.send(email, code);
    } catch (error) {
      const unavailable = error instanceof ServiceUnavailableException && error.message === "otp_email_unavailable";
      throw new ServiceUnavailableException(unavailable ? "otp_email_unavailable" : "otp_email_delivery_failed");
    }
    await this.otpStore.save({
      phone: `email:${email}`,
      codeHash: createHash("sha256").update(code).digest("hex"),
      maxAttempts: 5,
      expiresAt: new Date(Date.now() + OTP_TTL_MS),
    });
    return { sent: true, delivered_to: email.replace(/(.{2}).*(@.*)/, "$1***$2") };
  }
}
