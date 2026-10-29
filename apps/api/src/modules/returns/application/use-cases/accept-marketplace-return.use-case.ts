import { ConflictException, Inject, Injectable, Logger, NotFoundException, Optional } from "@nestjs/common";
import { RETURN_REPOSITORY_PORT } from "../../domain/ports/return-repository.port.js";
import type { ReturnRepositoryPort } from "../../domain/ports/return-repository.port.js";
import { RegisterMarketplaceReturnUseCase } from "../../../marketplace/application/use-cases/register-marketplace-return.use-case.js";
import { MarketplaceReturnWorkflowService } from "../marketplace-return-workflow.service.js";
import type { MarketplaceRefundComponents } from "../../../marketplace/domain/services/marketplace-refund-allocation.js";
import { ProcessRefundUseCase } from "./process-refund.use-case.js";
import type { ReturnRefundProps } from "../../domain/entities/return.entity.js";

export interface AcceptMarketplaceReturnInput {
  merchantId: string;
  returnId: string;
  components?: MarketplaceRefundComponents;
}

export interface AcceptMarketplaceReturnOutput {
  returnId: string;
  status: string;
  marketplaceSettlementsCancelled: number;
  marketplaceSkipped: number;
  marketplaceRefundPlanId?: string;
  marketplaceRefundStatus?: string;
  marketplaceRefundAmountCents?: number;
  refund?: ReturnRefundProps;
}

/** Marketplace acceptance prepares an immutable allocation after inspection.
 * Its journal holds payouts and owns the later processing/completion states.
 * Ordinary returns continue through the existing acceptance workflow. */
@Injectable()
export class AcceptMarketplaceReturnUseCase {
  private readonly logger = new Logger(AcceptMarketplaceReturnUseCase.name);

  constructor(
    @Inject(RETURN_REPOSITORY_PORT) private readonly returnRepo: ReturnRepositoryPort,
    @Optional() private readonly registerMarketplaceReturn?: RegisterMarketplaceReturnUseCase,
    @Inject(MarketplaceReturnWorkflowService) private readonly marketplace?: MarketplaceReturnWorkflowService,
    @Optional() @Inject(ProcessRefundUseCase) private readonly refund?: ProcessRefundUseCase,
  ) {}

  async execute(
    input: AcceptMarketplaceReturnInput,
  ): Promise<AcceptMarketplaceReturnOutput> {
    const ret = await this.returnRepo.findById(input.merchantId, input.returnId);
    if (!ret) throw new NotFoundException("return_not_found");
    // Preparing a journal holds payouts atomically, but money has not been sent.
    // Keep INSPECTED_PASS until the journal's one-time claim moves it forward.
    const planned = await this.marketplace?.prepare(input.merchantId, input.returnId, input.components);
    if (planned) return planned;
    if (!["REQUESTED", "RECEIVED", "INSPECTED_PASS", "REFUND_PROCESSING"].includes(ret.status)) {
      throw new ConflictException("return_cannot_be_accepted_in_current_status");
    }
    if (!this.refund) throw new ConflictException("return_refund_service_unavailable");
    // Approval is a financial action: prove the original payment before changing
    // status, then use the same durable refund path as inspected returns.
    if (!ret.refund) await this.refund.preview(input.merchantId, input.returnId);

    let cancelled = 0;
    let skipped = 0;

    if (this.registerMarketplaceReturn && ret.orderId) {
      try {
        const variantIds = ret.items.map((it) => it.variantId);
        const result = await this.registerMarketplaceReturn.execute({
          merchantId: input.merchantId,
          orderId: ret.orderId,
          variantIds,
          items: ret.items.map(item => ({ variantId: item.variantId, quantity: item.quantity })),
          requestedAt: ret.createdAt,
        });
        cancelled = result.updated.length;
        skipped = result.skipped.length;
        if (skipped) throw new ConflictException("marketplace_return_cancellation_incomplete");
        this.logger.log(
          `Marketplace return applied for return ${ret.id} (order ${ret.orderId}): ${cancelled} settlement(s) cancelled, ${skipped} skipped`,
        );
      } catch (err) {
        // Own-store-only returns have no cross-store settlement and throw
        // "no_marketplace_settlement_for_return" — that is expected, not an error.
        const msg = err instanceof Error ? err.message : String(err);
        if (msg !== "no_marketplace_settlement_for_return") {
          this.logger.warn(`marketplace_return_side_effect_failed: ${msg}`);
          throw err;
        }
      }
    }

    // Do not acknowledge approval while its financial cancellation failed.
    // Cancellation is idempotent, so a failed return write can be retried safely.
    await this.returnRepo.updateStatus(ret.id, "REFUND_PROCESSING", ret.status);
    const refunded = await this.refund.execute(input.merchantId, input.returnId);

    return {
      returnId: ret.id,
      status: refunded.status,
      refund: refunded.refund,
      marketplaceSettlementsCancelled: cancelled,
      marketplaceSkipped: skipped,
    };
  }
}
