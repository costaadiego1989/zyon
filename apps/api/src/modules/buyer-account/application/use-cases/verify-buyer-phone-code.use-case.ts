import { createHash } from "node:crypto";
import { Inject, Injectable, UnauthorizedException , Logger} from "@nestjs/common";
import { BuyerAccount } from "../../domain/entities/buyer-account.entity.js";
import { BUYER_ACCOUNT_REPOSITORY, type BuyerAccountRepository } from "../../domain/ports/buyer-account-repository.port.js";
import { BuyerJwtService } from "../../domain/services/buyer-jwt.service.js";
import { OTP_STORE, type OtpStore } from "../../domain/ports/otp-store.port.js";
import { toBuyerAuthResponse, type BuyerAuthResponse } from "./register-buyer.use-case.js";
import { CorrelationIdStorage } from "../../../../shared/logger/correlation-id.storage.js";

export interface VerifyBuyerPhoneCodeRequest {
  phone: string;
  code: string;
  countryCode?: string; // C3 fix: optional country code for disambiguating phone numbers
}

@Injectable()
export class VerifyBuyerPhoneCodeUseCase {
  private readonly logger = new Logger(VerifyBuyerPhoneCodeUseCase.name);

  constructor(
    @Inject(BUYER_ACCOUNT_REPOSITORY) private readonly repo: BuyerAccountRepository,
    @Inject(OTP_STORE) private readonly otpStore: OtpStore,
    private readonly jwt: BuyerJwtService
  ) {}

  async execute(input: VerifyBuyerPhoneCodeRequest): Promise<BuyerAuthResponse> {
    const normalized = input.phone.replace(/\D/g, "");
    const countryCode = input.countryCode ?? "BR";
    const phoneKey = `${countryCode}:${normalized}`;

    const record = await this.otpStore.findActive(phoneKey);
    if (!record) {
      throw new UnauthorizedException("otp_expired");
    }
    // expiresAt may arrive as a Date or an ISO string depending on the store
    // implementation (Prisma returns Date, cache/serialized stores return string).
    const expiresAt = record.expiresAt instanceof Date ? record.expiresAt : new Date(record.expiresAt);
    this.logger.warn(`[OTP verify] record found: attempts=${record.attempts}/${record.maxAttempts} expires=${expiresAt.toISOString()}`);

    if (record.attempts >= record.maxAttempts) {
      throw new UnauthorizedException("otp_locked");
    }

    // Compare hash — strip non-digits from input to handle any formatting
    const sanitizedCode = input.code.replace(/\D/g, "").trim();
    const inputHash = createHash("sha256").update(sanitizedCode).digest("hex");
    this.logger.warn(`[OTP verify] code="${sanitizedCode}" len=${sanitizedCode.length} inputHash=${inputHash.slice(0, 12)} storedHash=${record.codeHash.slice(0, 12)} match=${inputHash === record.codeHash}`);
    if (inputHash !== record.codeHash) {
      // Increment attempt counter before throwing so lockout is enforced.
      await this.otpStore.incrementAttempts(phoneKey);
      throw new UnauthorizedException("otp_invalid");
    }

    // Success: mark the OTP consumed so it cannot be reused.
    await this.otpStore.consume(phoneKey);

    let account = await this.repo.findByPhone(normalized);
    // Fallback: phone field may be encrypted (PII). Use the deterministic email pattern.
    if (!account) {
      account = await this.repo.findByEmail(`phone_${normalized}@buyer.aacp`).catch(() => null);
    }
    if (!account) {
      const now = new Date();
      // C2 fix: use null passwordHash for phone-only accounts instead of sentinel
      account = new BuyerAccount({
        globalUserId: `buyer_${crypto.randomUUID().replace(/-/g, "")}`,
        email: `phone_${normalized}@buyer.aacp`,
        passwordHash: null,
        displayName: `+${normalized}`,
        phone: normalized,
        phoneCountryCode: countryCode, // C3 fix: store country code
        createdAt: now,
        updatedAt: now,
      });
      await this.repo.save(account);
    }

    return toBuyerAuthResponse(account, this.jwt);
  }
}
