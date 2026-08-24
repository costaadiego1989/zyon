import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Query,
  UseGuards,
  Req,
} from "@nestjs/common";
import { AuthGuard, currentUser } from "../../../auth/presentation/auth.guard.js";
import { PrismaClient } from "@prisma/client";

interface AuthenticatedRequest {
  user: {
    userId: string;
    merchantId: string;
    email: string;
    role: "owner" | "admin";
  };
}

interface AvailableStore {
  id: string;
  name: string;
  category: string;
  commissionPercent: number;
  logoUrl: string | null;
  connected: boolean;
}

interface ListAvailableStoresResponse {
  stores: AvailableStore[];
  nextCursor: string | null;
}

@UseGuards(AuthGuard)
@Controller("marketplace/stores")
export class MarketplaceDiscoveryController {
  constructor(
    private readonly prisma: PrismaClient
  ) {}

  @Get()
  async listAvailableStores(
    @Req() request: AuthenticatedRequest,
    @Query("category") category?: string,
    @Query("search") search?: string,
    @Query("limit") limitStr?: string,
    @Query("cursor") cursor?: string
  ): Promise<ListAvailableStoresResponse> {
    const user = currentUser(request);
    const merchantId = user.merchantId;

    const limit = Math.min(Number(limitStr) || 20, 50);

    const where: any = {
      id: { not: merchantId },
      marketplaceConfig: { isNot: null },
    };

    if (category) {
      where.storeCategory = category;
    }

    if (search) {
      where.name = { contains: search, mode: "insensitive" };
    }

    const merchants = await this.prisma.merchant.findMany({
      where,
      take: limit + 1,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      select: {
        id: true,
        name: true,
        storeCategory: true,
        theme: true,
        marketplaceConfig: {
          select: { commissionRateBps: true },
        },
      },
      orderBy: { name: "asc" },
    });

    const hasMore = merchants.length > limit;
    const stores = merchants.slice(0, limit);

    const connections = await this.prisma.marketplaceConnection.findMany({
      where: {
        buyerMerchantId: merchantId,
        sellerMerchantId: { in: stores.map((m) => m.id) },
      },
      select: { sellerMerchantId: true, status: true },
    });

    const connMap = new Map(connections.map((c) => [c.sellerMerchantId, c.status]));

    return {
      stores: stores.map((m) => ({
        id: m.id,
        name: m.name,
        category: m.storeCategory ?? "Geral",
        commissionPercent:
          (m.marketplaceConfig?.commissionRateBps ?? 1500) / 100,
        logoUrl: (m.theme as any)?.logoUrl ?? null,
        connected: connMap.get(m.id) === "active",
      })),
      nextCursor: hasMore ? stores[stores.length - 1].id : null,
    };
  }

  @Post(":sellerId/connect")
  async connect(
    @Req() request: AuthenticatedRequest,
    @Param("sellerId") sellerId: string
  ): Promise<{ connected: boolean }> {
    const user = currentUser(request);
    const merchantId = user.merchantId;

    await this.prisma.marketplaceConnection.upsert({
      where: {
        buyerMerchantId_sellerMerchantId: {
          buyerMerchantId: merchantId,
          sellerMerchantId: sellerId,
        },
      },
      create: {
        buyerMerchantId: merchantId,
        sellerMerchantId: sellerId,
        status: "active",
      },
      update: { status: "active" },
    });

    return { connected: true };
  }

  @Delete(":sellerId/connect")
  async disconnect(
    @Req() request: AuthenticatedRequest,
    @Param("sellerId") sellerId: string
  ): Promise<{ connected: boolean }> {
    const user = currentUser(request);
    const merchantId = user.merchantId;

    await this.prisma.marketplaceConnection.updateMany({
      where: {
        buyerMerchantId: merchantId,
        sellerMerchantId: sellerId,
      },
      data: { status: "inactive" },
    });

    return { connected: false };
  }

  @Get("my-connections")
  async myConnections(
    @Req() request: AuthenticatedRequest
  ): Promise<{ connections: Array<{ sellerMerchantId: string; createdAt: string }> }> {
    const user = currentUser(request);
    const merchantId = user.merchantId;

    const connections = await this.prisma.marketplaceConnection.findMany({
      where: {
        buyerMerchantId: merchantId,
        status: "active",
      },
      select: {
        sellerMerchantId: true,
        createdAt: true,
      },
    });

    return {
      connections: connections.map((c) => ({
        sellerMerchantId: c.sellerMerchantId,
        createdAt: c.createdAt.toISOString(),
      })),
    };
  }
}
