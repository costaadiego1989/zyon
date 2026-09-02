import { Injectable } from "@nestjs/common";
import { CROSS_STORE_ORDER_REPOSITORY } from "../../domain/ports/cross-store-order-repository.port.js";
import type { CrossStoreOrderRepository } from "../../domain/ports/cross-store-order-repository.port.js";
import { MARKETPLACE_CONFIG_REPOSITORY } from "../../domain/ports/marketplace-config-repository.port.js";
import type { MarketplaceConfigRepository } from "../../domain/ports/marketplace-config-repository.port.js";
import { FEDERATED_PRODUCT_REPOSITORY } from "../../domain/ports/federated-product-repository.port.js";
import type { FederatedProductRepository } from "../../domain/ports/federated-product-repository.port.js";
import { CommissionCalculatorService } from "../../domain/services/commission-calculator.service.js";
import type { CrossStoreLineItemSnapshot } from "../../domain/ports/cross-store-order-repository.port.js";

export interface AddCrossStoreItemInput {
  checkoutSessionId: string;
  hostMerchantId: string;
  sellerMerchantId: string;
  federatedProductId: string;
  quantity: number;
  unitPriceCents: number;
}

export interface AddCrossStoreItemOutput {
  lineItem: CrossStoreLineItemSnapshot;
}

@Injectable()
export class AddCrossStoreItemUseCase {
  constructor(
    private readonly orderRepository: CrossStoreOrderRepository,
    private readonly configRepository: MarketplaceConfigRepository,
    private readonly productRepository: FederatedProductRepository,
    private readonly commissionCalculator: CommissionCalculatorService,
  ) {}

  async execute(input: AddCrossStoreItemInput): Promise<AddCrossStoreItemOutput> {
    const [config, product] = await Promise.all([
      this.configRepository.get(input.hostMerchantId),
      this.productRepository.getById(input.federatedProductId),
    ]);

    if (!config?.enabled) {
      throw new Error("Marketplace not enabled for this merchant");
    }

    if (!product) {
      throw new Error("Product not found");
    }

    if (product.sourceMerchantId === input.hostMerchantId) {
      throw new Error("Cannot add own products to cross-store cart");
    }

    if (config.blockedMerchants.includes(input.sellerMerchantId)) {
      throw new Error("Seller is blocked");
    }

    const commissionResult = this.commissionCalculator.calculate({
      itemPriceCents: input.unitPriceCents,
      quantity: input.quantity,
      commissionRateBps: config.commissionRateBps,
    });

    const lineItem = await this.orderRepository.create({
      checkoutSessionId: input.checkoutSessionId,
      hostMerchantId: input.hostMerchantId,
      sellerMerchantId: input.sellerMerchantId,
      federatedProductId: input.federatedProductId,
      quantity: input.quantity,
      unitPriceCents: input.unitPriceCents,
      commissionRateBps: config.commissionRateBps,
      commissionCents: commissionResult.commissionCents,
      sellerNetCents: commissionResult.sellerNetCents,
    });

    return { lineItem };
  }
}
