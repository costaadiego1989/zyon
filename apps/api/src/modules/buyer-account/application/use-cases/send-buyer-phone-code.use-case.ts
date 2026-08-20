import { BadRequestException, Inject, Injectable, Logger, Optional } from "@nestjs/common";
import { createHash, randomInt } from "node:crypto";
import { OTP_STORE, type OtpStore } from "../../domain/ports/otp-store.port.js";
import { SMS_PROVIDER, type SmsSender } from "../../domain/ports/sms.port.js";

export interface SendBuyerPhoneCodeRequest {
  phone: string;
  countryCode?: string;
}

const OTP_TTL_MS = 5 * 60 * 1000; // 5 minutes

@Injectable()
export class SendBuyerPhoneCodeUseCase {
  private readonly logger = new Logger(SendBuyerPhoneCodeUseCase.name);

  constructor(
    @Inject(OTP_STORE) private readonly otpStore: OtpStore,
    @Optional() @Inject(SMS_PROVIDER) private readonly sms?: SmsSender
  ) {}

  async execute(input: SendBuyerPhoneCodeRequest): Promise<{ sent: boolean; delivered_to: string; dev_code?: string }> {
    const normalized = input.phone.replace(/\D/g, "");
    const countryCode = input.countryCode ?? "BR";

    if (normalized.length < 8 || normalized.length > 15) {
      throw new BadRequestException("phone_invalid_length");
    }

    const phoneKey = `${countryCode}:${normalized}`;

    // If there's already an active (non-expired, non-consumed) OTP, don't regenerate.
    // This prevents React StrictMode double-calls from overwriting the code.
    const existing = await this.otpStore.findActive(phoneKey);
    if (existing) {
      const isDev = process.env.NODE_ENV !== "production";
      this.logger.log(`[OTP] Active OTP exists for ***${normalized.slice(-4)}, skipping regeneration`);
      return {
        sent: true,
        delivered_to: `***${normalized.slice(-4)}`,
        ...(isDev && !this.sms ? { dev_code: "__check_logs__" } : {}),
      };
    }

    const code = String(randomInt(100000, 1000000));
    const codeHash = createHash("sha256").update(code).digest("hex");
    const expiresAt = new Date(Date.now() + OTP_TTL_MS);

    await this.otpStore.save({ phone: phoneKey, codeHash, maxAttempts: 5, expiresAt });

    if (this.sms) {
      await this.sms.send(normalized, `Your verification code: ${code}`);
    } else {
      this.logger.warn(`[OTP] SMS provider not configured; code=${code} for phone=***${normalized.slice(-4)}`);
    }

    const isDev = process.env.NODE_ENV !== "production";
    return {
      sent: true,
      delivered_to: `***${normalized.slice(-4)}`,
      ...(isDev && !this.sms ? { dev_code: code } : {}),
    };
  }
}
