import { Injectable } from "@nestjs/common";
import { MARKETPLACE_SETTLEMENT_REPOSITORY } from "../../domain/ports/marketplace-settlement-repository.port.js";
import type {
  MarketplaceSettlementRepository,
  MarketplaceSettlementSnapshot,
} from "../../domain/ports/marketplace-settlement-repository.port.js";

export interface ListMarketplaceEventsInput {
  sellerMerchantId: string;
  since: Date;
  limit?: number;
}

export type MarketplaceEventType =
  | "settlement_transferred"
  | "settlement_finalized"
  | "chargeback_received"
  | "chargeback_debt_created"
  | "return_cancelled";

export interface MarketplaceEvent {
  id: string;
  type: MarketplaceEventType;
  settlementId: string;
  amountCents: number;
  createdAt: string;
}

export interface ListMarketplaceEventsOutput {
  events: MarketplaceEvent[];
}

@Injectable()
export class ListMarketplaceEventsUseCase {
  constructor(
    private readonly settlementRepository: MarketplaceSettlementRepository,
  ) {}

  async execute(
    input: ListMarketplaceEventsInput,
  ): Promise<ListMarketplaceEventsOutput> {
    const settlements = await this.settlementRepository.findBySellerMerchantId(
      input.sellerMerchantId,
    );

    // Filter settlements updated after 'since' — these are recent state changes
    const recentlyChanged = settlements.filter(
      (s) => s.updatedAt > input.since,
    );

    // Convert to events based on current status
    const events: MarketplaceEvent[] = recentlyChanged
      .map((s) => this.toEvent(s))
      .filter((e): e is MarketplaceEvent => e !== null)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, input.limit ?? 50);

    return { events };
  }

  private toEvent(settlement: MarketplaceSettlementSnapshot): MarketplaceEvent | null {
    const base = {
      settlementId: settlement.id,
      amountCents: settlement.sellerNetCents,
    };

    switch (settlement.status) {
      case "transferred":
        return {
          ...base,
          id: `evt_${settlement.id}_transferred`,
          type: "settlement_transferred",
          createdAt: (settlement.transferredAt ?? settlement.updatedAt).toISOString(),
        };
      case "finalized":
        return {
          ...base,
          id: `evt_${settlement.id}_finalized`,
          type: "settlement_finalized",
          createdAt: (settlement.finalizedAt ?? settlement.updatedAt).toISOString(),
        };
      case "chargeback_cancelled":
        return {
          ...base,
          id: `evt_${settlement.id}_chargeback_cancelled`,
          type: "chargeback_received",
          createdAt: (settlement.chargebackAt ?? settlement.updatedAt).toISOString(),
        };
      case "chargeback_debt":
        return {
          ...base,
          id: `evt_${settlement.id}_chargeback_debt`,
          type: "chargeback_debt_created",
          createdAt: (settlement.chargebackAt ?? settlement.updatedAt).toISOString(),
        };
      case "return_cancelled":
        return {
          ...base,
          id: `evt_${settlement.id}_return_cancelled`,
          type: "return_cancelled",
          createdAt: (settlement.returnAt ?? settlement.updatedAt).toISOString(),
        };
      default:
        return null;
    }
  }
}
