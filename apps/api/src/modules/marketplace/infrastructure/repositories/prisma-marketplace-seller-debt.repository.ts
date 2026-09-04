import { Injectable } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";
import type {
  MarketplaceSellerDebtRepository,
  MarketplaceSellerDebtSnapshot,
  CreateSellerDebtInput,
  DeductDebtInput,
  SellerDebtStatus,
} from "../../domain/ports/marketplace-seller-debt-repository.port.js";

@Injectable()
export class PrismaMarketplaceSellerDebtRepository
  implements MarketplaceSellerDebtRepository
{
  constructor(private readonly prisma: PrismaClient) {}

  async create(
    input: CreateSellerDebtInput,
  ): Promise<MarketplaceSellerDebtSnapshot> {
    const debt = await this.prisma.marketplaceSellerDebt.create({
      data: {
        sellerMerchantId: input.sellerMerchantId,
        settlementId: input.settlementId,
        amountCents: input.amountCents,
        status: "outstanding",
      },
    });
    return this.toSnapshot(debt);
  }

  async getById(
    debtId: string,
  ): Promise<MarketplaceSellerDebtSnapshot | undefined> {
    const debt = await this.prisma.marketplaceSellerDebt.findUnique({
      where: { id: debtId },
    });
    if (!debt) return undefined;
    return this.toSnapshot(debt);
  }

  async findBySellerMerchantId(
    sellerMerchantId: string,
    status?: SellerDebtStatus,
  ): Promise<MarketplaceSellerDebtSnapshot[]> {
    const debts = await this.prisma.marketplaceSellerDebt.findMany({
      where: {
        sellerMerchantId,
        ...(status && { status }),
      },
      orderBy: { createdAt: "desc" },
    });
    return debts.map((d: any) => this.toSnapshot(d));
  }

  async findOutstandingBySellerMerchantId(
    sellerMerchantId: string,
  ): Promise<MarketplaceSellerDebtSnapshot[]> {
    return this.findBySellerMerchantId(sellerMerchantId, "outstanding");
  }

  async deductDebt(input: DeductDebtInput): Promise<MarketplaceSellerDebtSnapshot> {
    const debt = await this.prisma.marketplaceSellerDebt.update({
      where: { id: input.debtId },
      data: {
        status: "deducted",
        deductedFromSettlementId: input.deductedFromSettlementId,
      },
    });
    return this.toSnapshot(debt);
  }

  async resolveDebt(debtId: string): Promise<MarketplaceSellerDebtSnapshot> {
    const debt = await this.prisma.marketplaceSellerDebt.update({
      where: { id: debtId },
      data: {
        status: "resolved",
        resolvedAt: new Date(),
      },
    });
    return this.toSnapshot(debt);
  }

  private toSnapshot(debt: any): MarketplaceSellerDebtSnapshot {
    return {
      id: debt.id,
      sellerMerchantId: debt.sellerMerchantId,
      settlementId: debt.settlementId,
      amountCents: debt.amountCents,
      status: debt.status as SellerDebtStatus,
      deductedFromSettlementId: debt.deductedFromSettlementId,
      createdAt: debt.createdAt,
      resolvedAt: debt.resolvedAt,
    };
  }
}
