import { Injectable } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import {
  LOYALTY_TRACKER_REPOSITORY,
  type LoyaltyTrackerRepositoryPort,
  type BuyerLoyaltyTracker,
  type UpsertLoyaltyTrackerInput,
  type FindInactiveBuyersInput,
} from "../../domain/ports/loyalty-tracker-repository.port.js";

@Injectable()
export class PrismaLoyaltyTrackerRepository implements LoyaltyTrackerRepositoryPort {
  constructor(private prisma: PrismaClient) {}

  async upsert(input: UpsertLoyaltyTrackerInput): Promise<BuyerLoyaltyTracker> {
    const tracker = await this.prisma.buyerLoyaltyTracker.upsert({
      where: {
        merchantId_buyerId: {
          merchantId: input.merchantId,
          buyerId: input.buyerId,
        },
      },
      update: {
        ...(input.purchaseCount !== undefined && { purchaseCount: input.purchaseCount }),
        ...(input.totalSpentCents !== undefined && { totalSpentCents: input.totalSpentCents }),
        ...(input.lastPurchaseAt !== undefined && { lastPurchaseAt: input.lastPurchaseAt }),
        ...(input.lastWinBackAt !== undefined && { lastWinBackAt: input.lastWinBackAt }),
      },
      create: {
        merchantId: input.merchantId,
        buyerId: input.buyerId,
        purchaseCount: input.purchaseCount ?? 0,
        totalSpentCents: input.totalSpentCents ?? 0,
        lastPurchaseAt: input.lastPurchaseAt || null,
        lastWinBackAt: input.lastWinBackAt || null,
      },
    });

    return this.mapToDomain(tracker);
  }

  async findByBuyer(merchantId: string, buyerId: string): Promise<BuyerLoyaltyTracker | null> {
    const tracker = await this.prisma.buyerLoyaltyTracker.findUnique({
      where: {
        merchantId_buyerId: {
          merchantId,
          buyerId,
        },
      },
    });

    return tracker ? this.mapToDomain(tracker) : null;
  }

  async incrementPurchase(
    merchantId: string,
    buyerId: string,
    amountCents: number
  ): Promise<BuyerLoyaltyTracker> {
    const tracker = await this.prisma.buyerLoyaltyTracker.upsert({
      where: {
        merchantId_buyerId: {
          merchantId,
          buyerId,
        },
      },
      update: {
        purchaseCount: {
          increment: 1,
        },
        totalSpentCents: {
          increment: amountCents,
        },
        lastPurchaseAt: new Date(),
      },
      create: {
        merchantId,
        buyerId,
        purchaseCount: 1,
        totalSpentCents: amountCents,
        lastPurchaseAt: new Date(),
      },
    });

    return this.mapToDomain(tracker);
  }

  async updateLastWinBack(merchantId: string, buyerId: string): Promise<BuyerLoyaltyTracker> {
    const tracker = await this.prisma.buyerLoyaltyTracker.upsert({
      where: {
        merchantId_buyerId: {
          merchantId,
          buyerId,
        },
      },
      update: {
        lastWinBackAt: new Date(),
      },
      create: {
        merchantId,
        buyerId,
        lastWinBackAt: new Date(),
      },
    });

    return this.mapToDomain(tracker);
  }

  async findInactive(input: FindInactiveBuyersInput): Promise<BuyerLoyaltyTracker[]> {
    const trackers = await this.prisma.buyerLoyaltyTracker.findMany({
      where: {
        lastPurchaseAt: { lt: input.inactiveBefore },
        OR: [
          { lastWinBackAt: null },
          { lastWinBackAt: { lt: input.winBackBefore } },
        ],
      },
      orderBy: { lastPurchaseAt: "asc" },
      take: input.limit,
    });

    return trackers.map((t) => this.mapToDomain(t));
  }

  private mapToDomain(raw: any): BuyerLoyaltyTracker {
    return {
      id: raw.id,
      merchantId: raw.merchantId,
      buyerId: raw.buyerId,
      purchaseCount: raw.purchaseCount,
      totalSpentCents: raw.totalSpentCents,
      lastPurchaseAt: raw.lastPurchaseAt,
      lastWinBackAt: raw.lastWinBackAt,
      createdAt: raw.createdAt,
      updatedAt: raw.updatedAt,
    };
  }
}
