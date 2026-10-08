import { Injectable, Inject, BadRequestException, ConflictException, NotFoundException, Logger, Optional } from "@nestjs/common";
import { RETURN_REPOSITORY_PORT, ReturnRepositoryPort } from "../../domain/ports/return-repository.port.js";
import { ReturnEntity } from "../../domain/entities/return.entity.js";
import { RefundPaymentService } from "../../../payment/application/services/refund-payment.service.js";
import { MarketplaceReturnWorkflowService } from "../marketplace-return-workflow.service.js";
import { ReturnShippingService } from "../return-shipping.service.js";

@Injectable()
export class ProcessRefundUseCase {
  private readonly logger = new Logger(ProcessRefundUseCase.name);

  constructor(
    @Inject(RETURN_REPOSITORY_PORT) private readonly returnRepo: ReturnRepositoryPort,
    // Shared refund path — same service used by the marketplace return flow, so
    // the money-back-to-buyer logic is never duplicated per policy.
    @Optional() private readonly refundPayment?: RefundPaymentService,
    @Inject(MarketplaceReturnWorkflowService) private readonly marketplace?: MarketplaceReturnWorkflowService,
    @Optional() @Inject(ReturnShippingService) private readonly shipping?: ReturnShippingService,
  ) {}

  async preview(merchantId: string, returnId: string) {
    const ret = await this.returnRepo.findById(merchantId, returnId);
    if (!ret) throw new NotFoundException("return_not_found");
    await this.marketplace?.assertOrdinary(merchantId, returnId);
    if (!["REQUESTED", "RECEIVED", "INSPECTED_PASS", "REFUND_PROCESSING"].includes(ret.status)) throw new BadRequestException("invalid_status_for_refund");
    if (!this.refundPayment) throw new ConflictException("return_refund_service_unavailable");
    if (ret.refund) return { amountCents: ret.refund.amountInCents, alreadySubmitted: true };
    const prepared = await this.refundPayment.prepareOrderRefund({ merchantId, externalOrderId: ret.orderId,
      returnedItems: ret.items.map(item => ({ variantId: item.variantId, quantity: item.quantity })),
      reason: `return:${returnId}`, idempotencyKey: `return:${returnId}` });
    if (!prepared.providerRequest || !prepared.paymentIntentId || prepared.amountCents <= 0) throw new ConflictException(prepared.reason ?? "return_refund_payment_unavailable");
    return { amountCents: prepared.amountCents, alreadySubmitted: false };
  }

  async execute(merchantId: string, returnId: string): Promise<ReturnEntity> {
    const ret = await this.returnRepo.findById(merchantId, returnId);
    if (!ret) throw new NotFoundException("return_not_found");
    // The marketplace dashboard/job owns journal execution and reconciliation.
    // Reject before creating a legacy PENDING marker or changing return status.
    await this.marketplace?.assertOrdinary(merchantId, returnId);
    // A persisted pending attempt means the PSP may already have accepted the
    // refund even if this process did not receive its response. Do not issue a
    // second financial POST; it must be reconciled from the provider outcome.
    if (ret.refund) {
      if (ret.refund.status !== "PENDING" && ret.refund.status !== "FAILED") return ret;
      if (!this.refundPayment) return ret;

      const reconciliation = await this.refundPayment.reconcileRefundPayment({
        merchantId,
        externalOrderId: ret.orderId,
        // A lost PSP response has no provider id, but Asaas can reconcile the
        // original request using the persisted return reference. The synthetic
        // value is never used to issue a new refund.
        providerRefundId: ret.refund.providerRefundId ?? `pending:return:${returnId}`,
        paymentIntentId: ret.refund.paymentIntentId,
        refundReference: `return:${returnId}`,
      });
      if (reconciliation.state === "succeeded") {
        await this.returnRepo.updateRefundStatus(returnId, "COMPLETED", new Date());
        await this.returnRepo.updateStatus(returnId, "REFUND_COMPLETED");
      } else if (reconciliation.state === "failed") {
        // Operators may request another reconciliation from the dashboard, but
        // a terminal result never turns into an automatic financial POST.
        await this.returnRepo.updateRefundStatus(returnId, "FAILED", new Date());
      }
      try { await this.shipping?.cancelOrdinary(merchantId, returnId); }
      catch { this.logger.warn(`return_shipping_cancellation_requires_review return=${returnId}`); }
      return (await this.returnRepo.findById(merchantId, returnId))!;
    }
    if (!ret.canRefund) {
      throw new BadRequestException("invalid_status_for_refund");
    }

    if (!this.refundPayment) throw new ConflictException("return_refund_service_unavailable");
    const prepared = await this.refundPayment.prepareOrderRefund({
      merchantId, externalOrderId: ret.orderId,
      returnedItems: ret.items.map(item => ({ variantId: item.variantId, quantity: item.quantity })),
      reason: `return:${returnId}`, idempotencyKey: `return:${returnId}`,
    });
    if (!prepared.providerRequest || !prepared.paymentIntentId || prepared.amountCents <= 0) {
      throw new ConflictException(prepared.reason ?? "return_refund_payment_unavailable");
    }
    await this.returnRepo.updateStatus(returnId, "REFUND_PROCESSING", ret.status);
    const started = await this.returnRepo.beginRefund({
      returnId,
      paymentIntentId: prepared.paymentIntentId,
      amountInCents: prepared.amountCents,
      status: "PENDING",
    });
    if (!started) {
      this.logger.warn(`Refund already in progress for return ${returnId}`);
      return (await this.returnRepo.findById(merchantId, returnId))!;
    }

    try {
      // The original payment and exact amount were saved before this one POST.
      const result = await this.refundPayment.refundPreparedPayment(prepared);

      const amountInCents = prepared.amountCents;
      const status = result?.refunded
        ? "COMPLETED"
        : result?.reason === "provider_refund_failed"
          ? "FAILED"
          : "PENDING";

      await this.returnRepo.saveRefund({
        returnId,
        paymentIntentId: prepared.paymentIntentId,
        providerRefundId: result?.providerRefundId,
        amountInCents,
        status,
      });
      if (result?.refunded) {
        await this.returnRepo.updateRefundStatus(returnId, "COMPLETED", new Date());
        await this.returnRepo.updateStatus(returnId, "REFUND_COMPLETED");
      } else if (status === "FAILED") {
        await this.returnRepo.updateRefundStatus(returnId, "FAILED", new Date());
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
    try { await this.shipping?.cancelOrdinary(merchantId, returnId, prepared.fullOrderReturn === true); }
    catch { this.logger.warn(`return_shipping_cancellation_requires_review return=${returnId}`); }

    return (await this.returnRepo.findById(merchantId, returnId))!;
  }
}
