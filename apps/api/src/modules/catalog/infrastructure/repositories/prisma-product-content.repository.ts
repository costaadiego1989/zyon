import type { PrismaClient } from "@prisma/client";
import type { ProductContentRepositoryPort } from "../../domain/ports/product-content-repository.port.js";
import { ProductContentBlockEntity, type ProductContentBlockType } from "../../domain/entities/product-content-block.entity.js";

export class PrismaProductContentRepository implements ProductContentRepositoryPort {
  constructor(private readonly prisma: PrismaClient) {}

  async findByProduct(input: {
    merchantId: string;
    productId: string;
  }): Promise<ProductContentBlockEntity[]> {
    const rows = await this.prisma.productContentBlock.findMany({
      where: {
        productId: input.productId,
        product: { merchantId: input.merchantId },
      },
      orderBy: { order: "asc" },
    });
    return rows.map((row) => this.toEntity(row));
  }

  async upsert(
    input: { block: ProductContentBlockEntity },
    actor: { id: string; merchantId: string },
  ): Promise<ProductContentBlockEntity> {
    const block = input.block;
    const merchantId = actor.merchantId;
    await this.assertProduct(merchantId, block.productId);
    const row = await this.prisma.productContentBlock.upsert({
      where: { id: block.id },
      create: {
        id: block.id,
        productId: block.productId,
        type: block.type,
        props: block.props as object,
        order: block.order,
        isEnabled: block.isEnabled,
      },
      update: {
        type: block.type,
        props: block.props as object,
        order: block.order,
        isEnabled: block.isEnabled,
      },
    });
    return this.toEntity(row);
  }

  async delete(input: {
    merchantId: string;
    productId: string;
    id: string;
  }): Promise<void> {
    await this.assertProduct(input.merchantId, input.productId);
    await this.prisma.productContentBlock.deleteMany({
      where: {
        id: input.id,
        productId: input.productId,
        product: { merchantId: input.merchantId },
      },
    });
  }

  async replaceAll(input: {
    merchantId: string;
    productId: string;
    blocks: readonly import("../../domain/entities/product-content-block.entity.js").ProductContentBlockProps[];
  }): Promise<ProductContentBlockEntity[]> {
    await this.assertProduct(input.merchantId, input.productId);
    return this.prisma.$transaction(async (tx) => {
      await tx.productContentBlock.deleteMany({
        where: {
          productId: input.productId,
          product: { merchantId: input.merchantId },
        },
      });
      if (input.blocks.length === 0) return [];
      const rows = await Promise.all(
        input.blocks.map((b, idx) =>
          tx.productContentBlock.create({
            data: {
              id: b.id,
              productId: input.productId,
              type: b.type,
              props: b.props as object,
              order: idx,
              isEnabled: b.isEnabled,
            },
          }),
        ),
      );
      return rows.map((r) => this.toEntity(r));
    });
  }

  private async assertProduct(merchantId: string, productId: string): Promise<void> {
    const ok = await this.prisma.product.findFirst({
      where: { id: productId, merchantId },
      select: { id: true },
    });
    if (!ok) {
      throw new Error(`product_content_repo_product_not_found:${productId}`);
    }
  }

  private toEntity(row: {
    id: string;
    productId: string;
    type: string;
    props: unknown;
    order: number;
    isEnabled: boolean;
    createdAt: Date;
    updatedAt: Date;
  }): ProductContentBlockEntity {
    return ProductContentBlockEntity.rehydrate({
      id: row.id,
      productId: row.productId,
      type: row.type as ProductContentBlockType,
      props: (row.props as Record<string, unknown>) ?? {},
      order: row.order,
      isEnabled: row.isEnabled,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    });
  }
}
