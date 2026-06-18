import { Inject, Injectable } from "@nestjs/common";
import { createHash, randomInt } from "node:crypto";
import { OTP_STORE, type OtpStore } from "../../domain/ports/otp-store.port.js";

export interface SendBuyerPhoneCodeRequest {
  phone: string;
}

const OTP_TTL_MS = 5 * 60 * 1000; // 5 minutes

@Injectable()
export class SendBuyerPhoneCodeUseCase {
  constructor(
    @Inject(OTP_STORE) private readonly otpStore: OtpStore
  ) {}

  async execute(input: SendBuyerPhoneCodeRequest): Promise<{ sent: boolean }> {
    const normalized = input.phone.replace(/\D/g, "");

    // B4 (P2): Use crypto.randomInt instead of Math.random for a
    // cryptographically secure OTP. Math.random is not CSPRNG.
    const code = String(randomInt(100000, 1000000));

    // B5 (P2): Never log the code in plaintext. Log only a redacted indicator.
    // The real delivery goes to the SMS/WhatsApp provider (not yet wired).
    // console.log redaction: log the phone (already in the DB) but NOT the code.
    console.log(`[OTP] send requested for phone=***${normalized.slice(-4)}`);

    // B3 (P1): Persist the OTP via the injected store instead of a module-level
    // Map. In production this writes to Prisma (BuyerPhoneOtp table) so codes
    // are visible to every instance and survive restarts.
    const codeHash = createHash("sha256").update(code).digest("hex");
    const expiresAt = new Date(Date.now() + OTP_TTL_MS);

    await this.otpStore.save({ phone: normalized, codeHash, maxAttempts: 5, expiresAt });

    // TODO: integrate WhatsApp/SMS provider (e.g., Twilio, Z-API, Evolution API)

    return { sent: true };
  }
}
