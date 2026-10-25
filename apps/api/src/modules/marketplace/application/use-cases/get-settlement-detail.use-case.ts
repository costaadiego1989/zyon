import { Injectable, NotFoundException } from "@nestjs/common";
import { MARKETPLACE_SETTLEMENT_REPOSITORY } from "../../domain/ports/marketplace-settlement-repository.port.js";
import type {
  MarketplaceSettlementRepository,
  MarketplaceSettlementSnapshot,
} from "../../domain/ports/marketplace-settlement-repository.port.js";
import { MARKETPLACE_SELLER_DEBT_REPOSITORY } from "../../domain/ports/marketplace-seller-debt-repository.port.js";
import type {
  MarketplaceSellerDebtRepository,
  MarketplaceSellerDebtSnapshot,
} from "../../domain/ports/marketplace-seller-debt-repository.port.js";
import { SettlementStateMachineService } from "../../domain/services/settlement-state-machine.service.js";
import type {
  SettlementStatus,
  SettlementEvent,
} from "../../domain/services/settlement-state-machine.service.js";

export interface GetSettlementDetailInput {
  settlementId: string;
  sellerMerchantId: string;
}

export interface SettlementTimelineEntry {
  status: SettlementStatus;
  timestamp: Date | null;
  label: string;
}

export interface GetSettlementDetailOutput {
  settlement: MarketplaceSettlementSnapshot;
  timeline: SettlementTimelineEntry[];
  availableTransitions: SettlementEvent[];
  debt: MarketplaceSellerDebtSnapshot | null;
}

@Injectable()
export class GetSettlementDetailUseCase {
  constructor(
    private readonly settlementRepository: MarketplaceSettlementRepository,
    private readonly debtRepository: MarketplaceSellerDebtRepository,
    private readonly stateMachine: SettlementStateMachineService,
  ) {}

  async execute(
    input: GetSettlementDetailInput,
  ): Promise<GetSettlementDetailOutput> {
    const settlement = await this.settlementRepository.getById(
      input.settlementId,
    );

    if (!settlement) {
      throw new NotFoundException("Settlement not found");
    }

    if (settlement.sellerMerchantId !== input.sellerMerchantId) {
      throw new NotFoundException("Settlement not found");
    }

    // Build timeline from settlement timestamps
    const timeline = this.buildTimeline(settlement);

    // Get available transitions from current state
    const availableTransitions = this.stateMachine.getAvailableEvents(
      settlement.status as SettlementStatus,
    );

    // Check for associated debt
    let debt: MarketplaceSellerDebtSnapshot | null = null;
    if (settlement.status === "chargeback_debt") {
      const debts = await this.debtRepository.findBySellerMerchantId(
        settlement.sellerMerchantId,
      );
      debt = debts.find((d) => d.settlementId === settlement.id) ?? null;
    }

    return {
      settlement,
      timeline,
      availableTransitions,
      debt,
    };
  }

  private buildTimeline(
    settlement: MarketplaceSettlementSnapshot,
  ): SettlementTimelineEntry[] {
    const timeline: SettlementTimelineEntry[] = [];

    // Always starts with awaiting_return_window
    timeline.push({
      status: "awaiting_return_window",
      timestamp: settlement.createdAt,
      label: "Aguardando janela de devolução",
    });

    // Check if return was cancelled
    if (settlement.status === "return_cancelled") {
      timeline.push({
        status: "return_cancelled",
        timestamp: settlement.returnAt ?? null,
        label: "Devolvido pelo comprador",
      });
      return timeline;
    }

    // Check early chargeback
    if (settlement.status === "chargeback_cancelled" && !settlement.transferredAt) {
      timeline.push({
        status: "chargeback_cancelled",
        timestamp: settlement.chargebackAt ?? null,
        label: "Chargeback cancelou repasse",
      });
      return timeline;
    }

    // Transfer scheduled
    if (
      settlement.transferScheduledAt ||
      ["transfer_scheduled", "transferred", "finalized", "chargeback_debt"].includes(
        settlement.status,
      )
    ) {
      timeline.push({
        status: "transfer_scheduled",
        timestamp: settlement.transferScheduledAt ?? null,
        label: "Repasse agendado",
      });
    }

    // Transferred
    if (
      settlement.transferredAt ||
      ["transferred", "finalized", "chargeback_debt"].includes(settlement.status)
    ) {
      timeline.push({
        status: "transferred",
        timestamp: settlement.transferredAt ?? null,
        label: "Repasse executado",
      });
    }

    // Final state: finalized or chargeback_debt
    if (settlement.status === "finalized") {
      timeline.push({
        status: "finalized",
        timestamp: settlement.finalizedAt ?? null,
        label: "Finalizado",
      });
    } else if (settlement.status === "chargeback_debt") {
      timeline.push({
        status: "chargeback_debt",
        timestamp: settlement.chargebackAt ?? null,
        label: "Chargeback — débito criado",
      });
    }

    return timeline;
  }
}
