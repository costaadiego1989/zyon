import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { BUYER_ACCOUNT_REPOSITORY, type BuyerAccountRepository } from "../../domain/ports/buyer-account-repository.port.js";
import { BuyerJwtService } from "../../domain/services/buyer-jwt.service.js";
import { BuyerAccount } from "../../domain/entities/buyer-account.entity.js";
import { CHECKOUT_SESSION_REPOSITORY, type CheckoutSessionRepository } from "../../../checkout/domain/ports/checkout-session.repository.port.js";
import { PasswordHasher } from "../../../auth/domain/services/password-hasher.service.js";
import { toBuyerAuthResponse, type BuyerAuthResponse } from "./register-buyer.use-case.js";

export interface LoginBuyerFromSessionRequest {
  session_id: string;
  merchant_id: string;
}

@Injectable()
export class LoginBuyerFromSessionUseCase {
  constructor(
    @Inject(CHECKOUT_SESSION_REPOSITORY) private readonly checkout: CheckoutSessionRepository,
    @Inject(BUYER_ACCOUNT_REPOSITORY) private readonly buyers: BuyerAccountRepository,
    private readonly jwt: BuyerJwtService,
    private readonly hasher: PasswordHasher
  ) {}

  async execute(input: LoginBuyerFromSessionRequest): Promise<BuyerAuthResponse> {
    const session = await this.checkout.getSession(input.merchant_id, input.session_id);
    if (!session) throw new NotFoundException("checkout_session_not_found");

    const customer = session.customer;
    if (!customer?.email || !customer.email_verified) {
      throw new BadRequestException("buyer_email_not_verified");
    }

    const email = customer.email.trim().toLowerCase();
    const existing = await this.buyers.findByEmail(email);
    if (existing) {
      return toBuyerAuthResponse(existing, this.jwt);
    }

    // Auto-create buyer account reusing the checkout session's globalUserId
    // so purchase history is linked automatically.
    const randomPassword = crypto.randomUUID();
    const passwordHash = await this.hasher.hash(randomPassword);
    const now = new Date();
    const account = new BuyerAccount({
      globalUserId: session.globalUserId,
      email,
      passwordHash,
      displayName: customer.fullName ?? email.split("@")[0]!,
      phone: customer.phone,
      createdAt: now,
      updatedAt: now,
    });
    await this.buyers.save(account);
    return toBuyerAuthResponse(account, this.jwt);
  }
}
