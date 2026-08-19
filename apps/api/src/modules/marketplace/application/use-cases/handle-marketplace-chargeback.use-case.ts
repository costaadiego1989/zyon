import { Injectable, Logger } from "@nestjs/common";
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

export interface HandleMarketplaceChargebackInput {
  settlementId: string;
}

export interface HandleMarketplaceChargebackOutput {
  settlement: MarketplaceSettlementSnapshot;
  debtCreated: boolean;
  debt?: MarketplaceSellerDebtSnapshot;
}

@Injectable()
export class HandleMarketplaceChargebackUseCase {
  private readonly logger = new Logger(HandleMarketplaceChargebackUseCase.name);

  constructor(
    private readonly settlementRepository: MarketplaceSettlementRepository,
    private readonly debtRepository: MarketplaceSellerDebtRepository,
    private readonly stateMachine: SettlementStateMachineService,
  ) {}

  async execute(
    input: HandleMarketplaceChargebackInput,
  ): Promise<HandleMarketplaceChargebackOutput> {
    const settlement = await this.settlementRepository.getById(
      input.settlementId,
    );
    if (!settlement) {
      throw new Error("Settlement not found");
    }

    const newStatus = this.stateMachine.transition(
      settlement.status,
      "chargeback_received",
    );

    const updated = await this.settlementRepository.updateStatus({
      settlementId: settlement.id,
      status: newStatus,
      chargebackAt: new Date(),
    });

    const debtCreated = newStatus === "chargeback_debt";
    let debt: MarketplaceSellerDebtSnapshot | undefined;

    if (debtCreated) {
      debt = await this.debtRepository.create({
        sellerMerchantId: settlement.sellerMerchantId,
        settlementId: settlement.id,
        amountCents: settlement.sellerNetCents,
      });

      this.logger.warn(
        `Chargeback debt created for settlement ${settlement.id}, seller ${settlement.sellerMerchantId}, amount=${settlement.sellerNetCents}, debtId=${debt.id}`,
      );
    } else {
      this.logger.log(
        `Chargeback cancelled settlement ${settlement.id}, status: ${settlement.status} → ${newStatus}`,
      );
    }

    return { settlement: updated, debtCreated, debt };
  }
}
