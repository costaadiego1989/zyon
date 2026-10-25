import { Injectable } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";

export interface ListPartnerStoresInput {
  merchantId: string;
  q?: string;
}

export interface PartnerStore {
  merchantId: string;
  storeName: string;
}

@Injectable()
export class ListPartnerStoresUseCase {
  constructor(private readonly prisma: PrismaClient) {}

  async execute(input: ListPartnerStoresInput): Promise<PartnerStore[]> {
    const connections = await this.prisma.marketplaceConnection.findMany({
      where: {
        buyerMerchantId: input.merchantId,
        status: "active",
      },
      select: { sellerMerchantId: true },
    });

    const sellerMerchantIds = connections.map(
      (connection) => connection.sellerMerchantId,
    );

    if (sellerMerchantIds.length === 0) {
      return [];
    }

    const query = input.q?.trim();

    const merchants = await this.prisma.merchant.findMany({
      where: {
        id: { in: sellerMerchantIds },
        ...(query
          ? { name: { contains: query, mode: "insensitive" } }
          : {}),
      },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    });

    return merchants.map((merchant) => ({
      merchantId: merchant.id,
      storeName: merchant.name,
    }));
  }
}
