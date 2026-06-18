import { Injectable, Inject, NotFoundException, UnprocessableEntityException } from "@nestjs/common";
import { BUYER_WALLET_REPOSITORY, type BuyerWalletRepository } from "../../domain/ports/buyer-wallet-repository.port.js";
import { BUYER_TEMPLATE_REPOSITORY, type BuyerTemplateRepository } from "../../domain/ports/buyer-template-repository.port.js";
import { OUTBOX_REPOSITORY, type OutboxRepository } from "../../../../shared/messaging/ports/outbox.repository.port.js";
import { evaluateTemplateExecution } from "../../domain/policies/template-execution.policy.js";
import { createSelfCheckoutEventEnvelope } from "../../domain/events/self-checkout-domain-event.js";

export interface ExecuteCheckoutTemplateInput {
  template_id: string;
  buyer_user_id: string;
  accepted_payment_brands: string[];
  allowed_shipping_regions: string[];
  items_in_stock: boolean;
}

@Injectable()
export class ExecuteCheckoutTemplateUseCase {
  constructor(
    @Inject(BUYER_WALLET_REPOSITORY) private readonly wallets: BuyerWalletRepository,
    @Inject(BUYER_TEMPLATE_REPOSITORY) private readonly templates: BuyerTemplateRepository,
    @Inject(OUTBOX_REPOSITORY) private readonly outbox: OutboxRepository
  ) {}

  async execute(input: ExecuteCheckoutTemplateInput) {
    // P0 fix: findById now scoped by buyer_user_id → IDOR impossible; returns null for cross-account.
    const template = await this.templates.findById(input.template_id, input.buyer_user_id);
    if (!template) throw new NotFoundException("TEMPLATE_NOT_FOUND");

    const wallet = await this.wallets.findByBuyerUserId(input.buyer_user_id);
    if (!wallet) throw new NotFoundException("WALLET_NOT_FOUND");

    const method = wallet.saved_payment_methods.find((m) => m.id === template.saved_payment_method_id);
    if (!method) throw new NotFoundException("PAYMENT_METHOD_NOT_FOUND");

    const address = wallet.saved_addresses.find((a) => a.id === template.saved_address_id);
    if (!address) throw new NotFoundException("ADDRESS_NOT_FOUND");

    const policy = evaluateTemplateExecution({
      accepted_payment_brands: input.accepted_payment_brands,
      allowed_shipping_regions: input.allowed_shipping_regions,
      payment_brand: method.brand,
      delivery_state: address.state,
      items_in_stock: input.items_in_stock,
    });

    if (!policy.allowed) throw new UnprocessableEntityException(`TEMPLATE_POLICY_VIOLATION:${policy.reason}`);

    await this.outbox.appendOutbox(
      createSelfCheckoutEventEnvelope({
        eventType: "buyer.template.executed",
        merchantId: template.merchant_id,
        payload: {
          template_id: template.id,
          global_user_id: input.buyer_user_id,
          merchant_id: template.merchant_id,
          payment_method_id: method.id,
        },
      })
    );

    return {
      template_id: template.id,
      address: address.snapshot(),
      payment_method: { id: method.id, brand: method.brand, last_four: method.last_four },
    };
  }
}
