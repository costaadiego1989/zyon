import type { PrismaClient } from "@prisma/client";
import type { ProductFaqRepositoryPort } from "../../domain/ports/product-faq-repository.port.js";
import {
  ProductFaqEntity,
  DEFAULT_PRODUCT_CONTENT_LOCALE,
} from "../../domain/entities/product-faq.entity.js";

export class PrismaProductFaqRepository implements ProductFaqRepositoryPort {
  constructor(private readonly prisma: PrismaClient) {}

  async findPublishedByProduct(input: {
    productId: string;
    locale?: string;
  }): Promise<ProductFaqEntity[]> {
    const rows = await this.prisma.productFaq.findMany({
      where: {
        productId: input.productId,
        isPublished: true,
        locale: input.locale ?? DEFAULT_PRODUCT_CONTENT_LOCALE,
      },
      orderBy: { order: "asc" },
    });
    return rows.map((row) => this.toEntity(row));
  }

  async listAllForMerchant(input: {
    merchantId: string;
    productId: string;
    locale?: string;
  }): Promise<ProductFaqEntity[]> {
    const rows = await this.prisma.productFaq.findMany({
      where: {
        productId: input.productId,
        product: { merchantId: input.merchantId },
        locale: input.locale ?? DEFAULT_PRODUCT_CONTENT_LOCALE,
      },
      orderBy: { order: "asc" },
    });
    return rows.map((row) => this.toEntity(row));
  }

  async create(input: any, _actor: any): Promise<ProductFaqEntity> {
    const row = await this.prisma.productFaq.create({
      data: {
        productId: input.productId,
        question: input.question,
        answer: input.answer,
        order: input.order ?? 0,
        isPublished: input.isPublished ?? false,
        locale: input.locale ?? DEFAULT_PRODUCT_CONTENT_LOCALE,
      },
    });
    return this.toEntity(row);
  }

  async update(input: {
    merchantId: string;
    id: string;
    patch: {
      question?: string;
      answer?: string;
      order?: number;
      isPublished?: boolean;
      locale?: string;
    };
  }): Promise<ProductFaqEntity> {
    const row = await this.prisma.productFaq.update({
      where: {
        id: input.id,
        product: { merchantId: input.merchantId },
      },
      data: {
        question: input.patch.question,
        answer: input.patch.answer,
        order: input.patch.order,
        isPublished: input.patch.isPublished,
        locale: input.patch.locale,
      },
    });
    return this.toEntity(row);
  }

  async delete(input: { merchantId: string; id: string }): Promise<void> {
    await this.prisma.productFaq.deleteMany({
      where: { id: input.id, product: { merchantId: input.merchantId } },
    });
  }

  async reorder(input: {
    merchantId: string;
    productId: string;
    orderedIds: readonly string[];
    locale?: string;
  }): Promise<ProductFaqEntity[]> {
    return this.prisma.$transaction(async (tx) => {
      for (let i = 0; i < input.orderedIds.length; i++) {
        await tx.productFaq.updateMany({
          where: {
            id: input.orderedIds[i],
            productId: input.productId,
            product: { merchantId: input.merchantId },
            locale: input.locale ?? DEFAULT_PRODUCT_CONTENT_LOCALE,
          },
          data: { order: i },
        });
      }
      const rows = await tx.productFaq.findMany({
        where: {
          productId: input.productId,
          product: { merchantId: input.merchantId },
          locale: input.locale ?? DEFAULT_PRODUCT_CONTENT_LOCALE,
        },
        orderBy: { order: "asc" },
      });
      return rows.map((row) => this.toEntity(row));
    });
  }

  private toEntity(row: {
    id: string;
    productId: string;
    question: string;
    answer: string;
    order: number;
    isPublished: boolean;
    locale?: string;
    createdAt: Date;
    updatedAt: Date;
  }): ProductFaqEntity {
    return ProductFaqEntity.rehydrate({
      id: row.id,
      productId: row.productId,
      question: row.question,
      answer: row.answer,
      order: row.order,
      isPublished: row.isPublished,
      locale: row.locale ?? DEFAULT_PRODUCT_CONTENT_LOCALE,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    });
  }
}
