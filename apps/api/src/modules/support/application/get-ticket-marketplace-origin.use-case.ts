import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import { PRISMA_CLIENT } from "../../../shared/persistence/persistence.module.js";

export interface GetTicketMarketplaceOriginInput {
  ticketId: string;
  merchantId: string;
}

export interface TicketMarketplaceOriginResult {
  isMarketplaceOrigin: boolean;
  sellerMerchantIds: string[];
}

@Injectable()
export class GetTicketMarketplaceOriginUseCase {
  constructor(
    @Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient,
  ) {}

  async execute(
    input: GetTicketMarketplaceOriginInput,
  ): Promise<TicketMarketplaceOriginResult> {
    const ticket = await this.prisma.supportTicket.findFirst({
      where: { id: input.ticketId, merchantId: input.merchantId },
      select: { returnId: true },
    });
    if (!ticket) throw new NotFoundException("ticket_not_found");

    if (!ticket.returnId) {
      return { isMarketplaceOrigin: false, sellerMerchantIds: [] };
    }

    const returnRecord = await this.prisma.return.findUnique({
      where: { id: ticket.returnId },
      select: { orderId: true },
    });
    if (!returnRecord) {
      return { isMarketplaceOrigin: false, sellerMerchantIds: [] };
    }

    const lineItems = await this.prisma.crossStoreLineItem.findMany({
      where: { orderId: returnRecord.orderId },
      select: { sellerMerchantId: true, hostMerchantId: true },
    });

    const sellerMerchantIds = Array.from(
      new Set(
        lineItems
          .filter((item) => item.sellerMerchantId !== item.hostMerchantId)
          .map((item) => item.sellerMerchantId),
      ),
    );

    return {
      isMarketplaceOrigin: sellerMerchantIds.length > 0,
      sellerMerchantIds,
    };
  }
}
