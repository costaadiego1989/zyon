import { BadRequestException, Inject, Injectable, Logger, Optional } from "@nestjs/common";
import { createHash, randomInt } from "node:crypto";
import { OTP_STORE, type OtpStore } from "../../domain/ports/otp-store.port.js";
import { SMS_PROVIDER, type SmsSender } from "../../domain/ports/sms.port.js";

export interface SendBuyerPhoneCodeRequest {
  phone: string;
  countryCode?: string; // C3 fix: country code for unambiguous phone identification
}

const OTP_TTL_MS = 5 * 60 * 1000; // 5 minutes

@Injectable()
export class SendBuyerPhoneCodeUseCase {
  private readonly logger = new Logger(SendBuyerPhoneCodeUseCase.name);

  constructor(
    @Inject(OTP_STORE) private readonly otpStore: OtpStore,
    @Optional() @Inject(SMS_PROVIDER) private readonly sms?: SmsSender // C4 fix: optional SMS provider
  ) {}

  async execute(input: SendBuyerPhoneCodeRequest): Promise<{ sent: boolean; delivered_to: string }> {
    const normalized = input.phone.replace(/\D/g, "");
    const countryCode = input.countryCode ?? "BR"; // C3 fix: default country code

    // L1 fix: validate phone number length before storing
    if (normalized.length < 8 || normalized.length > 15) {
      throw new BadRequestException("phone_invalid_length");
    }

    // C3 fix: store with country code prefix for unambiguous lookup
    const phoneKey = `${countryCode}:${normalized}`;

    // B4 (P2): Use crypto.randomInt instead of Math.random for a
    // cryptographically secure OTP. Math.random is not CSPRNG.
    const code = String(randomInt(100000, 1000000));

    // B3 (P1): Persist the OTP via the injected store instead of a module-level
    // Map. In production this writes to Prisma (BuyerPhoneOtp table) so codes
    // are visible to every instance and survive restarts.
    const codeHash = createHash("sha256").update(code).digest("hex");
    const expiresAt = new Date(Date.now() + OTP_TTL_MS);

    await this.otpStore.save({ phone: phoneKey, codeHash, maxAttempts: 5, expiresAt });

    // C4 fix: send via SMS provider if wired; otherwise log warning (dev mode)
    if (this.sms) {
      await this.sms.send(normalized, `Your verification code: ${code}`);
    } else {
      // B5 (P2): Never log the code in plaintext in production.
      this.logger.warn(`[OTP] SMS provider not configured; code=****** for phone=***${normalized.slice(-4)}`);
    }

    return { sent: true, delivered_to: `***${normalized.slice(-4)}` };
  }
}
