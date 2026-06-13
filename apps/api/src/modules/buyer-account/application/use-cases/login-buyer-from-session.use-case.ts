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
      const hydrated = hydrateMissingCheckoutProfile(existing, {
        displayName: customer.fullName,
        phone: customer.phone,
        address: customer.address,
        cpf: customer.cpf
      });
      if (hydrated !== existing) await this.buyers.save(hydrated);
      return toBuyerAuthResponse(hydrated, this.jwt);
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
      cpf: customer.cpf,
      address: customer.address,
      createdAt: now,
      updatedAt: now,
    });
    await this.buyers.save(account);
    return toBuyerAuthResponse(account, this.jwt);
  }
}

function hydrateMissingCheckoutProfile(
  account: BuyerAccount,
  input: { displayName?: string; phone?: string; address?: BuyerAccount["address"]; cpf?: string }
): BuyerAccount {
  const nextName = shouldUseCheckoutName(account, input.displayName) ? input.displayName?.trim() : undefined;
  const nextPhone = !account.phone && input.phone ? input.phone.trim() : undefined;
  const nextAddress = !account.address && input.address ? input.address : undefined;
  const nextCpf = !account.cpf && input.cpf ? input.cpf.replace(/\D/g, "") : undefined;
  if (!nextName && !nextPhone && !nextAddress && !nextCpf) return account;
  return account.withUpdatedProfile(nextName, nextPhone, nextAddress, nextCpf);
}

function shouldUseCheckoutName(account: BuyerAccount, checkoutName?: string): boolean {
  const candidate = checkoutName?.trim();
  if (!candidate) return false;
  const current = account.displayName.trim();
  const emailPrefix = account.email.split("@")[0] ?? "";
  return current.length === 0 || current.toLowerCase() === emailPrefix.toLowerCase();
}
