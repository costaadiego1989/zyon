import { Injectable } from "@nestjs/common";
import { CROSS_STORE_ORDER_REPOSITORY } from "../../domain/ports/cross-store-order-repository.port.js";
import type {
  CrossStoreOrderRepository,
  CrossStoreLineItemSnapshot,
} from "../../domain/ports/cross-store-order-repository.port.js";
import { MARKETPLACE_SETTLEMENT_REPOSITORY } from "../../domain/ports/marketplace-settlement-repository.port.js";
import type { MarketplaceSettlementRepository } from "../../domain/ports/marketplace-settlement-repository.port.js";
import { MARKETPLACE_SELLER_DEBT_REPOSITORY } from "../../domain/ports/marketplace-seller-debt-repository.port.js";
import type { MarketplaceSellerDebtRepository } from "../../domain/ports/marketplace-seller-debt-repository.port.js";

export interface GetSellerStatsInput {
  sellerMerchantId: string;
}

export interface GetSellerStatsOutput {
  pendingOrders: number;
  monthlyRevenueCents: number;
  monthlyCommissionCents: number;
  itemsShipped: number;
  totalItems: number;
  fulfillmentRate: number;
  outstandingDebtCents: number;
}

@Injectable()
export class GetSellerStatsUseCase {
  constructor(
    private readonly orderRepository: CrossStoreOrderRepository,
    private readonly settlementRepository: MarketplaceSettlementRepository,
    private readonly debtRepository: MarketplaceSellerDebtRepository,
  ) {}

  async execute(input: GetSellerStatsInput): Promise<GetSellerStatsOutput> {
    const [allOrders, allSettlements, outstandingDebts] = await Promise.all([
      this.orderRepository.findBySellerMerchantId(input.sellerMerchantId),
      this.settlementRepository.findBySellerMerchantId(input.sellerMerchantId),
      this.debtRepository.findOutstandingBySellerMerchantId(
        input.sellerMerchantId,
      ),
    ]);

    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const monthlyOrders = allOrders.filter(
      (o) => o.createdAt >= startOfMonth,
    );

    const pendingOrders = allOrders.filter(
      (o) => o.fulfillmentStatus === "pending",
    ).length;

    const monthlyRevenueCents = this.sumSellerNet(monthlyOrders);
    const monthlyCommissionCents = this.sumCommission(monthlyOrders);

    const itemsShipped = allOrders.filter(
      (o) => o.fulfillmentStatus === "shipped",
    ).length;
    const totalItems = allOrders.length;
    const fulfillmentRate = totalItems > 0 ? itemsShipped / totalItems : 0;

    const outstandingDebtCents = outstandingDebts.reduce(
      (sum, d) => sum + d.amountCents,
      0,
    );

    return {
      pendingOrders,
      monthlyRevenueCents,
      monthlyCommissionCents,
      itemsShipped,
      totalItems,
      fulfillmentRate,
      outstandingDebtCents,
    };
  }

  private sumSellerNet(orders: CrossStoreLineItemSnapshot[]): number {
    return orders.reduce((sum, o) => sum + o.sellerNetCents, 0);
  }

  private sumCommission(orders: CrossStoreLineItemSnapshot[]): number {
    return orders.reduce((sum, o) => sum + o.commissionCents, 0);
  }
}
