import { Inject, Injectable, Optional } from "@nestjs/common";
import { PRISMA_CLIENT } from "../../../../shared/persistence/persistence.module.js";
import type { Prisma, PrismaClient } from "@prisma/client";
import type { ProductVariantLookupPort } from "../../domain/ports/product-variant-lookup.port.js";

@Injectable()
export class ProductVariantLookupAdapter implements ProductVariantLookupPort {
  constructor(@Optional() @Inject(PRISMA_CLIENT) private readonly prisma?: PrismaClient | Prisma.TransactionClient) {}

  async findBySku(
    merchantId: string,
    sku: string
  ): Promise<{ name?: string; price?: number; cost?: number; currency?: string; imageUrl?: string } | undefined> {
    if (!this.prisma) {
      return undefined;
    }

    const variants = await this.prisma.productVariant.findMany({
      where: { sku, isActive: true, product: { merchantId, isActive: true, deletedAt: null } },
      include: { price: true, product: true, media: { orderBy: { order: "asc" as const }, take: 1 } },
      take: 2,
    });
    if (variants.length !== 1) {
      return undefined;
    }
    const [variant] = variants;

    return {
      name: variant.product?.name,
      price: variant.price?.basePriceInCents != null ? variant.price.basePriceInCents / 100 : undefined,
      cost: variant.price?.costInCents != null && variant.price.costInCents >= 0 ? variant.price.costInCents / 100 : undefined,
      currency: variant.price?.currency,
      imageUrl: variant.media?.[0]?.url ?? undefined,
    };
  }
}
