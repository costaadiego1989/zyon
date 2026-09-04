import { Inject, Injectable, Optional } from "@nestjs/common";
import { PRISMA_CLIENT } from "../../../../shared/persistence/persistence.module.js";
import type { PrismaClient } from "@prisma/client";
import type { ProductVariantLookupPort } from "../../domain/ports/product-variant-lookup.port.js";

@Injectable()
export class ProductVariantLookupAdapter implements ProductVariantLookupPort {
  constructor(@Optional() @Inject(PRISMA_CLIENT) private readonly prisma?: PrismaClient) {}

  async findBySku(
    merchantId: string,
    sku: string
  ): Promise<{ name?: string; price?: number; imageUrl?: string } | undefined> {
    if (!this.prisma) {
      return undefined;
    }

    const variant = await this.prisma.productVariant.findFirst({
      where: { sku, product: { merchantId } },
      include: { price: true, product: true, media: { orderBy: { order: "asc" as const }, take: 1 } },
    });

    if (!variant) {
      return undefined;
    }

    return {
      name: variant.product?.name,
      price: variant.price?.basePriceInCents != null ? variant.price.basePriceInCents / 100 : undefined,
      imageUrl: variant.media?.[0]?.url ?? undefined,
    };
  }
}
