import { Injectable, Inject, BadRequestException, NotFoundException, Logger, Optional } from "@nestjs/common";
import { RETURN_REPOSITORY_PORT, ReturnRepositoryPort } from "../../domain/ports/return-repository.port.js";
import { ReturnEntity } from "../../domain/entities/return.entity.js";
import { RefundPaymentService } from "../../../payment/application/services/refund-payment.service.js";
import type { PrismaClient } from "@prisma/client";
import { PRISMA_CLIENT } from "../../../../shared/persistence/persistence.module.js";
import { ReturnOrderService } from "../return-order.service.js";
import { enqueueReturnNotice } from "../../../notifications/application/return-notice-persistence.js";
import { lockSupportResource, persistSupportMessage } from "../../../support/application/support-persistence.js";

@Injectable()
export class ProcessRefundUseCase {
  private readonly logger = new Logger(ProcessRefundUseCase.name);

  constructor(
    @Inject(RETURN_REPOSITORY_PORT) private readonly returnRepo: ReturnRepositoryPort,
    // Shared refund path — same service used by the marketplace return flow, so
    // the money-back-to-buyer logic is never duplicated per policy.
    @Optional() private readonly refundPayment?: RefundPaymentService,
    @Optional() @Inject(PRISMA_CLIENT) private readonly prisma?: PrismaClient,
    @Optional() private readonly orderService?: ReturnOrderService,
  ) {}

  async execute(merchantId: string, returnId: string, expectedAmountCents?: number): Promise<ReturnEntity> {
    const ret = await this.returnRepo.findById(merchantId, returnId);
    if (!ret) throw new NotFoundException("return_not_found");
    if ((this.prisma && !this.orderService) || (!this.prisma && this.orderService)) throw new Error("refund_validation_not_configured");
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
      });
      if (reconciliation.state === "succeeded") {
        await this.returnRepo.updateRefundStatus(returnId, "COMPLETED", new Date());
        await this.returnRepo.updateStatus(returnId, "REFUND_COMPLETED");
      } else if (reconciliation.state === "failed") {
        // Operators may request another reconciliation from the dashboard, but
        // a terminal result never turns into an automatic financial POST.
        await this.returnRepo.updateRefundStatus(returnId, "FAILED", new Date());
      }
      await this.syncCase(merchantId, returnId);
      return (await this.returnRepo.findById(merchantId, returnId))!;
    }
    if (!ret.canRefund && !(ret.status === "REQUESTED" && expectedAmountCents !== undefined)) {
      throw new BadRequestException("invalid_status_for_refund");
    }

    let amountCents: number | undefined;
    const started = this.prisma && this.orderService ? await this.prisma.$transaction(async tx => {
      await lockSupportResource(tx, `refund-order:${merchantId}:${ret.orderId}`);
      const ticket = await tx.supportTicket.findFirst({ where: { merchantId, returnId, mergedIntoId: null }, select: { id: true } });
      if (ticket) await lockSupportResource(tx, `support:${ticket.id}`);
      const latest = await tx.return.findFirst({ where: { id: returnId, merchantId }, include: { refund: true, items: true } });
      if (!latest || latest.refund) return false;
      if (!["INSPECTED_PASS", "REFUND_PROCESSING"].includes(latest.status) && !(latest.status === "REQUESTED" && expectedAmountCents !== undefined)) throw new BadRequestException("invalid_status_for_refund");
      const preview = await this.orderService!.preview(merchantId, returnId, tx);
      if (!preview.automatic) throw new BadRequestException("manual_refund_required");
      if (expectedAmountCents !== undefined && expectedAmountCents !== preview.amountCents) throw new BadRequestException("refund_preview_changed");
      amountCents = preview.amountCents;
      await tx.returnRefund.create({ data: { returnId, paymentIntentId: preview.paymentIntentId, amountInCents: amountCents, status: "PENDING" } });
      await tx.return.update({ where: { id: returnId }, data: { status: "REFUND_PROCESSING" } });
      if (ticket) {
        const explanation = latest.status === "REQUESTED"
          ? "A loja aprovou sua solicitação e dispensou o envio físico dos itens selecionados. O reembolso será solicitado ao meio de pagamento original; a confirmação será informada nesta conversa."
          : "A loja aprovou o reembolso dos itens selecionados. O pedido será enviado ao meio de pagamento original; a confirmação será informada nesta conversa.";
        const message = await persistSupportMessage(tx, { merchantId, ticketId: ticket.id, senderType: "system",
          clientMessageId: `refund_approval_${returnId}`, content: explanation,
          metadata: { kind: "case_update", event: "refund_approved", returnId } });
        await enqueueReturnNotice(tx, { merchantId, ticketId: ticket.id, messageId: message.id, type: "return_approved", explanation, ret: latest });
      }
      return true;
    }) : await this.returnRepo.beginRefund({
      returnId,
      amountInCents: 0,
      status: "PENDING",
    });
    if (!started) {
      this.logger.warn(`Refund already in progress for return ${returnId}`);
      return (await this.returnRepo.findById(merchantId, returnId))!;
    }

    try {
      await this.returnRepo.updateStatus(returnId, "REFUND_PROCESSING");
      // The persisted reservation fixes the validated amount before contacting the PSP.
      const result = await this.refundPayment?.refundOrderPayment({
        merchantId,
        externalOrderId: ret.orderId,
        amountCents,
        returnedItems: ret.items.map((it) => ({ variantId: it.variantId, quantity: it.quantity })),
        reason: `return:${returnId}`,
        idempotencyKey: `return:${returnId}`,
      });

      const amountInCents = result?.amountCents || amountCents || 0;
      const status = result?.refunded
        ? "COMPLETED"
        : result?.reason === "provider_refund_failed"
          ? "FAILED"
          : "PENDING";

      await this.returnRepo.saveRefund({
        returnId,
        paymentIntentId: result?.paymentIntentId,
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
            : `Reembolso de ${value} solicitado. Estamos aguardando a confirmação do provedor de pagamento.`,
        metadata: { kind: "case_update", event: completed ? "refund_completed" : "refund_pending", returnId } });
      if (completed) await enqueueReturnNotice(tx, { merchantId, ticketId: ticket.id, messageId: message.id, type: "return_refunded", explanation: message.content, ret });
      if (completed) await tx.supportTicket.update({ where: { id: ticket.id }, data: { status: "resolved", resolvedAt: new Date() } });
    });
  }
}
