import { Injectable, Inject } from "@nestjs/common";
import { PRISMA_CLIENT } from "../../../../shared/persistence/persistence.module.js";
import type { PrismaClient } from "@prisma/client";

export interface ProductDetailResult {
  found: boolean;
  product?: {
    id: string;
    name: string;
    description: string | null;
    type: string;
    isActive: boolean;
  };
  variant?: {
    id: string;
    sku: string;
    attributes: unknown;
    barcode: string | null;
    weightGrams: number | null;
    lengthCm: number | null;
    widthCm: number | null;
    heightCm: number | null;
    isActive: boolean;
    stock: number;
    reserved: number;
    price: number;
    cost: number | null;
    media: Array<{ url: string; type: string; alt: string | null }>;
  };
  allVariants?: Array<{
    id: string;
    sku: string;
    attributes: unknown;
    stock: number;
    price: number;
    isActive: boolean;
  }>;
}

@Injectable()
export class GetProductDetailBySkuUseCase {
  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient) {}

  async execute(merchantId: string, sku: string): Promise<ProductDetailResult> {
    const variant = await (this.prisma as any).productVariant.findFirst({
      where: { sku, product: { merchantId } },
      include: {
        product: { include: { variants: { include: { stock: true, price: true, media: true } } } },
        stock: true,
        price: true,
        media: true,
      },
    });

    if (!variant) return { found: false };

    const product = variant.product;
    return {
      found: true,
      product: {
        id: product.id,
        name: product.name,
        description: product.description,
        type: product.type,
        isActive: product.isActive,
      },
      variant: {
        id: variant.id,
        sku: variant.sku,
        attributes: variant.attributes,
        barcode: variant.barcode,
        weightGrams: variant.weightGrams,
        lengthCm: variant.lengthCm,
        widthCm: variant.widthCm,
        heightCm: variant.heightCm,
        isActive: variant.isActive,
        stock: variant.stock?.[0]?.quantity ?? 0,
        reserved: variant.stock?.[0]?.reserved ?? 0,
        price: variant.price?.basePriceInCents ?? 0,
        cost: variant.price?.costInCents ?? null,
        media: (variant.media ?? []).map((m: any) => ({ url: m.url, type: m.type, alt: m.alt })),
      },
      allVariants: product.variants.map((v: any) => ({
        id: v.id,
        sku: v.sku,
        attributes: v.attributes,
        stock: v.stock?.[0]?.quantity ?? 0,
        price: v.price?.basePriceInCents ?? 0,
        isActive: v.isActive,
      })),
    };
  }
}
