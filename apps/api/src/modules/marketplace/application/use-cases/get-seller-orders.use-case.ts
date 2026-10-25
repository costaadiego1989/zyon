import { Injectable } from "@nestjs/common";
import { CROSS_STORE_ORDER_REPOSITORY } from "../../domain/ports/cross-store-order-repository.port.js";
import type {
  CrossStoreOrderRepository,
  CrossStoreLineItemSnapshot,
} from "../../domain/ports/cross-store-order-repository.port.js";

export interface GetSellerOrdersInput {
  sellerMerchantId: string;
}

export interface GetSellerOrdersOutput {
  orders: CrossStoreLineItemSnapshot[];
}

@Injectable()
export class GetSellerOrdersUseCase {
  constructor(
    private readonly orderRepository: CrossStoreOrderRepository,
  ) {}

  async execute(
    input: GetSellerOrdersInput,
  ): Promise<GetSellerOrdersOutput> {
    const orders = await this.orderRepository.findBySellerMerchantId(
      input.sellerMerchantId,
    );
    return { orders };
  }
}
