import { Injectable, Inject, NotFoundException, UnprocessableEntityException } from "@nestjs/common";
import { BuyerCheckoutTemplateEntity } from "../../domain/entities/buyer-checkout-template.entity.js";
import { BUYER_USER_REPOSITORY, type BuyerUserRepository } from "../../domain/ports/buyer-user-repository.port.js";
import { BUYER_WALLET_REPOSITORY, type BuyerWalletRepository } from "../../domain/ports/buyer-wallet-repository.port.js";
import { BUYER_TEMPLATE_REPOSITORY, type BuyerTemplateRepository } from "../../domain/ports/buyer-template-repository.port.js";
import { OUTBOX_REPOSITORY, type OutboxRepository } from "../../../../shared/messaging/ports/outbox.repository.port.js";
import { createSelfCheckoutEventEnvelope } from "../../domain/events/self-checkout-domain-event.js";

export interface CreateCheckoutTemplateInput {
  buyer_user_id: string;
  merchant_id: string;
  name: string;
  saved_address_id: string;
  saved_payment_method_id: string;
  preferred_shipping_method_id?: string;
}

@Injectable()
export class CreateCheckoutTemplateUseCase {
  constructor(
    @Inject(BUYER_USER_REPOSITORY) private readonly users: BuyerUserRepository,
    // P1 fix: inject wallet repo so we can verify address/method belong to the buyer.
    @Inject(BUYER_WALLET_REPOSITORY) private readonly wallets: BuyerWalletRepository,
    @Inject(BUYER_TEMPLATE_REPOSITORY) private readonly templates: BuyerTemplateRepository,
    @Inject(OUTBOX_REPOSITORY) private readonly outbox: OutboxRepository
  ) {}

  async execute(input: CreateCheckoutTemplateInput) {
    const user = await this.users.findById(input.buyer_user_id);
    if (!user) throw new NotFoundException("BUYER_NOT_FOUND");

    // P1 fix: verify that the referenced address and payment method are owned by this buyer.
    const wallet = await this.wallets.findByBuyerUserId(input.buyer_user_id);
    if (!wallet) throw new NotFoundException("WALLET_NOT_FOUND");

    const addressOwned = wallet.saved_addresses.some((a) => a.id === input.saved_address_id);
    if (!addressOwned) throw new UnprocessableEntityException("ADDRESS_NOT_IN_WALLET");

    const methodOwned = wallet.saved_payment_methods.some((m) => m.id === input.saved_payment_method_id);
    if (!methodOwned) throw new UnprocessableEntityException("PAYMENT_METHOD_NOT_IN_WALLET");

    const template = BuyerCheckoutTemplateEntity.create({
      buyer_user_id: input.buyer_user_id,
      merchant_id: input.merchant_id,
      name: input.name,
      saved_address_id: input.saved_address_id,
      saved_payment_method_id: input.saved_payment_method_id,
      preferred_shipping_method_id: input.preferred_shipping_method_id ?? null,
    });

    await this.templates.save(template);

    // P1 note: save + appendOutbox are still two separate awaits.
    // Full atomicity requires a Prisma transactional outbox (ADR 0003).
    // Blocked until Prisma repos are wired (ADR 0004).
    await this.outbox.appendOutbox(
      createSelfCheckoutEventEnvelope({
        eventType: "buyer.template.created",
        merchantId: input.merchant_id,
        payload: { template_id: template.id, global_user_id: user.id, merchant_id: input.merchant_id },
      })
    );

    return template.snapshot();
  }
}
