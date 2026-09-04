import { Inject, Injectable, Logger, NotFoundException, Optional } from "@nestjs/common";
import { RETURN_REPOSITORY_PORT } from "../../domain/ports/return-repository.port.js";
import type { ReturnRepositoryPort } from "../../domain/ports/return-repository.port.js";
import { RegisterMarketplaceReturnUseCase } from "../../../marketplace/application/use-cases/register-marketplace-return.use-case.js";

export interface AcceptMarketplaceReturnInput {
  merchantId: string;
  returnId: string;
}

export interface AcceptMarketplaceReturnOutput {
  returnId: string;
  status: string;
  marketplaceSettlementsCancelled: number;
  marketplaceSkipped: number;
}

/**
 * Accepts a buyer return and, when the returned items are cross-store, cancels
 * the corresponding marketplace settlement(s) so the seller repasse is not paid.
 *
 * This is the seller/host approval step in the support flow: the buyer opens a
 * return from the order's support panel, the host handles it and routes the
 * ticket to the product owner (seller), and the seller accepting the return
 * lands here. The Return moves to REFUND_PROCESSING (money going back to the
 * buyer) and, for the cross-store items, RegisterMarketplaceReturn transitions
 * their settlements awaiting_return_window → return_cancelled. Own-store items
 * carry no marketplace settlement and are simply not matched — mixed orders are
 * handled item-by-item via the return's variant ids.
 *
 * RegisterMarketplaceReturn is optional (marketplace module may be absent); when
 * missing, the return is still accepted, just with no settlement side effect.
 */
@Injectable()
export class AcceptMarketplaceReturnUseCase {
  private readonly logger = new Logger(AcceptMarketplaceReturnUseCase.name);

  constructor(
    @Inject(RETURN_REPOSITORY_PORT) private readonly returnRepo: ReturnRepositoryPort,
    @Optional() private readonly registerMarketplaceReturn?: RegisterMarketplaceReturnUseCase,
  ) {}

  async execute(
    input: AcceptMarketplaceReturnInput,
  ): Promise<AcceptMarketplaceReturnOutput> {
    const ret = await this.returnRepo.findById(input.merchantId, input.returnId);
    if (!ret) throw new NotFoundException("return_not_found");

    // Accept the return: money is going back to the buyer.
    await this.returnRepo.updateStatus(ret.id, "REFUND_PROCESSING");

    let cancelled = 0;
    let skipped = 0;

    if (this.registerMarketplaceReturn && ret.orderId) {
      try {
        const variantIds = ret.items.map((it) => it.variantId);
        const result = await this.registerMarketplaceReturn.execute({
          orderId: ret.orderId,
          variantIds,
        });
        cancelled = result.updated.length;
        skipped = result.skipped.length;
        this.logger.log(
          `Marketplace return applied for return ${ret.id} (order ${ret.orderId}): ${cancelled} settlement(s) cancelled, ${skipped} skipped`,
        );
      } catch (err) {
        // Own-store-only returns have no cross-store settlement and throw
        // "no_marketplace_settlement_for_return" — that is expected, not an error.
        const msg = err instanceof Error ? err.message : String(err);
        if (msg !== "no_marketplace_settlement_for_return") {
          this.logger.warn(`marketplace_return_side_effect_failed: ${msg}`);
        }
      }
    }

    return {
      returnId: ret.id,
      status: "REFUND_PROCESSING",
      marketplaceSettlementsCancelled: cancelled,
      marketplaceSkipped: skipped,
    };
  }
}
