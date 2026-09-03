import { Injectable, Inject, BadRequestException, NotFoundException, Logger, Optional } from "@nestjs/common";
import { RETURN_REPOSITORY_PORT, ReturnRepositoryPort } from "../../domain/ports/return-repository.port.js";
import { ReturnEntity } from "../../domain/entities/return.entity.js";
import { RefundPaymentService } from "../../../payment/application/services/refund-payment.service.js";

@Injectable()
export class ProcessRefundUseCase {
  private readonly logger = new Logger(ProcessRefundUseCase.name);

  constructor(
    @Inject(RETURN_REPOSITORY_PORT) private readonly returnRepo: ReturnRepositoryPort,
    // Shared refund path — same service used by the marketplace return flow, so
    // the money-back-to-buyer logic is never duplicated per policy.
    @Optional() private readonly refundPayment?: RefundPaymentService,
  ) {}

  async execute(merchantId: string, returnId: string): Promise<ReturnEntity> {
    const ret = await this.returnRepo.findById(merchantId, returnId);
    if (!ret) throw new NotFoundException("return_not_found");
    if (!ret.canRefund) {
      throw new BadRequestException("invalid_status_for_refund");
    }

    await this.returnRepo.updateStatus(returnId, "REFUND_PROCESSING");

    try {
      // Real reversal at the PSP via the shared service. The service resolves the
      // order's captured payment and refunds it (Asaas/Stripe); the amount is
      // scoped to the returned items when a per-item amount is known, otherwise
      // the full captured amount. Passing no amountCents lets the service refund
      // the captured total (typical full-order return).
      const result = await this.refundPayment?.refundOrderPayment({
        merchantId,
        externalOrderId: ret.orderId,
        returnedItems: ret.items.map((it) => ({ variantId: it.variantId, quantity: it.quantity })),
        reason: `return:${returnId}`,
      });

      const amountInCents = result?.amountCents ?? 0;
      const status = result?.refunded ? "COMPLETED" : "PENDING";

      await this.returnRepo.saveRefund({ returnId, amountInCents, status });
      if (result?.refunded) {
        await this.returnRepo.updateRefundStatus(returnId, "COMPLETED", new Date());
        await this.returnRepo.updateStatus(returnId, "REFUND_COMPLETED");
      } else {
        // Provider refund not completed (no capability, not found, or async):
        // keep REFUND_PROCESSING so it can be retried / handled out-of-band.
        this.logger.warn(
          `Refund not completed for return ${returnId} (order ${ret.orderId}): ${result?.reason ?? "no_refund_service"}`,
        );
      }
    } catch (err) {
      this.logger.error(`Refund failed for return ${returnId}: ${(err as Error).message}`);
      throw err;
    }

    return (await this.returnRepo.findById(merchantId, returnId))!;
  }
}
