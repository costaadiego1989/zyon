import { createHash } from "node:crypto";
import { Inject, Injectable, UnauthorizedException } from "@nestjs/common";
import { BuyerAccount } from "../../domain/entities/buyer-account.entity.js";
import { BUYER_ACCOUNT_REPOSITORY, type BuyerAccountRepository } from "../../domain/ports/buyer-account-repository.port.js";
import { BuyerJwtService } from "../../domain/services/buyer-jwt.service.js";
import { OTP_STORE, type OtpStore } from "../../domain/ports/otp-store.port.js";
import { toBuyerAuthResponse, type BuyerAuthResponse } from "./register-buyer.use-case.js";

export interface VerifyBuyerPhoneCodeRequest {
  phone: string;
  code: string;
}

@Injectable()
export class VerifyBuyerPhoneCodeUseCase {
  constructor(
    @Inject(BUYER_ACCOUNT_REPOSITORY) private readonly repo: BuyerAccountRepository,
    @Inject(OTP_STORE) private readonly otpStore: OtpStore,
    private readonly jwt: BuyerJwtService
  ) {}

  async execute(input: VerifyBuyerPhoneCodeRequest): Promise<BuyerAuthResponse> {
    const normalized = input.phone.replace(/\D/g, "");

    // B3 (P1): Fetch from persistent store (not in-process Map).
    const record = await this.otpStore.findActive(normalized);
    if (!record) throw new UnauthorizedException("otp_expired");

    // B2 (P0): Enforce per-OTP attempt lockout before checking the code.
    // This closes the brute-force window: 10^6 codes × 5-minute window without
    // throttling allows ~333k attempts/second on a trivial network.
    if (record.attempts >= record.maxAttempts) {
      throw new UnauthorizedException("otp_locked");
    }

    // B4 (P2): Compare the hash, not the plaintext code.
    const inputHash = createHash("sha256").update(input.code.trim()).digest("hex");
    if (inputHash !== record.codeHash) {
      // Increment attempt counter before throwing so lockout is enforced.
      await this.otpStore.incrementAttempts(normalized);
      throw new UnauthorizedException("otp_invalid");
    }

    // Success: mark the OTP consumed so it cannot be reused.
    await this.otpStore.consume(normalized);

    let account = await this.repo.findByPhone(normalized);
    if (!account) {
      const now = new Date();
      // B6 (P3): Phone-only accounts use a sentinel passwordHash instead of a
      // raw UUID so code inspections make the intent unambiguous. The hash is
      // never compared during login (phone path uses OTP, not password).
      account = new BuyerAccount({
        globalUserId: `buyer_${crypto.randomUUID().replace(/-/g, "")}`,
        email: `phone_${normalized}@buyer.aacp`,
        passwordHash: "phone_only_no_password",
        displayName: `+${normalized}`,
        phone: normalized,
        createdAt: now,
        updatedAt: now,
      });
      await this.repo.save(account);
    }

    return toBuyerAuthResponse(account, this.jwt);
  }
}
