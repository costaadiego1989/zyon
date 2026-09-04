import { Injectable, Inject, BadRequestException, Logger } from "@nestjs/common";
import type { SupportMessageMetadata, SupportReturnReason } from "@zyon/shared-types";
import { RETURN_REPOSITORY_PORT, ReturnRepositoryPort, CreateReturnInput } from "../../domain/ports/return-repository.port.js";
import { ReturnEntity, type ReturnReason } from "../../domain/entities/return.entity.js";
import { CorrelationIdStorage } from "../../../../shared/logger/correlation-id.storage.js";
import { CreateSupportTicketUseCase } from "../../../support/application/create-support-ticket.use-case.js";
import { SendTicketMessageUseCase } from "../../../support/application/send-ticket-message.use-case.js";

const VALID_REASONS: ReturnReason[] = ["DEFECTIVE", "WRONG_ITEM", "NOT_AS_DESCRIBED", "CHANGED_MIND", "DAMAGED_IN_TRANSIT", "OTHER"];

const REASON_LABELS: Record<ReturnReason, string> = {
  DEFECTIVE: "Produto com defeito",
  WRONG_ITEM: "Item errado",
  NOT_AS_DESCRIBED: "Diferente do anunciado",
  CHANGED_MIND: "Desistência da compra",
  DAMAGED_IN_TRANSIT: "Danificado no transporte",
  OTHER: "Outro motivo",
};

@Injectable()
export class RequestReturnUseCase {
  private readonly logger = new Logger(RequestReturnUseCase.name);

  constructor(
    @Inject(RETURN_REPOSITORY_PORT) private readonly returnRepo: ReturnRepositoryPort,
    private readonly createTicket: CreateSupportTicketUseCase,
    private readonly sendTicketMessage: SendTicketMessageUseCase,
  ) {}

  async execute(input: {
    merchantId: string;
    orderId?: string;
    buyerId: string;
    reason: string;
    notes?: string;
    imageUrls?: string[];
    items: Array<{ variantId: string; quantity: number; reason?: string }>;
  }): Promise<ReturnEntity> {
    if (!VALID_REASONS.includes(input.reason as ReturnReason)) {
      throw new BadRequestException("invalid_return_reason");
    }
    if (!input.items?.length) {
      throw new BadRequestException("at_least_one_item_required");
    }
    for (const item of input.items) {
      if (item.quantity <= 0) throw new BadRequestException("quantity_must_be_positive");
    }

    const orderId = input.orderId?.trim() || `manual_${Date.now()}`;

    if (input.orderId?.trim()) {
      const existing = await this.returnRepo.findByOrderId(input.merchantId, orderId);
      const activeReturn = existing.find((r) => r.status !== "CANCELLED" && r.status !== "REJECTED");
      if (activeReturn) {
        throw new BadRequestException("active_return_already_exists_for_order");
      }
    }

    const created = await this.returnRepo.create({
      merchantId: input.merchantId,
      orderId,
      buyerId: input.buyerId,
      reason: input.reason,
      notes: input.notes,
      imageUrls: input.imageUrls,
      items: input.items,
    });

    await this.linkSupportTicket(created);

    return created;
  }

  private async linkSupportTicket(ret: ReturnEntity): Promise<void> {
    try {
      const reason = ret.reason as SupportReturnReason;
      const reasonLabel = REASON_LABELS[ret.reason] ?? "Solicitação de troca/devolução";
      const summary = `Solicitação de troca/devolução: ${reasonLabel}${ret.notes ? ` — ${ret.notes}` : ""}`;

      const ticket = await this.createTicket.execute({
        merchantId: ret.merchantId,
        message: summary,
        source: "return_request",
        returnId: ret.id,
      });

      const metadata: SupportMessageMetadata = {
        kind: "return_request",
        returnId: ret.id,
        reason,
        reasonLabel,
        items: ret.items.map((it) => ({
          name: it.variantId,
          variantId: it.variantId,
          quantity: it.quantity,
        })),
        imageUrls: ret.imageUrls ?? [],
        orderRef: ret.orderId,
      };

      await this.sendTicketMessage.execute({
        ticketId: ticket.id,
        merchantId: ret.merchantId,
        senderType: "buyer",
        content: summary,
        metadata,
      });
    } catch (err) {
      this.logger.warn(`failed_to_link_support_ticket return=${ret.id}: ${(err as Error).message}`);
    }
  }
}
