import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import type { S3UploadService } from "../../../../shared/storage/s3-upload.service.js";

export type VariantChanges = {
  basePriceInCents?: number;
  costInCents?: number | null;
  stockQuantity?: number;
  weightGrams?: number | null;
  lengthCm?: number | null;
  widthCm?: number | null;
  heightCm?: number | null;
};

@Injectable()
export class CatalogVariantService {
  constructor(private readonly prisma: PrismaClient, private readonly s3: S3UploadService) {}

  async update(merchantId: string, productId: string, variantId: string, changes: VariantChanges) {
    if (changes.stockQuantity !== undefined && (!Number.isSafeInteger(changes.stockQuantity) || changes.stockQuantity < 0)) {
      throw new BadRequestException("invalid_stock_quantity");
    }
    return this.prisma.$transaction(async (tx) => {
      const owner = { id: variantId, productId, product: { merchantId } };
      if (!await tx.productVariant.findFirst({ where: owner, select: { id: true } })) throw new NotFoundException("variant_not_found");
      if (changes.basePriceInCents !== undefined || changes.costInCents !== undefined) {
        await tx.productPrice.updateMany({
          where: { variantId, variant: { productId, product: { merchantId } } },
          data: {
            ...(changes.basePriceInCents !== undefined ? { basePriceInCents: changes.basePriceInCents } : {}),
            ...(changes.costInCents !== undefined ? { costInCents: changes.costInCents } : {}),
          },
        });
      }
      if (changes.weightGrams !== undefined || changes.lengthCm !== undefined || changes.widthCm !== undefined || changes.heightCm !== undefined) {
        await tx.productVariant.update({
          where: owner,
          data: {
            ...(changes.weightGrams !== undefined ? { weightGrams: changes.weightGrams } : {}),
            ...(changes.lengthCm !== undefined ? { lengthCm: changes.lengthCm } : {}),
            ...(changes.widthCm !== undefined ? { widthCm: changes.widthCm } : {}),
            ...(changes.heightCm !== undefined ? { heightCm: changes.heightCm } : {}),
          },
        });
      }
      if (changes.stockQuantity !== undefined) {
        const stocks = await tx.productStock.findMany({ where: { variantId, variant: { productId, product: { merchantId } } }, select: { id: true } });
        // This endpoint has no warehouse selector; never broadcast one quantity to all warehouses.
        if (stocks.length !== 1) throw new ConflictException("stock_warehouse_required");
        const updated = await tx.productStock.updateMany({
          where: { id: stocks[0].id, variantId, variant: { productId, product: { merchantId } }, reserved: { lte: changes.stockQuantity } },
          data: { quantity: changes.stockQuantity },
        });
        if (updated.count !== 1) throw new ConflictException("stock_quantity_below_reserved");
      }
      return { updated: true };
    });
  }

  async uploadMedia(merchantId: string, body: { variantId: string; image: string }) {
    if (!body.variantId || !body.image) throw new BadRequestException("variantId_and_image_required");
    const owner = { id: body.variantId, product: { merchantId } };
    if (!await this.prisma.productVariant.findFirst({ where: owner, select: { id: true } })) throw new NotFoundException("variant_not_found");
    if (!this.s3.isConfigured()) throw new BadRequestException("s3_not_configured");
    const result = await this.s3.uploadBase64(body.image, `merchants/${merchantId}/products`);
    const media = await this.prisma.productMedia.create({
      data: { variant: { connect: owner }, url: result.url, type: "IMAGE", order: 0 },
    });
    return { id: media.id, url: media.url };
  }

  async deleteMedia(merchantId: string, mediaId: string) {
    const deleted = await this.prisma.productMedia.deleteMany({ where: { id: mediaId, variant: { product: { merchantId } } } });
    if (deleted.count !== 1) throw new NotFoundException("media_not_found");
    return { deleted: true };
  }
}
