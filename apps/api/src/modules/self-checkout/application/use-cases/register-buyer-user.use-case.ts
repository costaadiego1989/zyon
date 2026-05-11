import { Injectable, Inject, ConflictException } from "@nestjs/common";
import { BuyerUserEntity } from "../../domain/entities/buyer-user.entity.js";
import { BuyerWalletEntity } from "../../domain/entities/buyer-wallet.entity.js";
import { BUYER_USER_REPOSITORY, type BuyerUserRepository } from "../../domain/ports/buyer-user-repository.port.js";
import { BUYER_WALLET_REPOSITORY, type BuyerWalletRepository } from "../../domain/ports/buyer-wallet-repository.port.js";
import { OUTBOX_REPOSITORY, type OutboxRepository } from "../../../../shared/messaging/ports/outbox.repository.port.js";
import { CURRENT_CONSENT_VERSION } from "../../domain/policies/consent.policy.js";
import { createSelfCheckoutEventEnvelope } from "../../domain/events/self-checkout-domain-event.js";

export interface RegisterBuyerUserInput {
  email: string;
  password: string;
  display_name?: string;
  marketing_opt_in?: boolean;
}

@Injectable()
export class RegisterBuyerUserUseCase {
  constructor(
    @Inject(BUYER_USER_REPOSITORY) private readonly users: BuyerUserRepository,
    @Inject(BUYER_WALLET_REPOSITORY) private readonly wallets: BuyerWalletRepository,
    @Inject(OUTBOX_REPOSITORY) private readonly outbox: OutboxRepository
  ) {}

  async execute(input: RegisterBuyerUserInput): Promise<{ user_id: string }> {
    const existing = await this.users.findByEmail(input.email);
    if (existing) throw new ConflictException("EMAIL_ALREADY_REGISTERED");

    const user = BuyerUserEntity.create({
      email: input.email,
      password_hash: input.password,
      display_name: input.display_name,
      consent_version: CURRENT_CONSENT_VERSION,
      marketing_opt_in: input.marketing_opt_in ?? false,
    });

    const wallet = BuyerWalletEntity.create(user.id);
    await this.users.save(user);
    await this.wallets.save(wallet);

    await this.outbox.appendOutbox(
      createSelfCheckoutEventEnvelope({
        eventType: "buyer.registered",
        merchantId: "platform",
        payload: { global_user_id: user.id, email: user.email, created_at: user.created_at.toISOString() },
      })
    );

    return { user_id: user.id };
  }
}
