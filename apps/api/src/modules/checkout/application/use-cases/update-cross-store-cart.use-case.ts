import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { CrossStoreLineItem } from "@zyon/shared-types";
import type { AddCrossStoreItemInput } from "../../../marketplace/application/use-cases/add-cross-store-item.use-case.js";
import { AddCrossStoreItemUseCase } from "../../../marketplace/application/use-cases/add-cross-store-item.use-case.js";
import { CheckoutSessionEntity } from "../../domain/entities/checkout-session.entity.js";
import { CHECKOUT_SESSION_REPOSITORY, type CheckoutSessionRepository } from "../../domain/ports/checkout-session.repository.port.js";

export interface UpdateCrossStoreCartInput {
  merchant_id: string;
  session_id: string;
  federated_product_id: string;
  seller_merchant_id: string;
  quantity: number;
  unit_price_cents: number;
}

export interface UpdateCrossStoreCartOutput {
  session_id: string;
  cart_total: number;
  cross_store_items_count: number;
}

@Injectable()
export class UpdateCrossStoreCartUseCase {
  constructor(
    @Inject(CHECKOUT_SESSION_REPOSITORY) private readonly sessions: CheckoutSessionRepository,
    private readonly addCrossStoreItem: AddCrossStoreItemUseCase
  ) {}

  async execute(input: UpdateCrossStoreCartInput): Promise<UpdateCrossStoreCartOutput> {
    const session = await this.sessions.getSession(input.merchant_id, input.session_id);
    if (!session) throw new NotFoundException("Session not found");

    const result = await this.addCrossStoreItem.execute({
      checkoutSessionId: input.session_id,
      hostMerchantId: input.merchant_id,
      sellerMerchantId: input.seller_merchant_id,
      federatedProductId: input.federated_product_id,
      quantity: input.quantity,
      unitPriceCents: input.unit_price_cents
    } as AddCrossStoreItemInput);

    const lineItem: CrossStoreLineItem = {
      lineItemId: result.lineItem.id,
      federatedProductId: result.lineItem.federatedProductId,
      sourceMerchantId: result.lineItem.sellerMerchantId,
      quantity: result.lineItem.quantity,
      unitPriceCents: result.lineItem.unitPriceCents,
      totalCents: result.lineItem.unitPriceCents * result.lineItem.quantity,
      commissionCents: result.lineItem.commissionCents,
      sellerNetCents: result.lineItem.sellerNetCents
    };

    const entity = CheckoutSessionEntity.rehydrate(session).addCrossStoreItem(lineItem);
    await this.sessions.saveSession(entity.snapshot());

    return {
      session_id: input.session_id,
      cart_total: entity.snapshot().cart.total,
      cross_store_items_count: entity.getCrossStoreItems().length
    };
  }
}
