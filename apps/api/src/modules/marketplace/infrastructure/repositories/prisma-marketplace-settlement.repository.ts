import { Injectable } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";
import type {
  MarketplaceSettlementRepository,
  MarketplaceSettlementSnapshot,
  CreateMarketplaceSettlementInput,
  UpdateSettlementStatusInput,
  SettlementStatus,
} from "../../domain/ports/marketplace-settlement-repository.port.js";

@Injectable()
export class PrismaMarketplaceSettlementRepository
  implements MarketplaceSettlementRepository
{
  constructor(private readonly prisma: PrismaClient) {}

  async create(
    input: CreateMarketplaceSettlementInput,
  ): Promise<MarketplaceSettlementSnapshot> {
    const settlement = await this.prisma.marketplaceSettlement.create({
      data: {
        hostMerchantId: input.hostMerchantId,
        sellerMerchantId: input.sellerMerchantId,
        orderId: input.orderId,
        lineItemId: input.lineItemId,
        totalAmountCents: input.totalAmountCents,
        commissionCents: input.commissionCents,
        sellerNetCents: input.sellerNetCents,
        returnWindowUntil: input.returnWindowUntil,
        chargebackWindowUntil: input.chargebackWindowUntil,
      },
    });
    return this.toSnapshot(settlement);
  }

  async getById(
    settlementId: string,
  ): Promise<MarketplaceSettlementSnapshot | undefined> {
    const settlement = await this.prisma.marketplaceSettlement.findUnique({
      where: { id: settlementId },
    });
    if (!settlement) return undefined;
    return this.toSnapshot(settlement);
  }

  async findByLineItemId(
    lineItemId: string,
  ): Promise<MarketplaceSettlementSnapshot | undefined> {
    const settlement = await this.prisma.marketplaceSettlement.findFirst({
      where: { lineItemId },
    });
    if (!settlement) return undefined;
    return this.toSnapshot(settlement);
  }

  async findBySellerMerchantId(
    sellerMerchantId: string,
    status?: SettlementStatus,
  ): Promise<MarketplaceSettlementSnapshot[]> {
    const settlements = await this.prisma.marketplaceSettlement.findMany({
      where: {
        sellerMerchantId,
        ...(status && { status }),
      },
      orderBy: { createdAt: "desc" },
    });
    return settlements.map((s: any) => this.toSnapshot(s));
  }

  async findExpiredReturnWindows(
    nowDate: Date,
  ): Promise<MarketplaceSettlementSnapshot[]> {
    const settlements = await this.prisma.marketplaceSettlement.findMany({
      where: {
        status: "awaiting_return_window",
        returnWindowUntil: { lte: nowDate },
      },
    });
    return settlements.map((s: any) => this.toSnapshot(s));
  }

  async findDueTransfers(
    nowDate: Date,
  ): Promise<MarketplaceSettlementSnapshot[]> {
    const settlements = await this.prisma.marketplaceSettlement.findMany({
      where: {
        status: "transfer_scheduled",
        transferScheduledAt: { lte: nowDate },
      },
    });
    return settlements.map((s: any) => this.toSnapshot(s));
  }

  async findExpiredChargebackWindows(
    nowDate: Date,
  ): Promise<MarketplaceSettlementSnapshot[]> {
    const settlements = await this.prisma.marketplaceSettlement.findMany({
      where: {
        status: "transferred",
        chargebackWindowUntil: { lte: nowDate },
      },
    });
    return settlements.map((s: any) => this.toSnapshot(s));
  }

  async updateStatus(
    input: UpdateSettlementStatusInput,
  ): Promise<MarketplaceSettlementSnapshot> {
    const settlement = await this.prisma.marketplaceSettlement.update({
      where: { id: input.settlementId },
      data: {
        status: input.status,
        ...(input.transferScheduledAt !== undefined && {
          transferScheduledAt: input.transferScheduledAt,
        }),
        ...(input.transferredAt !== undefined && {
          transferredAt: input.transferredAt,
        }),
        ...(input.finalizedAt !== undefined && {
          finalizedAt: input.finalizedAt,
        }),
        ...(input.chargebackAt !== undefined && {
          chargebackAt: input.chargebackAt,
        }),
        ...(input.returnAt !== undefined && {
          returnAt: input.returnAt,
        }),
        ...(input.providerTransferId !== undefined && {
          providerTransferId: input.providerTransferId,
        }),
      },
    });
    return this.toSnapshot(settlement);
  }

  private toSnapshot(settlement: any): MarketplaceSettlementSnapshot {
    return {
      id: settlement.id,
      hostMerchantId: settlement.hostMerchantId,
      sellerMerchantId: settlement.sellerMerchantId,
      orderId: settlement.orderId,
      lineItemId: settlement.lineItemId,
      totalAmountCents: settlement.totalAmountCents,
      commissionCents: settlement.commissionCents,
      sellerNetCents: settlement.sellerNetCents,
      status: settlement.status as SettlementStatus,
      returnWindowUntil: settlement.returnWindowUntil,
      transferScheduledAt: settlement.transferScheduledAt,
      chargebackWindowUntil: settlement.chargebackWindowUntil,
      transferredAt: settlement.transferredAt,
      finalizedAt: settlement.finalizedAt,
      chargebackAt: settlement.chargebackAt,
      returnAt: settlement.returnAt,
      providerTransferId: settlement.providerTransferId,
      createdAt: settlement.createdAt,
      updatedAt: settlement.updatedAt,
    };
  }
}
