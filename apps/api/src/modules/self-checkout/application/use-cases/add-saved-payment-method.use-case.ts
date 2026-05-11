import { Injectable, Inject, HttpException, NotFoundException } from "@nestjs/common";
import { BUYER_USER_REPOSITORY, type BuyerUserRepository } from "../../domain/ports/buyer-user-repository.port.js";
import { BUYER_WALLET_REPOSITORY, type BuyerWalletRepository } from "../../domain/ports/buyer-wallet-repository.port.js";
import { PAYMENT_TOKENIZER, type PaymentTokenizerPort, type TokenizeCardInput } from "../../domain/ports/payment-tokenizer.port.js";
import { OUTBOX_REPOSITORY, type OutboxRepository } from "../../../../shared/messaging/ports/outbox.repository.port.js";
import { checkConsent } from "../../domain/policies/consent.policy.js";
import { createSelfCheckoutEventEnvelope } from "../../domain/events/self-checkout-domain-event.js";

export type AddSavedPaymentMethodInput = TokenizeCardInput & { buyer_user_id: string; label: string };

@Injectable()
export class AddSavedPaymentMethodUseCase {
  constructor(
    @Inject(BUYER_USER_REPOSITORY) private readonly users: BuyerUserRepository,
    @Inject(BUYER_WALLET_REPOSITORY) private readonly wallets: BuyerWalletRepository,
    @Inject(PAYMENT_TOKENIZER) private readonly tokenizer: PaymentTokenizerPort,
    @Inject(OUTBOX_REPOSITORY) private readonly outbox: OutboxRepository
  ) {}

  async execute(input: AddSavedPaymentMethodInput) {
    const user = await this.users.findById(input.buyer_user_id);
    if (!user) throw new NotFoundException("BUYER_NOT_FOUND");

    const consent = checkConsent(user);
    if (!consent.allowed) throw new HttpException(consent.reason ?? "CONSENT_REQUIRED", 451);

    const wallet = await this.wallets.findByBuyerUserId(input.buyer_user_id);
    if (!wallet) throw new NotFoundException("WALLET_NOT_FOUND");

    const token = await this.tokenizer.tokenize({
      card_number: input.card_number,
      expiry_month: input.expiry_month,
      expiry_year: input.expiry_year,
      cvv: input.cvv,
      holder_name: input.holder_name,
    });

    const { wallet: updated, method } = wallet.addPaymentMethod({
      label: input.label,
      gateway: token.gateway,
      gateway_token: token.gateway_token,
      last_four: token.last_four,
      brand: token.brand,
      expires_at: token.expires_at,
      is_default: false,
    });

    await this.wallets.save(updated);

    await this.outbox.appendOutbox(
      createSelfCheckoutEventEnvelope({
        eventType: "buyer.wallet.payment-method-added",
        merchantId: "platform",
        payload: { global_user_id: user.id, method_id: method.id, brand: token.brand, last_four: token.last_four },
      })
    );

    return { method_id: method.id, brand: token.brand, last_four: token.last_four };
  }
}
