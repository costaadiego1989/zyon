import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { CROSS_STORE_ORDER_REPOSITORY } from "../../domain/ports/cross-store-order-repository.port.js";
import type {
  CrossStoreLineItemSnapshot,
  CrossStoreOrderRepository,
} from "../../domain/ports/cross-store-order-repository.port.js";

export interface UpdateMarketplaceFulfillmentInput {
  lineItemId: string;
  sellerMerchantId: string;
  action: "ship" | "deliver";
  trackingNumber?: string;
}

/**
 * Moves a seller-owned marketplace line item through its fulfillment lifecycle.
 * The conditional repository update prevents concurrent or cross-tenant writes
 * from skipping the pending -> shipped -> delivered sequence.
 */
@Injectable()
export class UpdateMarketplaceFulfillmentUseCase {
  constructor(
    private readonly orderRepository: CrossStoreOrderRepository,
  ) {}

  async execute(
    input: UpdateMarketplaceFulfillmentInput,
  ): Promise<CrossStoreLineItemSnapshot> {
    const item = await this.orderRepository.findByIdForSeller(
      input.lineItemId,
      input.sellerMerchantId,
    );
    if (!item) throw new NotFoundException("marketplace_line_item_not_found");

    const expectedStatus = input.action === "ship" ? "pending" : "shipped";
    const status = input.action === "ship" ? "shipped" : "delivered";

    if (item.fulfillmentStatus === status) return item;
    if (item.fulfillmentStatus !== expectedStatus) {
      throw new ConflictException({
        code: "invalid_marketplace_fulfillment_transition",
        current_status: item.fulfillmentStatus,
        expected_status: expectedStatus,
      });
    }
    if (input.action === "ship" && !input.trackingNumber?.trim()) {
      throw new ConflictException("marketplace_tracking_number_required");
    }

    const updated = await this.orderRepository.updateFulfillment({
      lineItemId: input.lineItemId,
      sellerMerchantId: input.sellerMerchantId,
      expectedStatus,
      status,
      ...(input.action === "ship"
        ? { fulfillmentReference: input.trackingNumber!.trim() }
        : {}),
    });
    if (!updated) {
      throw new ConflictException("marketplace_fulfillment_changed_concurrently");
    }
    return updated;
  }
}
