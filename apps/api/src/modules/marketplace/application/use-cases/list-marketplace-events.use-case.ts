import { BadRequestException, Injectable } from "@nestjs/common";
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
    if (!Number.isFinite(input.since.getTime()) || (input.limit !== undefined &&
        (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 200))) {
      throw new BadRequestException("invalid_marketplace_events_query");
    }
    const settlements = await this.settlementRepository.findBySellerMerchantId(
      input.sellerMerchantId,
    );

    // Lifecycle timestamps retain earlier transitions after the status advances.
    const events: MarketplaceEvent[] = settlements
      .flatMap((s) => this.toEvents(s))
      .filter((e) => new Date(e.createdAt) > input.since)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, input.limit ?? 50);

    return { events };
  }

  private toEvents(settlement: MarketplaceSettlementSnapshot): MarketplaceEvent[] {
    const events: MarketplaceEvent[] = [];
    const append = (type: MarketplaceEventType, suffix: string, at: Date | null) => {
      if (at) events.push({ id: `evt_${settlement.id}_${suffix}`, type, settlementId: settlement.id,
        amountCents: settlement.sellerNetCents, createdAt: at.toISOString() });
    };
    append("settlement_transferred", "transferred", settlement.transferredAt);
    append("settlement_finalized", "finalized", settlement.finalizedAt);
    append("return_cancelled", "return_cancelled", settlement.returnAt);
    if (settlement.chargebackAt) {
      const debt = settlement.status === "chargeback_debt";
      append(debt ? "chargeback_debt_created" : "chargeback_received",
        debt ? "chargeback_debt" : "chargeback_cancelled", settlement.chargebackAt);
    }
    // Preserve the current event for legacy rows without lifecycle timestamps.
    const current = this.toEvent(settlement);
    if (current && !events.some((e) => e.id === current.id)) events.push(current);
    return events;
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
