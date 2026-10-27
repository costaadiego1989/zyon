import { Injectable, Inject, BadRequestException, ConflictException, NotFoundException, Logger, Optional } from "@nestjs/common";
import { RETURN_REPOSITORY_PORT, ReturnRepositoryPort } from "../../domain/ports/return-repository.port.js";
import { ReturnEntity } from "../../domain/entities/return.entity.js";
import { RefundPaymentService } from "../../../payment/application/services/refund-payment.service.js";
import { MarketplaceReturnWorkflowService } from "../marketplace-return-workflow.service.js";
import type { PrismaClient } from "@prisma/client";
import { PRISMA_CLIENT } from "../../../../shared/persistence/persistence.module.js";
import { enqueueReturnNotice } from "../../../notifications/application/return-notice-persistence.js";
import { lockSupportResource, persistSupportMessage } from "../../../support/application/support-persistence.js";
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
    @Optional() @Inject(PRISMA_CLIENT) private readonly prisma?: PrismaClient,
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

  async execute(merchantId: string, returnId: string, expectedAmountCents?: number): Promise<ReturnEntity> {
    const ret = await this.returnRepo.findById(merchantId, returnId);
    if (!ret) throw new NotFoundException("return_not_found");
    // The marketplace dashboard/job owns journal execution and reconciliation.
    // Reject before creating a legacy PENDING marker or changing return status.
    await this.marketplace?.assertOrdinary(merchantId, returnId);
    // A persisted pending attempt means the PSP may already have accepted the
    // refund even if this process did not receive its response. Do not issue a
    // second financial POST; it must be reconciled from the provider outcome.
    if (ret.refund) {
      if (ret.refund.status !== "PENDING" && ret.refund.status !== "FAILED") { await this.syncCase(merchantId, returnId); return ret; }
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
        amountCents: ret.refund.amountInCents,
      });
      if (reconciliation.providerRefundId && reconciliation.providerRefundId !== ret.refund.providerRefundId) {
        await this.returnRepo.saveRefund({ returnId, paymentIntentId: ret.refund.paymentIntentId,
          providerRefundId: reconciliation.providerRefundId, amountInCents: ret.refund.amountInCents, status: ret.refund.status });
      }
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
      await this.syncCase(merchantId, returnId);
      return (await this.returnRepo.findById(merchantId, returnId))!;
    }
    if (!ret.canRefund && !(ret.status === "REQUESTED" && expectedAmountCents !== undefined)) {
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
    if (expectedAmountCents !== undefined && (!Number.isSafeInteger(expectedAmountCents) || expectedAmountCents !== prepared.amountCents)) throw new ConflictException("refund_preview_changed");
    await this.returnRepo.updateStatus(returnId, "REFUND_PROCESSING", ret.status);
    const started = await this.returnRepo.beginRefund({
      returnId,
      paymentIntentId: prepared.paymentIntentId,
      amountInCents: prepared.amountCents,
      status: "PENDING",
    });
    if (!started) {
      this.logger.warn(`Refund already in progress for return ${returnId}`);
      await this.syncCase(merchantId, returnId);
      return (await this.returnRepo.findById(merchantId, returnId))!;
    }

    await this.syncCase(merchantId, returnId);
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
      await this.syncCase(merchantId, returnId);
      throw err;
    }
    try { await this.shipping?.cancelOrdinary(merchantId, returnId, prepared.fullOrderReturn === true); }
    catch { this.logger.warn(`return_shipping_cancellation_requires_review return=${returnId}`); }

    await this.syncCase(merchantId, returnId);
    return (await this.returnRepo.findById(merchantId, returnId))!;
  }

  /** Separate human action; normal reconciliation never repeats a financial POST. */
  async recover(merchantId: string, returnId: string, expectedAmountCents: number): Promise<ReturnEntity> {
    const ret = await this.returnRepo.findById(merchantId, returnId);
    if (!ret) throw new NotFoundException("return_not_found");
    await this.marketplace?.assertOrdinary(merchantId, returnId);
    if (!this.prisma || !this.refundPayment) throw new ConflictException("return_refund_service_unavailable");
    if (ret.status !== "REFUND_PROCESSING" || ret.refund?.status !== "PENDING" || ret.refund.providerRefundId || !ret.refund.paymentIntentId) {
      throw new ConflictException("refund_recovery_requires_unconfirmed_attempt");
    }
    if (!Number.isSafeInteger(expectedAmountCents) || expectedAmountCents !== ret.refund.amountInCents) throw new ConflictException("refund_preview_changed");
    // Stripe retains keys for at least 24 hours. Leave one hour for transit;
    // never infer that an empty refund list alone makes a replacement safe.
    const age = Date.now() - ret.refund.createdAt.getTime();
    if (!Number.isFinite(age) || age < 60000 || age >= 23 * 3600000) throw new ConflictException("refund_recovery_window_unavailable");
    const prepared = await this.refundPayment.prepareOrderRefund({ merchantId, externalOrderId: ret.orderId,
      amountCents: ret.refund.amountInCents, reason: `return:${returnId}`, idempotencyKey: `return:${returnId}` });
    if (!prepared.providerRequest || prepared.paymentIntentId !== ret.refund.paymentIntentId || prepared.amountCents !== expectedAmountCents ||
        !await this.refundPayment.canRecoverPreparedRefund(prepared)) throw new ConflictException("refund_recovery_original_payment_unproven");
    const claimed = await this.prisma.$transaction(async tx => {
      await lockSupportResource(tx, `refund-recovery:${returnId}`);
      const row = await tx.return.findFirst({ where: { id: returnId, merchantId }, include: { refund: true } });
      const refund = row?.refund;
      if (!row || row.status !== "REFUND_PROCESSING" || refund?.status !== "PENDING" || refund.providerRefundId ||
          refund.paymentIntentId !== ret.refund!.paymentIntentId || refund.amountInCents !== expectedAmountCents ||
          Date.now() - refund.createdAt.getTime() >= 23 * 3600000) throw new ConflictException("refund_recovery_requires_unconfirmed_attempt");
      const resolution = row.resolution as Record<string, any> | null;
      if (resolution?.refundRecovery) return false;
      await tx.return.update({ where: { id: returnId }, data: { resolution: { ...resolution,
        refundRecovery: { claimedAt: new Date().toISOString(), idempotencyKey: `return:${returnId}` } } } });
      return true;
    });
    if (!claimed) return this.execute(merchantId, returnId);
    const result = await this.refundPayment.refundPreparedPayment(prepared);
    await this.returnRepo.saveRefund({ returnId, paymentIntentId: ret.refund.paymentIntentId, providerRefundId: result.providerRefundId,
      amountInCents: expectedAmountCents, status: result.refunded ? "COMPLETED" : result.reason === "provider_refund_failed" ? "FAILED" : "PENDING" });
    if (result.refunded) {
      await this.returnRepo.updateRefundStatus(returnId, "COMPLETED", new Date());
      await this.returnRepo.updateStatus(returnId, "REFUND_COMPLETED");
    }
    try { await this.shipping?.cancelOrdinary(merchantId, returnId); }
    catch { this.logger.warn(`return_shipping_cancellation_requires_review return=${returnId}`); }
    await this.syncCase(merchantId, returnId);
    return (await this.returnRepo.findById(merchantId, returnId))!;
  }

  private async syncCase(merchantId: string, returnId: string) {
    if (!this.prisma) return;
    await this.prisma.$transaction(async tx => {
      const ticket = await tx.supportTicket.findFirst({ where: { merchantId, returnId, mergedIntoId: null } });
      if (!ticket) return;
      await lockSupportResource(tx, `support:${ticket.id}`);
      const ret = await tx.return.findFirst({ where: { id: returnId, merchantId }, include: { refund: true, items: true } });
      if (!ret?.refund) return;
      const clientMessageId = `refund_${returnId}_${ret.refund.status}`;
      const existing = await tx.supportTicketMessage.findFirst({ where: { ticketId: ticket.id, senderType: "system", clientMessageId } });
      if (existing) return;
      const completed = ret.status === "REFUND_COMPLETED" && ret.refund.status === "COMPLETED";
      const value = new Intl.NumberFormat("pt-BR", { style: "currency", currency: (ret.orderSnapshot as any)?.currency ?? "BRL" }).format(ret.refund.amountInCents / 100);
      const message = await persistSupportMessage(tx, { merchantId, ticketId: ticket.id, senderType: "system", clientMessageId,
        content: completed ? `Reembolso de ${value} confirmado pelo provedor de pagamento. A solicitação foi concluída; o prazo para aparecer na sua conta depende do meio de pagamento.`
          : ret.refund.status === "FAILED" ? "O reembolso apresentou uma falha. A loja acompanhará o pagamento e informará a próxima etapa nesta conversa."
            : `A loja aprovou o reembolso de ${value}. A confirmação do provedor de pagamento será acompanhada nesta conversa.`,
        metadata: { kind: "case_update", event: completed ? "refund_completed" : "refund_pending", returnId } });
      if (completed) await enqueueReturnNotice(tx, { merchantId, ticketId: ticket.id, messageId: message.id, type: "return_refunded", explanation: message.content, ret });
      else if (ret.refund.status === "PENDING") await enqueueReturnNotice(tx, { merchantId, ticketId: ticket.id, messageId: message.id, type: "return_approved", explanation: message.content, ret });
      if (completed) await tx.supportTicket.update({ where: { id: ticket.id }, data: { status: "resolved", resolvedAt: new Date() } });
    });
  }
}

