import type { PrismaClient } from "@prisma/client";
import type {
  PlatformMerchantDirectoryPage,
  PlatformMerchantDirectoryQuery,
  PlatformMerchantDirectoryReadAudit,
  PlatformMerchantDirectoryRepository,
} from "../domain/ports/platform-merchant-directory-repository.port.js";

export class PrismaPlatformMerchantDirectoryRepository implements PlatformMerchantDirectoryRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async list(input: PlatformMerchantDirectoryQuery): Promise<PlatformMerchantDirectoryPage> {
    const rows = await this.prisma.merchant.findMany({
      where: merchantWhere(input.query),
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: {
        id: true,
        name: true,
        storeSlug: true,
        storeCategory: true,
        plan: true,
        createdAt: true,
        updatedAt: true,
        _count: { select: { users: true } },
      },
      ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
      take: input.limit + 1,
    });

    const hasMore = rows.length > input.limit;
    const page = hasMore ? rows.slice(0, input.limit) : rows;
    return {
      items: page.map(row => ({
        id: row.id,
        name: row.name,
        storeSlug: row.storeSlug ?? undefined,
        storeCategory: row.storeCategory ?? undefined,
        plan: row.plan,
        memberCount: row._count.users,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      })),
      ...(hasMore ? { nextCursor: page[page.length - 1]?.id } : {}),
    };
  }

  async recordRead(input: PlatformMerchantDirectoryReadAudit): Promise<void> {
    await this.prisma.platformAuditEvent.create({
      data: {
        actorOperatorId: input.actorOperatorId,
        action: "platform.merchant_directory.read",
        permission: "platform:merchants:read",
        environment: input.environment,
        targetType: "platform_merchant_directory",
        correlationId: input.correlationId,
        outcome: "succeeded",
        details: {
          itemCount: input.itemCount,
          limit: input.limit,
          searchApplied: input.searchApplied,
        },
      },
    });
  }
}

function merchantWhere(query: string | undefined) {
  if (!query) return {};
  return {
    OR: [
      { id: { contains: query } },
      { name: { contains: query, mode: "insensitive" as const } },
      { storeSlug: { contains: query, mode: "insensitive" as const } },
    ],
  };
}
