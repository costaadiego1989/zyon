import { BadRequestException, Inject, Injectable, NotFoundException, Optional, ServiceUnavailableException } from "@nestjs/common";
import { createHash, randomInt } from "node:crypto";
import { OTP_STORE, type OtpStore } from "../../domain/ports/otp-store.port.js";
import { EMAIL_OTP_PROVIDER, type EmailOtpSender } from "../../domain/ports/email-otp.port.js";
import { MERCHANT_REPOSITORY, type MerchantRepository } from "../../../merchant/domain/ports/merchant-repository.port.js";

export interface SendBuyerEmailCodeRequest {
  email: string;
  merchantId?: string;
}

const OTP_TTL_MS = 10 * 60 * 1000;

@Injectable()
export class SendBuyerEmailCodeUseCase {
  constructor(
    @Inject(OTP_STORE) private readonly otpStore: OtpStore,
    @Optional() @Inject(EMAIL_OTP_PROVIDER) private readonly sender?: EmailOtpSender,
    @Optional() @Inject(MERCHANT_REPOSITORY) private readonly merchants?: MerchantRepository,
  ) {}

  async execute(input: SendBuyerEmailCodeRequest): Promise<{ sent: true; delivered_to: string }> {
    const email = typeof input.email === "string" ? input.email.trim().toLowerCase() : "";
    if (!email || !email.includes("@")) throw new BadRequestException("email_invalid");
    let merchantName: string | undefined;
    if (input.merchantId !== undefined) {
      if (typeof input.merchantId !== "string" || !/^[A-Za-z0-9_-]{1,191}$/.test(input.merchantId.trim())) {
        throw new BadRequestException("otp_merchant_id_invalid");
      }
      if (!this.merchants) throw new ServiceUnavailableException("otp_merchant_context_unavailable");
      const merchant = await this.merchants.getProfile(input.merchantId.trim());
      if (!merchant) throw new NotFoundException("otp_merchant_not_found");
      merchantName = merchant.name;
    }
    if (!this.sender) throw new ServiceUnavailableException("otp_email_unavailable");

    const code = String(randomInt(100000, 1000000));
    try {
      await this.sender.send(email, code, merchantName ? { merchantName } : undefined);
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
