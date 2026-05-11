import { Inject, Injectable, UnauthorizedException } from "@nestjs/common";
import { BuyerAccount } from "../../domain/entities/buyer-account.entity.js";
import { BUYER_ACCOUNT_REPOSITORY, type BuyerAccountRepository } from "../../domain/ports/buyer-account-repository.port.js";
import { BuyerJwtService } from "../../domain/services/buyer-jwt.service.js";
import { otpStore } from "./send-buyer-phone-code.use-case.js";
import { toBuyerAuthResponse, type BuyerAuthResponse } from "./register-buyer.use-case.js";

export interface VerifyBuyerPhoneCodeRequest {
  phone: string;
  code: string;
}

@Injectable()
export class VerifyBuyerPhoneCodeUseCase {
  constructor(
    @Inject(BUYER_ACCOUNT_REPOSITORY) private readonly repo: BuyerAccountRepository,
    private readonly jwt: BuyerJwtService
  ) {}

  async execute(input: VerifyBuyerPhoneCodeRequest): Promise<BuyerAuthResponse> {
    const normalized = input.phone.replace(/\D/g, "");
    const entry = otpStore.get(normalized);

    if (!entry || entry.expiresAt < Date.now()) throw new UnauthorizedException("otp_expired");
    if (entry.code !== input.code.trim()) throw new UnauthorizedException("otp_invalid");

    otpStore.delete(normalized);

    let account = await this.repo.findByPhone(normalized);
    if (!account) {
      const now = new Date();
      account = new BuyerAccount({
        globalUserId: `buyer_${crypto.randomUUID().replace(/-/g, "")}`,
        email: `phone_${normalized}@buyer.aacp`,
        passwordHash: crypto.randomUUID(),
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
