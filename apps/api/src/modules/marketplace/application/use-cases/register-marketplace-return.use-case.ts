import { Injectable, Logger } from "@nestjs/common";
import { MARKETPLACE_SETTLEMENT_REPOSITORY } from "../../domain/ports/marketplace-settlement-repository.port.js";
import type {
  MarketplaceSettlementRepository,
  MarketplaceSettlementSnapshot,
} from "../../domain/ports/marketplace-settlement-repository.port.js";
import { CROSS_STORE_ORDER_REPOSITORY } from "../../domain/ports/cross-store-order-repository.port.js";
import type { CrossStoreOrderRepository } from "../../domain/ports/cross-store-order-repository.port.js";
import { SettlementStateMachineService } from "../../domain/services/settlement-state-machine.service.js";

export interface RegisterMarketplaceReturnInput {
  /** Register the return for a cross-store order. */
  orderId?: string;
  /** Or target a single settlement directly. */
  settlementId?: string;
  /**
   * Optional per-item scope. On a MIXED order (some items from the host's own
   * store, some cross-store from partner sellers) only these variant ids are
   * returned. Items belonging to the host's own catalog have no cross-store
   * settlement and are simply ignored here (the host handles those in the normal
   * return flow). When omitted, every cross-store settlement of the order is
   * cancelled.
   */
  variantIds?: string[];
}

export interface RegisterMarketplaceReturnOutput {
  updated: MarketplaceSettlementSnapshot[];
  skipped: Array<{ settlementId: string; reason: string }>;
}

/**
 * Registers a buyer return on the marketplace settlement(s) of a cross-store
 * order. This is the link between the support/return flow (host handles the
 * complaint and routes it to the product owner/seller) and the financial
 * ledger: approving the return moves the settlement `awaiting_return_window`
 * → `return_cancelled` via the state machine, which cancels the seller repasse
 * and makes the return surface in the dashboard Devoluções tab.
 *
 * Only settlements still inside the return window (`awaiting_return_window`)
 * can be returned; once a transfer is scheduled/executed the proper channel is
 * a chargeback (HandleMarketplaceChargebackUseCase), so those are skipped with
 * a reason instead of throwing.
 *
 * MIXED ORDERS: a buyer can return a subset of a multi-item / multi-seller
 * order. When `variantIds` is provided we resolve them to their cross-store
 * line items (variantId === federatedProductId) and cancel only the matching
 * settlements — the host's own-store items and other sellers' items are left
 * untouched.
 */
@Injectable()
export class RegisterMarketplaceReturnUseCase {
  private readonly logger = new Logger(RegisterMarketplaceReturnUseCase.name);

  constructor(
    private readonly settlementRepository: MarketplaceSettlementRepository,
    private readonly stateMachine: SettlementStateMachineService,
    private readonly crossStoreOrderRepository: CrossStoreOrderRepository,
  ) {}

  async execute(
    input: RegisterMarketplaceReturnInput,
  ): Promise<RegisterMarketplaceReturnOutput> {
    if (!input.orderId && !input.settlementId) {
      throw new Error("register_return_requires_order_or_settlement");
    }

    const settlements = input.settlementId
      ? await this.oneById(input.settlementId)
      : await this.resolveOrderSettlements(input.orderId!, input.variantIds);

    if (settlements.length === 0) {
      throw new Error("no_marketplace_settlement_for_return");
    }

    const updated: MarketplaceSettlementSnapshot[] = [];
    const skipped: Array<{ settlementId: string; reason: string }> = [];

    for (const settlement of settlements) {
      if (settlement.status !== "awaiting_return_window") {
        skipped.push({
          settlementId: settlement.id,
          reason: `not_in_return_window (status=${settlement.status})`,
        });
        continue;
      }
      const newStatus = this.stateMachine.transition(
        settlement.status,
        "buyer_returned",
      );
      const result = await this.settlementRepository.updateStatus({
        settlementId: settlement.id,
        status: newStatus,
        returnAt: new Date(),
      });
      this.logger.log(
        `Return registered: settlement ${settlement.id} ${settlement.status} → ${newStatus} (seller ${settlement.sellerMerchantId}, repasse ${settlement.sellerNetCents} cancelled)`,
      );
      updated.push(result);
    }

    return { updated, skipped };
  }

  /**
   * Resolve the settlements to cancel for an order. Without `variantIds` this is
   * every settlement of the order; with them, only the settlements of the
   * matching cross-store line items (mixed-order per-item return).
   */
  private async resolveOrderSettlements(
    orderId: string,
    variantIds?: string[],
  ): Promise<MarketplaceSettlementSnapshot[]> {
    if (!variantIds || variantIds.length === 0) {
      return this.settlementRepository.findByOrderId(orderId);
    }

    const wanted = new Set(variantIds);
    const lineItems = await this.crossStoreOrderRepository.findByOrderId(orderId);
    // variantId returned by the storefront cart for a federated product IS the
    // federatedProductId, so we match on that.
    const matchingLineItemIds = lineItems
      .filter((li) => wanted.has(li.federatedProductId))
      .map((li) => li.id);

    const settlements: MarketplaceSettlementSnapshot[] = [];
    for (const lineItemId of matchingLineItemIds) {
      const s = await this.settlementRepository.findByLineItemId(lineItemId);
      if (s) settlements.push(s);
    }
    return settlements;
  }

  private async oneById(
    settlementId: string,
  ): Promise<MarketplaceSettlementSnapshot[]> {
    const s = await this.settlementRepository.getById(settlementId);
    return s ? [s] : [];
  }
}
