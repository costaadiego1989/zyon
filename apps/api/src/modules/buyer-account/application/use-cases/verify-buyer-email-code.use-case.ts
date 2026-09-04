import { BadRequestException, Inject, Injectable, Logger, UnauthorizedException } from "@nestjs/common";
import { createHash } from "node:crypto";
import { OTP_STORE, type OtpStore } from "../../domain/ports/otp-store.port.js";

export interface VerifyBuyerEmailCodeRequest {
  email: string;
  code: string;
}

@Injectable()
export class VerifyBuyerEmailCodeUseCase {
  private readonly logger = new Logger(VerifyBuyerEmailCodeUseCase.name);

  constructor(
    @Inject(OTP_STORE) private readonly otpStore: OtpStore,
  ) {}

  async execute(input: VerifyBuyerEmailCodeRequest): Promise<{ verified: boolean }> {
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

    const codeHash = createHash("sha256").update(input.code.trim()).digest("hex");
    if (codeHash !== stored.codeHash) {
      await this.otpStore.incrementAttempts(key);
      throw new UnauthorizedException("otp_invalid");
    }

    // Mark as consumed
    await this.otpStore.consume(key);

    this.logger.log(`Email verified: ${email}`);
    return { verified: true };
  }
}
