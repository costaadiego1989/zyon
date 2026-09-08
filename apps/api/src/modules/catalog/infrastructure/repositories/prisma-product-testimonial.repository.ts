import type { PrismaClient } from "@prisma/client";
import type { ProductTestimonialRepositoryPort } from "../../domain/ports/product-testimonial-repository.port.js";
import {
  ProductTestimonialEntity,
  DEFAULT_PRODUCT_CONTENT_LOCALE,
} from "../../domain/entities/product-testimonial.entity.js";

export class PrismaProductTestimonialRepository
  implements ProductTestimonialRepositoryPort
{
  constructor(private readonly prisma: PrismaClient) {}

  async findApprovedByProduct(input: {
    productId: string;
    limit?: number;
    locale?: string;
  }): Promise<ProductTestimonialEntity[]> {
    const rows = await this.prisma.productTestimonial.findMany({
      where: {
        productId: input.productId,
        isPublished: true,
        moderationStatus: "approved",
        locale: input.locale ?? DEFAULT_PRODUCT_CONTENT_LOCALE,
      },
      orderBy: { createdAt: "desc" },
      take: input.limit,
    });
    return rows.map((row) => this.toEntity(row));
  }

  async listAllForMerchant(input: {
    merchantId: string;
    productId: string;
    moderationStatus?: "pending" | "approved" | "rejected";
    locale?: string;
  }): Promise<ProductTestimonialEntity[]> {
    const rows = await this.prisma.productTestimonial.findMany({
      where: {
        productId: input.productId,
        product: { merchantId: input.merchantId },
        ...(input.moderationStatus
          ? { moderationStatus: input.moderationStatus }
          : {}),
        locale: input.locale ?? DEFAULT_PRODUCT_CONTENT_LOCALE,
      },
      orderBy: { createdAt: "desc" },
    });
    return rows.map((row) => this.toEntity(row));
  }

  async create(input: any, _actor: any): Promise<ProductTestimonialEntity> {
    const row = await this.prisma.productTestimonial.create({
      data: {
        productId: input.productId,
        authorName: input.authorName,
        authorAvatarUrl: input.authorAvatarUrl ?? null,
        body: input.body,
        rating: input.rating ?? null,
        source: input.source ?? "curated",
        buyerId: input.buyerId ?? null,
        orderId: input.orderId ?? null,
        moderationStatus: input.moderationStatus ?? "approved",
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
      authorName?: string;
      authorAvatarUrl?: string | null;
      body?: string;
      rating?: number | null;
      isPublished?: boolean;
      moderationStatus?: "pending" | "approved" | "rejected";
      locale?: string;
    };
  }): Promise<ProductTestimonialEntity> {
    const row = await this.prisma.productTestimonial.update({
      where: {
        id: input.id,
        product: { merchantId: input.merchantId },
      },
      data: {
        authorName: input.patch.authorName,
        authorAvatarUrl: input.patch.authorAvatarUrl,
        body: input.patch.body,
        rating: input.patch.rating,
        isPublished: input.patch.isPublished,
        moderationStatus: input.patch.moderationStatus,
        locale: input.patch.locale,
      },
    });
    return this.toEntity(row);
  }

  async delete(input: { merchantId: string; id: string }): Promise<void> {
    await this.prisma.productTestimonial.deleteMany({
      where: { id: input.id, product: { merchantId: input.merchantId } },
    });
  }

  async approve(input: {
    merchantId: string;
    id: string;
  }): Promise<ProductTestimonialEntity> {
    const row = await this.prisma.productTestimonial.update({
      where: { id: input.id, product: { merchantId: input.merchantId } },
      data: { moderationStatus: "approved" },
    });
    return this.toEntity(row);
  }

  async reject(input: {
    merchantId: string;
    id: string;
  }): Promise<ProductTestimonialEntity> {
    const row = await this.prisma.productTestimonial.update({
      where: { id: input.id, product: { merchantId: input.merchantId } },
      data: { moderationStatus: "rejected" },
    });
    return this.toEntity(row);
  }

  private toEntity(row: {
    id: string;
    productId: string;
    authorName: string;
    authorAvatarUrl: string | null;
    body: string;
    rating: number | null;
    source: string;
    buyerId: string | null;
    orderId: string | null;
    moderationStatus: string;
    isPublished: boolean;
    locale?: string;
    createdAt: Date;
    updatedAt: Date;
  }): ProductTestimonialEntity {
    return ProductTestimonialEntity.rehydrate({
      id: row.id,
      productId: row.productId,
      authorName: row.authorName,
      authorAvatarUrl: row.authorAvatarUrl,
      body: row.body,
      rating: row.rating,
      source: row.source as "curated" | "customer_submission",
      buyerId: row.buyerId,
      orderId: row.orderId,
      moderationStatus: row.moderationStatus as "pending" | "approved" | "rejected",
      isPublished: row.isPublished,
      locale: row.locale ?? DEFAULT_PRODUCT_CONTENT_LOCALE,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    });
  }
}
