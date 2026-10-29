import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Query,
  UseGuards,
  Req,
  BadRequestException,
  NotFoundException,
} from "@nestjs/common";
import { AuthGuard, currentUser } from "../../../auth/presentation/auth.guard.js";
import { PlanLimitGuard, RequirePlanFeature } from "../../../payment/domain/billing-plan-guard.js";
import { PrismaClient } from "@prisma/client";
import { ListPartnerStoresUseCase } from "../../application/use-cases/list-partner-stores.use-case.js";

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

@UseGuards(AuthGuard, PlanLimitGuard)
@RequirePlanFeature("marketplace")
@Controller("marketplace/stores")
export class MarketplaceDiscoveryController {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly listPartnerStores: ListPartnerStoresUseCase
  ) {}

  @Get("partners")
  async partners(
    @Req() request: AuthenticatedRequest,
    @Query("q") q?: string
  ): Promise<{ stores: Array<{ merchantId: string; storeName: string }> }> {
    const user = currentUser(request);

    const stores = await this.listPartnerStores.execute({
      merchantId: user.merchantId,
      q: q?.trim() || undefined,
    });

    return { stores };
  }

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

    const limit = limitStr === undefined ? 20 : Number(limitStr);
    if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new BadRequestException("invalid_marketplace_store_limit");
    const config = await this.prisma.marketplaceConfig.findUnique({ where: { merchantId } });

    const where: any = {
      id: { notIn: [merchantId, ...(config?.blockedMerchants ?? [])] },
      marketplaceConfig: { is: { enabled: true, NOT: { blockedMerchants: { has: merchantId } } } },
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
        storeSettings: true,
        marketplaceConfig: {
          select: { commissionRateBps: true },
        },
      },
      orderBy: [{ name: "asc" }, { id: "asc" }],
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
        description: (m.storeSettings as any)?.company?.description ?? (m.theme as any)?.storeDescription ?? null,
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

    if (sellerId === merchantId) throw new BadRequestException("marketplace_self_connection");
    const [buyer, sellerMerchant] = await Promise.all([
      this.prisma.marketplaceConfig.findUnique({ where: { merchantId } }),
      this.prisma.merchant.findUnique({ where: { id: sellerId }, select: { marketplaceConfig: true } }),
    ]);
    const seller = sellerMerchant?.marketplaceConfig;
    if (!buyer?.enabled) throw new BadRequestException("marketplace_not_enabled");
    if (!seller?.enabled || buyer.blockedMerchants.includes(sellerId) || seller.blockedMerchants.includes(merchantId)) {
      throw new NotFoundException("marketplace_partner_unavailable");
    }

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
