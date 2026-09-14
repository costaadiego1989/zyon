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

    if (product.sourceMerchantId !== input.sellerMerchantId) {
      throw new Error("Seller does not match product");
    }

    if (config.blockedMerchants.includes(product.sourceMerchantId)) {
      throw new Error("Seller is blocked");
    }

    const sellerConfig = await this.configRepository.get(product.sourceMerchantId);
    if (!sellerConfig?.enabled || sellerConfig.blockedMerchants.includes(input.hostMerchantId)) {
      throw new Error("Seller is unavailable");
    }
    if (!product.stockAvailable) throw new Error("Product is out of stock");
    if (product.currency !== "BRL") throw new Error("Unsupported product currency");
    if (!Number.isSafeInteger(input.quantity) || input.quantity <= 0) {
      throw new Error("quantity must be a positive safe integer");
    }
    if (!Number.isSafeInteger(product.priceCents) || product.priceCents <= 0 ||
        !Number.isSafeInteger(product.priceCents * input.quantity)) {
      throw new Error("Invalid product price or total");
    }

    const commissionResult = this.commissionCalculator.calculate({
      itemPriceCents: product.priceCents,
      quantity: input.quantity,
      commissionRateBps: sellerConfig.commissionRateBps,
    });

    const lineItem = await this.orderRepository.create({
      checkoutSessionId: input.checkoutSessionId,
      hostMerchantId: input.hostMerchantId,
      sellerMerchantId: product.sourceMerchantId,
      federatedProductId: input.federatedProductId,
      quantity: input.quantity,
      unitPriceCents: product.priceCents,
      commissionRateBps: sellerConfig.commissionRateBps,
      commissionCents: commissionResult.commissionCents,
      sellerNetCents: commissionResult.sellerNetCents,
    });

    return { lineItem };
  }
}
