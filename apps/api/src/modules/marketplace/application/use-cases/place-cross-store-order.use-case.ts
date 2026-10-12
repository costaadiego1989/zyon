import type { MarketplaceFinancialRepository } from "../../domain/ports/marketplace-financial-repository.port.js";
import { ConflictException, Injectable } from "@nestjs/common";
import { CROSS_STORE_ORDER_REPOSITORY } from "../../domain/ports/cross-store-order-repository.port.js";
import type { CrossStoreOrderRepository } from "../../domain/ports/cross-store-order-repository.port.js";
import { MARKETPLACE_SETTLEMENT_REPOSITORY } from "../../domain/ports/marketplace-settlement-repository.port.js";
import type { MarketplaceSettlementRepository } from "../../domain/ports/marketplace-settlement-repository.port.js";
import { MARKETPLACE_CONFIG_REPOSITORY } from "../../domain/ports/marketplace-config-repository.port.js";
import type { MarketplaceConfigRepository } from "../../domain/ports/marketplace-config-repository.port.js";
import { SettlementStateMachineService } from "../../domain/services/settlement-state-machine.service.js";
import type { MarketplaceSettlementSnapshot } from "../../domain/ports/marketplace-settlement-repository.port.js";

export interface PlaceCrossStoreOrderInput {
  checkoutSessionId: string;
  orderId: string;
  hostMerchantId: string;
  purchasedAt?: Date;
}

export interface PlaceCrossStoreOrderOutput {
  settlements: MarketplaceSettlementSnapshot[];
}

@Injectable()
export class PlaceCrossStoreOrderUseCase {
  constructor(
    private readonly orderRepository: CrossStoreOrderRepository,
    private readonly settlementRepository: MarketplaceSettlementRepository,
    private readonly configRepository: MarketplaceConfigRepository,
    private readonly stateMachine: SettlementStateMachineService,
    private readonly financialRepository?: MarketplaceFinancialRepository,
  ) {}

  async execute(
    input: PlaceCrossStoreOrderInput,
  ): Promise<PlaceCrossStoreOrderOutput> {
    if (!this.financialRepository) throw new Error("marketplace_financial_repository_required");
    return { settlements: await this.financialRepository.placeOrder(input) };
  }
}
