import {
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import { PRISMA_CLIENT } from "../../../shared/persistence/persistence.module.js";
import { SendTicketMessageUseCase } from "./send-ticket-message.use-case.js";
import { SupportGateway } from "../infrastructure/gateways/support.gateway.js";

export interface TransferTicketInput {
  ticketId: string;
  currentMerchantId: string;
  targetMerchantId: string;
}

export interface TransferTicketResult {
  ticketId: string;
  toMerchantId: string;
  toStoreName: string;
}

@Injectable()
export class TransferTicketUseCase {
  constructor(
    @Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient,
    private readonly sendMessage: SendTicketMessageUseCase,
    private readonly gateway: SupportGateway,
  ) {}

  async execute(input: TransferTicketInput): Promise<TransferTicketResult> {
    const ticket = await this.prisma.supportTicket.findFirst({
      where: { id: input.ticketId, merchantId: input.currentMerchantId },
    });
    if (!ticket) throw new NotFoundException("ticket_not_found");

    const connection = await this.prisma.marketplaceConnection.findFirst({
      where: {
        buyerMerchantId: input.currentMerchantId,
        sellerMerchantId: input.targetMerchantId,
        status: "active",
      },
    });
    if (!connection) throw new ForbiddenException("no_active_connection");

    const targetMerchant = await this.prisma.merchant.findUnique({
      where: { id: input.targetMerchantId },
      select: { name: true },
    });
    if (!targetMerchant) throw new NotFoundException("target_merchant_not_found");

    const storeName = targetMerchant.name;

    await this.prisma.supportTicket.updateMany({
      where: { id: input.ticketId, merchantId: input.currentMerchantId },
      data: {
        merchantId: input.targetMerchantId,
        originMerchantId: ticket.originMerchantId ?? input.currentMerchantId,
        transferredAt: new Date(),
      },
    });

    await this.sendMessage.execute({
      ticketId: input.ticketId,
      merchantId: input.targetMerchantId,
      senderType: "merchant",
      content: `Chamado transferido para ${storeName}`,
      metadata: {
        kind: "ticket_transferred",
        fromMerchantId: input.currentMerchantId,
        toMerchantId: input.targetMerchantId,
        toStoreName: storeName,
      },
    });

    this.gateway.emitTicketTransferred(
      input.currentMerchantId,
      input.targetMerchantId,
      {
        ticketId: input.ticketId,
        fromMerchantId: input.currentMerchantId,
        toMerchantId: input.targetMerchantId,
        toStoreName: storeName,
      },
    );

    return {
      ticketId: input.ticketId,
      toMerchantId: input.targetMerchantId,
      toStoreName: storeName,
    };
  }
}
