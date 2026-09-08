import { BadRequestException, Inject, Injectable, Optional, UnauthorizedException } from "@nestjs/common";
import { createHash } from "node:crypto";
import { OTP_STORE, type OtpStore } from "../../domain/ports/otp-store.port.js";
import { EmailVerificationReceiptService } from "../../domain/services/email-verification-receipt.service.js";

export interface VerifyBuyerEmailCodeRequest {
  email: string;
  code: string;
}

@Injectable()
export class VerifyBuyerEmailCodeUseCase {
  constructor(
    @Inject(OTP_STORE) private readonly otpStore: OtpStore,
    @Optional() private readonly receipts?: EmailVerificationReceiptService,
  ) {}

  async execute(input: VerifyBuyerEmailCodeRequest): Promise<{ verified: boolean; verificationToken?: string }> {
    const email = input.email?.trim().toLowerCase();
    if (!email || !input.code) {
      throw new BadRequestException("email_and_code_required");
    }

    const key = `email:${email}`;
    const stored = await this.otpStore.findActive(key);

    if (!stored) {
      throw new UnauthorizedException("otp_not_found_or_expired");
    }

    if (new Date() > stored.expiresAt) {
      throw new UnauthorizedException("otp_expired");
    }
    if (stored.attempts >= stored.maxAttempts) throw new UnauthorizedException("otp_locked");

    const codeHash = createHash("sha256").update(input.code.trim()).digest("hex");
    if (codeHash !== stored.codeHash) {
      await this.otpStore.incrementAttempts(key);
      throw new UnauthorizedException("otp_invalid");
    }

    // Mark as consumed
    await this.otpStore.consume(key);

    return {
      verified: true,
      ...(this.receipts ? { verificationToken: this.receipts.issue(email) } : {}),
    };
  }
}
