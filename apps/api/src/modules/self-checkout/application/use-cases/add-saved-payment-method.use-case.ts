import { Injectable, Inject, HttpException, NotFoundException , Logger} from "@nestjs/common";
import { BUYER_USER_REPOSITORY, type BuyerUserRepository } from "../../domain/ports/buyer-user-repository.port.js";
import { BUYER_WALLET_REPOSITORY, type BuyerWalletRepository } from "../../domain/ports/buyer-wallet-repository.port.js";
import type { TokenizeCardResult } from "../../domain/ports/payment-tokenizer.port.js";
import { OUTBOX_REPOSITORY, type OutboxRepository } from "../../../../shared/messaging/ports/outbox.repository.port.js";
import { checkConsent } from "../../domain/policies/consent.policy.js";
import { createSelfCheckoutEventEnvelope } from "../../domain/events/self-checkout-domain-event.js";
import { CorrelationIdStorage } from "../../../../shared/logger/correlation-id.storage.js";

/**
 * P2 PCI fix: use-case no longer accepts raw card data (PAN/CVV).
 * The controller tokenizes at the edge and passes only the opaque TokenizeCardResult.
 * PAN and CVV never cross the application/domain boundary.
 */
export interface AddSavedPaymentMethodInput {
  buyer_user_id: string;
  label: string;
  /** Pre-tokenized result from the presentation layer. No raw card data here. */
  token: TokenizeCardResult;
}

@Injectable()
export class AddSavedPaymentMethodUseCase {
  private readonly logger = new Logger(AddSavedPaymentMethodUseCase.name);

  constructor(
    @Inject(BUYER_USER_REPOSITORY) private readonly users: BuyerUserRepository,
    @Inject(BUYER_WALLET_REPOSITORY) private readonly wallets: BuyerWalletRepository,
    @Inject(OUTBOX_REPOSITORY) private readonly outbox: OutboxRepository
  ) {}

  async execute(input: AddSavedPaymentMethodInput) {
    const user = await this.users.findById(input.buyer_user_id);
    if (!user) throw new NotFoundException("BUYER_NOT_FOUND");

    const consent = checkConsent(user);
    if (!consent.allowed) throw new HttpException(consent.reason ?? "CONSENT_REQUIRED", 451);

    const wallet = await this.wallets.findByBuyerUserId(input.buyer_user_id);
    if (!wallet) throw new NotFoundException("WALLET_NOT_FOUND");

    const { token } = input;
    const { wallet: updated, method } = wallet.addPaymentMethod({
      label: input.label,
      gateway: token.gateway,
      gateway_token: token.gateway_token,
      last_four: token.last_four,
      brand: token.brand,
      expires_at: token.expires_at,
      is_default: false,
    });

    // P2 note: save + appendOutbox are two separate awaits.
    // Full atomicity requires a Prisma transactional outbox (ADR 0003).
    // Blocked until Prisma repos are wired (ADR 0004).
    await this.wallets.save(updated);

    await this.outbox.appendOutbox(
      createSelfCheckoutEventEnvelope({
        eventType: "buyer.wallet.payment-method-added",
        merchantId: user.merchant_id,
        payload: { global_user_id: user.id, method_id: method.id, brand: token.brand, last_four: token.last_four },
      })
    );

    return { method_id: method.id, brand: token.brand, last_four: token.last_four };
  }
}
