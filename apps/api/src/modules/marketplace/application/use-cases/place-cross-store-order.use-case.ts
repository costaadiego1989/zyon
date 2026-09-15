import { Injectable } from "@nestjs/common";
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
  completedAt?: Date;
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
  ) {}

  async execute(
    input: PlaceCrossStoreOrderInput,
  ): Promise<PlaceCrossStoreOrderOutput> {
    const lineItems = await this.orderRepository.findByCheckoutSessionId(
      input.checkoutSessionId,
    );

    if (lineItems.length === 0) {
      return { settlements: [] };
    }

    if (lineItems.some(item => item.hostMerchantId !== input.hostMerchantId || (item.orderId && item.orderId !== input.orderId))) throw new Error("marketplace_order_scope_mismatch");
    const config = await this.configRepository.get(input.hostMerchantId);
    if (!config) throw new Error("marketplace_settlement_config_missing");
    // A pause after payment cannot cancel the seller's financial entitlement.
    const orderDate = input.completedAt ?? new Date();
    const windows = this.stateMachine.calculateWindows(
      {
        returnWindowDays: config.returnWindowDays,
        payoutDelayDays: config.payoutDelayDays,
        chargebackWindowDays: config.chargebackWindowDays,
      },
      orderDate,
    );

    await Promise.all(
      lineItems.map((item) =>
        this.orderRepository.updateOrderId(item.id, input.orderId),
      ),
    );

    const settlements = await Promise.all(
      lineItems.map((item) =>
        this.settlementRepository.create({
          hostMerchantId: input.hostMerchantId,
          sellerMerchantId: item.sellerMerchantId,
          orderId: input.orderId,
          lineItemId: item.id,
          totalAmountCents: item.quantity * item.unitPriceCents,
          commissionCents: item.commissionCents,
          sellerNetCents: item.sellerNetCents,
          returnWindowUntil: windows.returnWindowUntil,
          transferScheduledAt: windows.transferScheduledAt,
          chargebackWindowUntil: windows.chargebackWindowUntil,
        }),
      ),
    );

    return { settlements };
  }
}
