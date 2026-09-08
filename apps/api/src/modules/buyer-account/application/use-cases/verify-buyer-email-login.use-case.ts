import { Inject, Injectable, UnauthorizedException } from "@nestjs/common";
import { BUYER_ACCOUNT_REPOSITORY, type BuyerAccountRepository } from "../../domain/ports/buyer-account-repository.port.js";
import { BuyerJwtService } from "../../domain/services/buyer-jwt.service.js";
import { toBuyerAuthResponse, type BuyerAuthResponse } from "./register-buyer.use-case.js";
import { VerifyBuyerEmailCodeUseCase } from "./verify-buyer-email-code.use-case.js";

export interface VerifyBuyerEmailLoginRequest {
  email: string;
  code: string;
}

/**
 * Authenticates an existing buyer only after consuming a valid email OTP.
 * The token is issued here, never in the browser, so the email challenge is
 * the authentication authority when WhatsApp delivery is unavailable.
 */
@Injectable()
export class VerifyBuyerEmailLoginUseCase {
  constructor(
    private readonly verifyEmailCode: VerifyBuyerEmailCodeUseCase,
    @Inject(BUYER_ACCOUNT_REPOSITORY) private readonly accounts: BuyerAccountRepository,
    private readonly jwt: BuyerJwtService,
  ) {}

  async execute(input: VerifyBuyerEmailLoginRequest): Promise<BuyerAuthResponse> {
    const email = typeof input.email === "string" ? input.email.trim().toLowerCase() : "";
    await this.verifyEmailCode.execute({ email, code: input.code });
    const account = await this.accounts.findByEmail(email);
    if (!account) throw new UnauthorizedException("email_otp_account_not_found");
    return toBuyerAuthResponse(account, this.jwt);
  }
}
